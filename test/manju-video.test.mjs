import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"

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
    if (id === "@/lib/reference-images") return loadTypeScriptModule("lib/reference-images.ts", mocks)
    return {}
  }
  const factory = new Function("exports", "module", "require", transpiled)
  factory(module.exports, module, localRequire)
  return module.exports
}

test("Gemini Omni Flash video task submission uses input_reference payload", async () => {
  const modelOptions = loadTypeScriptModule("lib/model-options.ts")
  const { createManjuVideoTask } = loadTypeScriptModule("lib/manju.ts", {
    "@/lib/model-options": modelOptions,
  })

  const originalApiKey = process.env.MANJU_API_KEY
  const originalFetch = global.fetch
  let requestBody = null

  process.env.MANJU_API_KEY = "test-key"
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body))
    return {
      json: async () => ({ id: "task-1", status: "queued" }),
      ok: true,
      status: 200,
      statusText: "OK",
    }
  }

  try {
    const result = await createManjuVideoTask({
      aspectRatio: "16:9",
      durationSeconds: 6,
      model: modelOptions.manjuGeminiOmniFlashVideoModelName,
      prompt: "test prompt",
      quality: "720P",
      referenceImages: ["https://example.com/reference-1.png", "https://example.com/reference-2.png"],
    })

    assert.equal(result.taskId, "task-1")
    assert.deepEqual(requestBody, {
      aspect_ratio: "16:9",
      duration: 6,
      input_reference: ["https://example.com/reference-1.png", "https://example.com/reference-2.png"],
      model: "gemini-omni-flash-preview",
      prompt: "test prompt",
      resolution: "720p",
    })
    assert.equal("messages" in requestBody, false)
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.MANJU_API_KEY
    } else {
      process.env.MANJU_API_KEY = originalApiKey
    }
    global.fetch = originalFetch
  }
})

test("Gemini Omni Flash video task submission supports empty input_reference payload", async () => {
  const modelOptions = loadTypeScriptModule("lib/model-options.ts")
  const { createManjuVideoTask } = loadTypeScriptModule("lib/manju.ts", {
    "@/lib/model-options": modelOptions,
  })

  const originalApiKey = process.env.MANJU_API_KEY
  const originalFetch = global.fetch
  let requestBody = null

  process.env.MANJU_API_KEY = "test-key"
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body))
    return {
      json: async () => ({ id: "task-2", status: "queued" }),
      ok: true,
      status: 200,
      statusText: "OK",
    }
  }

  try {
    const result = await createManjuVideoTask({
      aspectRatio: "16:9",
      durationSeconds: 6,
      model: modelOptions.manjuGeminiOmniFlashVideoModelName,
      prompt: "test prompt",
      quality: "720P",
    })

    assert.equal(result.taskId, "task-2")
    assert.deepEqual(requestBody, {
      aspect_ratio: "16:9",
      duration: 6,
      input_reference: [],
      model: "gemini-omni-flash-preview",
      prompt: "test prompt",
      resolution: "720p",
    })
    assert.equal("messages" in requestBody, false)
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.MANJU_API_KEY
    } else {
      process.env.MANJU_API_KEY = originalApiKey
    }
    global.fetch = originalFetch
  }
})

test("Gemini Omni Flash appears in model metadata and reference limits", () => {
  const modelOptions = loadTypeScriptModule("lib/model-options.ts")
  const modelCatalog = loadTypeScriptModule("lib/model-catalog.ts", {
    "@/lib/model-options": modelOptions,
  })

  assert.equal(modelOptions.videoModelOptions.includes(modelOptions.manjuGeminiOmniFlashVideoModelName), true)
  assert.deepEqual(modelOptions.videoModelSettings[modelOptions.manjuGeminiOmniFlashVideoModelName], {
    aspectRatios: ["16:9", "9:16"],
    durations: ["3 秒", "4 秒", "5 秒", "6 秒", "7 秒", "8 秒", "9 秒", "10 秒"],
    qualities: ["720P"],
  })
  assert.equal(modelOptions.isManjuVideoModel(modelOptions.manjuGeminiOmniFlashVideoModelName), true)
  assert.deepEqual(modelOptions.getVideoReferenceImageLimits(modelOptions.manjuGeminiOmniFlashVideoModelName), {
    max: 5,
    min: 0,
  })
  assert.deepEqual(modelCatalog.getCatalogEntry("video", modelOptions.manjuGeminiOmniFlashVideoModelName), {
    apiModel: "gemini-omni-flash-preview",
    defaultDisplayName: "Gemini Omni Flash · Manju",
    model: "gemini-omni-flash-preview",
    provider: "manju",
    type: "video",
  })
})
