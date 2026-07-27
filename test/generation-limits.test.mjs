import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"

function loadTypeScriptModule(path) {
  const source = readFileSync(path, "utf8")
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  const factory = new Function("exports", "module", transpiled)
  factory(module.exports, module)
  return module.exports
}

function loadGenerationJobsModule(rpcResult) {
  const source = readFileSync("lib/generation-jobs.ts", "utf8")
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  const require = (specifier) => {
    if (specifier === "@/lib/server-supabase") {
      return {
        deleteGeneratedImageByPublicUrl: async () => undefined,
        describeServerError: (_error, fallback) => fallback,
        getGeneratedStorageObjectPath: () => "",
        getSupabaseServerClient: () => ({
          rpc: async () => rpcResult,
        }),
      }
    }
    if (specifier === "@/lib/generation-limits") return loadTypeScriptModule("lib/generation-limits.ts")
    if (specifier === "@/lib/generation-ledger") return { buildGenerationFailureRefundReason: () => "" }
    if (specifier === "@/lib/manju") return { getManjuVideoTaskStatus: async () => ({}) }
    if (specifier === "@/lib/yunwu") return { getYunwuVideoTaskStatus: async () => ({}) }
    return {}
  }
  const factory = new Function("exports", "require", "module", transpiled)
  factory(module.exports, require, module)
  return module.exports
}

const {
  defaultGenerationLimitsSettings,
  getGenerationLimitErrorPayload,
  normalizeGenerationLimitsSettings,
  parseGenerationLimitResult,
  validateGenerationLimitsSettings,
} = loadTypeScriptModule("lib/generation-limits.ts")

test("生成限制配置缺失或字段损坏时回退到安全默认值", () => {
  assert.deepEqual(normalizeGenerationLimitsSettings(null), defaultGenerationLimitsSettings)
  assert.deepEqual(
    normalizeGenerationLimitsSettings({
      enabled: false,
      maxActiveImageTasks: 0,
      maxDailyImageTasks: "many",
    }),
    {
      enabled: false,
      maxActiveImageTasks: 3,
      maxDailyImageTasks: 50,
    }
  )
})

test("启用生成限制时两个额度必须是正整数", () => {
  assert.throws(
    () => validateGenerationLimitsSettings({ enabled: true, maxActiveImageTasks: 1.5, maxDailyImageTasks: 50 }),
    /正整数/
  )
  assert.deepEqual(
    validateGenerationLimitsSettings({ enabled: true, maxActiveImageTasks: 4, maxDailyImageTasks: 60 }),
    { enabled: true, maxActiveImageTasks: 4, maxDailyImageTasks: 60 }
  )
})

test("RPC 在途限额结果转换为稳定的 429 响应字段", () => {
  const result = parseGenerationLimitResult({
    limit_code: "ACTIVE_IMAGE_TASK_LIMIT",
    current: 3,
    limit: 3,
  })

  assert.deepEqual(getGenerationLimitErrorPayload(result), {
    ok: false,
    code: "ACTIVE_IMAGE_TASK_LIMIT",
    error: "当前已有 3 个图片任务正在生成，请等待任一任务完成后再试。",
    current: 3,
    limit: 3,
  })
})

test("RPC 每日限额结果附带北京时间下一次重置时间", () => {
  const resetAt = "2026-07-28T16:00:00+00:00"
  const result = parseGenerationLimitResult({
    limit_code: "DAILY_IMAGE_TASK_LIMIT",
    current: 50,
    limit: 50,
    reset_at: resetAt,
  })

  assert.deepEqual(getGenerationLimitErrorPayload(result), {
    ok: false,
    code: "DAILY_IMAGE_TASK_LIMIT",
    error: "今日已创建 50 个图片任务，请于下一个北京时间自然日再试。",
    current: 50,
    limit: 50,
    resetAt,
  })
})

test("带扣费建单接口将 RPC 限额结果提升为专用错误", async () => {
  const { createGenerationJobWithBilling } = loadGenerationJobsModule({
    data: {
      limit_code: "ACTIVE_IMAGE_TASK_LIMIT",
      current: 3,
      limit: 3,
    },
    error: null,
  })

  await assert.rejects(
    () => createGenerationJobWithBilling({
      amount: 10,
      model: "image-model",
      prompt: "test",
      provider: "provider",
      reason: "AI 生图",
      reference: "reference",
      type: "image",
      userId: "user-id",
    }),
    (error) => error?.name === "GenerationLimitError"
  )
})
