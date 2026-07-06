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
  buildGrsaiUpstreamTaskId,
  createGrsaiNanoBanana2ImageTask,
  normalizeGrsaiStatus,
  normalizeGrsaiTaskStatus,
  parseGrsaiUpstreamTaskId,
} = loadTypeScriptModule("lib/grsai.ts", {
  "@/lib/model-options": {
    grsaiNanoBanana2ImageApiModelName: "nano-banana-2",
  },
})

test("GrsAi image task submission uses Apifox payload contract", async () => {
  const originalApiKey = process.env.GRSAI_API_KEY
  const originalFetch = global.fetch
  let requestBody = null

  process.env.GRSAI_API_KEY = "test-key"
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body))
    return {
      headers: {
        get: () => "application/json",
      },
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ id: "6-task", status: "running" }),
    }
  }

  try {
    const result = await createGrsaiNanoBanana2ImageTask({
      prompt: "test prompt",
      quality: "1K",
      ratio: "auto",
      referenceImages: ["https://example.com/reference.png"],
    })

    assert.equal(result.taskId, "6-task")
    assert.deepEqual(requestBody, {
      model: "nano-banana-2",
      prompt: "test prompt",
      imageSize: "1K",
      aspectRatio: "auto",
      replyType: "async",
      images: ["https://example.com/reference.png"],
    })
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GRSAI_API_KEY
    } else {
      process.env.GRSAI_API_KEY = originalApiKey
    }
    global.fetch = originalFetch
  }
})

test("GrsAi image task submission does not send an image count parameter", async () => {
  const originalApiKey = process.env.GRSAI_API_KEY
  const originalFetch = global.fetch
  let requestBody = null

  process.env.GRSAI_API_KEY = "test-key"
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body))
    return {
      headers: {
        get: () => "application/json",
      },
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ id: "7-task", status: "submitted" }),
    }
  }

  try {
    const result = await createGrsaiNanoBanana2ImageTask({
      prompt: "test prompt",
      quality: "2K",
      ratio: "1:1",
    })

    assert.equal(result.taskId, "7-task")
    assert.equal("imageCount" in requestBody, false)
    assert.equal("count" in requestBody, false)
    assert.equal("num_outputs" in requestBody, false)
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GRSAI_API_KEY
    } else {
      process.env.GRSAI_API_KEY = originalApiKey
    }
    global.fetch = originalFetch
  }
})

test("GrsAi upstream task id envelope round-trips single and multiple tasks", () => {
  assert.equal(buildGrsaiUpstreamTaskId([{ id: "task-1" }]), "task-1")
  assert.deepEqual(parseGrsaiUpstreamTaskId("task-1"), [{ id: "task-1" }])

  const envelope = buildGrsaiUpstreamTaskId([
    { id: "task-1", resultUrls: ["https://example.com/1.png"] },
    { error: "failed", id: "task-2" },
  ])

  assert.deepEqual(parseGrsaiUpstreamTaskId(envelope), [
    { error: undefined, id: "task-1", resultUrls: ["https://example.com/1.png"] },
    { error: "failed", id: "task-2", resultUrls: undefined },
  ])
})

test("GrsAi image task submission reports safe response summary when task id is missing", async () => {
  const originalApiKey = process.env.GRSAI_API_KEY
  const originalFetch = global.fetch
  const originalWarn = console.warn
  const warnings = []

  process.env.GRSAI_API_KEY = "test-key"
  global.fetch = async () => ({
    headers: {
      get: () => "application/json",
    },
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify({
      data: { detail: "upstream accepted no task" },
      message: "missing task",
      status: "failed",
    }),
  })
  console.warn = (...args) => {
    warnings.push(args)
  }

  try {
    await assert.rejects(
      createGrsaiNanoBanana2ImageTask({
        prompt: "test prompt",
        quality: "1K",
        ratio: "auto",
      }),
      /GrsAi 未返回有效任务 ID。响应摘要：/
    )
    assert.equal(warnings[0][0], "[GrsAi] submit.invalid_response")
    assert.deepEqual(warnings[0][1], {
      bodyPreview: "{\"data\":{\"detail\":\"upstream accepted no task\"},\"message\":\"missing task\",\"status\":\"failed\"}",
      contentType: "application/json",
      error: "upstream accepted no task",
      httpStatus: 200,
      keys: ["data", "message", "status"],
      status: "failed",
    })
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GRSAI_API_KEY
    } else {
      process.env.GRSAI_API_KEY = originalApiKey
    }
    global.fetch = originalFetch
    console.warn = originalWarn
  }
})

test("GrsAi image task submission reports HTTP metadata when response body is not JSON", async () => {
  const originalApiKey = process.env.GRSAI_API_KEY
  const originalFetch = global.fetch
  const originalWarn = console.warn
  const warnings = []

  process.env.GRSAI_API_KEY = "test-key"
  global.fetch = async () => ({
    headers: {
      get: (key) => key.toLowerCase() === "content-type" ? "text/plain; charset=utf-8" : null,
    },
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "accepted but empty task id",
  })
  console.warn = (...args) => {
    warnings.push(args)
  }

  try {
    await assert.rejects(
      createGrsaiNanoBanana2ImageTask({
        prompt: "test prompt",
        quality: "1K",
        ratio: "auto",
      }),
      /accepted but empty task id/
    )
    assert.deepEqual(warnings[0][1], {
      bodyPreview: "accepted but empty task id",
      contentType: "text/plain; charset=utf-8",
      error: "",
      httpStatus: 200,
      keys: [],
      status: "",
    })
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GRSAI_API_KEY
    } else {
      process.env.GRSAI_API_KEY = originalApiKey
    }
    global.fetch = originalFetch
    console.warn = originalWarn
  }
})

test("GrsAi response parser accepts server-sent event JSON payloads", async () => {
  const originalApiKey = process.env.GRSAI_API_KEY
  const originalFetch = global.fetch

  process.env.GRSAI_API_KEY = "test-key"
  global.fetch = async () => ({
    headers: {
      get: () => "text/event-stream",
    },
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "event: message\ndata: {\"id\":\"6-sse-task\",\"status\":\"running\"}\n\n",
  })

  try {
    const result = await createGrsaiNanoBanana2ImageTask({
      prompt: "test prompt",
      quality: "1K",
      ratio: "auto",
    })

    assert.equal(result.taskId, "6-sse-task")
    assert.equal(result.status, "processing")
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GRSAI_API_KEY
    } else {
      process.env.GRSAI_API_KEY = originalApiKey
    }
    global.fetch = originalFetch
  }
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
