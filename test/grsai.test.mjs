import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"

const require = createRequire(import.meta.url)

function loadTypeScriptModule(path, mocks = {}) {
  const source = readFileSync(path, "utf8")
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  const localRequire = (id) => {
    if (mocks[id]) return mocks[id]
    return require(id)
  }
  const factory = new Function("exports", "module", "require", transpiled)
  factory(module.exports, module, localRequire)
  return module.exports
}

const {
  normalizeGrsaiStatus,
  normalizeGrsaiTaskStatus,
} = loadTypeScriptModule("lib/grsai.ts", {
  "@/lib/model-options": {
    grsaiNanoBanana2ImageApiModelName: "nano-banana-2",
  },
})

test("GrsAi status mapping covers submitted, running, succeeded, failed, and violation", () => {
  assert.equal(normalizeGrsaiStatus("submitted"), "submitted")
  assert.equal(normalizeGrsaiStatus("running"), "processing")
  assert.equal(normalizeGrsaiStatus("succeeded"), "completed")
  assert.equal(normalizeGrsaiStatus("failed"), "failed")
  assert.equal(normalizeGrsaiStatus("violation"), "failed")
})

test("GrsAi running result normalizes as processing without image URLs", () => {
  assert.deepEqual(normalizeGrsaiTaskStatus("task_1", { status: "running" }), {
    ok: true,
    mode: "grsai",
    taskId: "task_1",
    status: "processing",
    progress: 0,
    imageUrls: [],
    videoUrl: "",
    taskError: "",
    raw: { status: "running" },
  })
})

test("GrsAi succeeded result extracts unique result URLs", () => {
  const normalized = normalizeGrsaiTaskStatus("task_2", {
    status: "succeeded",
    results: [
      { url: "https://cdn.example.com/a.png" },
      { url: "https://cdn.example.com/a.png" },
      { image_url: "https://cdn.example.com/b.webp?token=1" },
    ],
  })

  assert.equal(normalized.status, "completed")
  assert.equal(normalized.progress, 100)
  assert.deepEqual(normalized.imageUrls, [
    "https://cdn.example.com/a.png",
    "https://cdn.example.com/b.webp?token=1",
  ])
  assert.equal(normalized.taskError, "")
})

test("GrsAi failed result extracts error message", () => {
  const normalized = normalizeGrsaiTaskStatus("task_3", {
    status: "failed",
    error: "quota exhausted",
  })

  assert.equal(normalized.status, "failed")
  assert.equal(normalized.progress, 100)
  assert.equal(normalized.taskError, "quota exhausted")
})

test("GrsAi violation result is failed", () => {
  const normalized = normalizeGrsaiTaskStatus("task_4", {
    status: "violation",
    message: "policy violation",
  })

  assert.equal(normalized.status, "failed")
  assert.equal(normalized.taskError, "policy violation")
})

test("GrsAi completed result without URLs returns a clear task error", () => {
  const normalized = normalizeGrsaiTaskStatus("task_5", {
    status: "succeeded",
    results: [],
  })

  assert.equal(normalized.status, "completed")
  assert.deepEqual(normalized.imageUrls, [])
  assert.equal(normalized.taskError, "GrsAi 任务已完成，但接口没有返回图片地址。")
})
