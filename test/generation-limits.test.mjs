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

function getSqlFunction(name) {
  const schema = readFileSync("supabase-schema.sql", "utf8")
  const start = schema.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(start, -1, `missing SQL function: ${name}`)
  const end = schema.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated SQL function: ${name}`)
  return schema.slice(start, end + 4)
}

function loadSupabaseModule(rpcResult) {
  const source = readFileSync("lib/supabase.ts", "utf8")
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  const require = (specifier) => {
    if (specifier === "@supabase/supabase-js") {
      return {
        createClient: () => ({
          rpc: async (...args) => typeof rpcResult === "function" ? rpcResult(...args) : rpcResult,
        }),
      }
    }
    if (specifier === "@/lib/generation-limits") return loadTypeScriptModule("lib/generation-limits.ts")
    if (specifier === "@/lib/project-history") return { isDeletedProjectItem: () => false }
    return {}
  }
  const factory = new Function("exports", "require", "module", transpiled)
  factory(module.exports, require, module)
  return module.exports
}

async function withSupabaseTestEnv(run) {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key"

  try {
    await run()
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    if (previousAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey
  }
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

test("后台保存生成限制时使用 RPC 返回的最终配置", async () => {
  await withSupabaseTestEnv(async () => {
    const { saveGenerationLimitsSettings } = loadSupabaseModule({
      data: {
        ok: true,
        settings: {
          enabled: true,
          maxActiveImageTasks: 4,
          maxDailyImageTasks: 60,
        },
      },
      error: null,
    })

    assert.deepEqual(
      await saveGenerationLimitsSettings({ enabled: true, maxActiveImageTasks: 4, maxDailyImageTasks: 60 }),
      { enabled: true, maxActiveImageTasks: 4, maxDailyImageTasks: 60 }
    )
  })
})

test("后台保存生成限制遇到在途冲突时返回汇总提示", async () => {
  await withSupabaseTestEnv(async () => {
    const { saveGenerationLimitsSettings } = loadSupabaseModule({
      data: {
        ok: false,
        code: "ACTIVE_IMAGE_TASKS_EXCEED_NEW_LIMIT",
        current_max: 5,
        limit: 2,
        affected_accounts: 3,
      },
      error: null,
    })

    await assert.rejects(
      () => saveGenerationLimitsSettings({ enabled: true, maxActiveImageTasks: 2, maxDailyImageTasks: 50 }),
      (error) => {
        assert.equal(error?.name, "GenerationLimitsSaveConflictError")
        assert.equal(error?.message, "当前有 3 个账号超过新上限，最高 5 个。请等待任务完成后再保存。")
        assert.deepEqual(error?.conflict, {
          affectedAccounts: 3,
          currentMax: 5,
          limit: 2,
        })
        return true
      }
    )
  })
})

test("后台保存生成限制保留数据库错误", async () => {
  const databaseError = new Error("database unavailable")

  await withSupabaseTestEnv(async () => {
    const { saveGenerationLimitsSettings } = loadSupabaseModule({ data: null, error: databaseError })

    await assert.rejects(
      () => saveGenerationLimitsSettings({ enabled: true, maxActiveImageTasks: 3, maxDailyImageTasks: 50 }),
      (error) => error === databaseError
    )
  })
})

test("管理员保存 RPC 原子拒绝低于当前图片在途占用的上限", () => {
  const sql = getSqlFunction("save_generation_limits")

  assert.match(sql, /if not public\.is_admin\(\)/)
  assert.match(sql, /perform public\.assert_current_active_session\(\)/)
  assert.match(sql, /where key = 'generation_limits'[\s\S]*for update/)
  assert.match(sql, /type = 'image'/)
  assert.match(sql, /status in \('submitted', 'processing'\)/)
  assert.match(sql, /group by user_id/)
  assert.match(sql, /ACTIVE_IMAGE_TASKS_EXCEED_NEW_LIMIT/)
  assert.match(sql, /affected_accounts/)
  assert.match(sql, /update public\.site_settings/)
})

test("关闭限制时修复无效额度后保存且不追溯在途占用", async () => {
  await withSupabaseTestEnv(async () => {
    let rpcArguments
    const { saveGenerationLimitsSettings } = loadSupabaseModule((...args) => {
      rpcArguments = args
      return {
        data: {
          ok: true,
          settings: {
            enabled: false,
            maxActiveImageTasks: 3,
            maxDailyImageTasks: 50,
          },
        },
        error: null,
      }
    })

    await saveGenerationLimitsSettings({ enabled: false, maxActiveImageTasks: 0, maxDailyImageTasks: 0 })

    assert.deepEqual(rpcArguments, ["save_generation_limits", {
      p_enabled: false,
      p_max_active: 3,
      p_max_daily: 50,
    }])
  })
})

test("图片建单与管理员保存通过同一配置行锁串行化", () => {
  const sql = getSqlFunction("create_generation_job_with_billing")

  assert.match(
    sql,
    /select value[\s\S]*from public\.site_settings[\s\S]*where key = 'generation_limits'[\s\S]*for share/
  )
})

test("最小迁移在创建建单包装函数前确保限制配置行存在", () => {
  const migration = readFileSync("docs/sql/2026-07-28-save-generation-limits-guard.sql", "utf8")
  const settingsInsert = migration.indexOf("insert into public.site_settings")
  const wrapper = migration.indexOf("create or replace function public.create_generation_job_with_billing(")

  assert.notEqual(settingsInsert, -1)
  assert.notEqual(wrapper, -1)
  assert.ok(settingsInsert < wrapper)
  assert.match(migration.slice(settingsInsert, wrapper), /on conflict \(key\) do nothing/)
})
