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
    if (id === "@/lib/reference-images") return loadTypeScriptModule("lib/reference-images.ts", mocks)
    return require(id)
  }
  const factory = new Function("exports", "module", "require", transpiled)
  factory(module.exports, module, localRequire)
  return module.exports
}

function loadApimartModule(mocks = {}) {
  return loadTypeScriptModule("lib/apimart.ts", {
    "node:https": {
      __esModule: true,
      default: {
        Agent: class {},
        request: () => {
          throw new Error("unexpected request")
        },
      },
    },
    "node:net": {
      __esModule: true,
      default: {
        connect: () => ({
          once: () => undefined,
          destroy: () => undefined,
          write: () => undefined,
        }),
      },
    },
    "node:tls": {
      __esModule: true,
      default: {
        connect: () => ({
          once: () => undefined,
        }),
      },
    },
    "node:stream": {},
    ...mocks,
  })
}

test("APIMart Seedream 5 Pro appears in model metadata", () => {
  const modelOptions = loadTypeScriptModule("lib/model-options.ts")
  const modelCatalog = loadTypeScriptModule("lib/model-catalog.ts", {
    "@/lib/model-options": modelOptions,
  })

  assert.equal(modelOptions.imageModelOptions.includes(modelOptions.apimartSeedream5ProImageModelName), true)
  assert.equal(modelOptions.isApimartImageModel(modelOptions.apimartSeedream5ProImageModelName), true)
  assert.deepEqual(modelOptions.imageModelSettings[modelOptions.apimartSeedream5ProImageModelName], {
    qualities: ["1K", "1.5K", "2K"],
    ratios: ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
  })
  assert.deepEqual(modelCatalog.getCatalogEntry("image", modelOptions.apimartSeedream5ProImageModelName), {
    apiModel: "doubao-seedream-5-0-pro",
    defaultDisplayName: "Seedream 5.0 Pro · M通道",
    model: "doubao-seedream-5-0-pro",
    provider: "apimart",
    type: "image",
  })
})

test("APIMart Seedream 5 Pro ratio list excludes unsupported ratios", () => {
  const modelOptions = loadTypeScriptModule("lib/model-options.ts")
  const supported = modelOptions.getImageRatiosForSelection(modelOptions.apimartSeedream5ProImageModelName, "1.5K")
  const unsupported = ["9:21", "5:4", "4:5", "2:1", "1:2"]

  assert.deepEqual(supported, ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"])
  for (const ratio of unsupported) {
    assert.equal(supported.includes(ratio), false)
    assert.equal(modelOptions.isValidImageRatioForQuality(modelOptions.apimartSeedream5ProImageModelName, "1.5K", ratio), false)
  }
})

test("APIMart Seedream 5 Pro submit payload uses single-image async contract", async () => {
  const modelOptions = loadTypeScriptModule("lib/model-options.ts")
  const { createApimartSeedream5ProTask } = loadApimartModule({
    "@/lib/generation-types": {},
    "@/lib/model-options": modelOptions,
  })
  const originalApiKey = process.env.APIMART_API_KEY
  const originalRequest = global.__apimartTestRequest
  let requestBody = null

  process.env.APIMART_API_KEY = "test-key"
  global.__apimartTestRequest = async (_url, _method, _headers, payload) => {
    requestBody = JSON.parse(Buffer.from(payload).toString("utf8"))
    return { data: { task_id: "seedream-task-1" } }
  }

  try {
    const result = await createApimartSeedream5ProTask({
      prompt: "test prompt",
      quality: "1.5K",
      ratio: "16:9",
      referenceImages: ["https://example.com/reference-1.png", "https://example.com/reference-2.png"],
    })

    assert.equal(result.taskId, "seedream-task-1")
    assert.deepEqual(requestBody, {
      model: "doubao-seedream-5-0-pro",
      prompt: "test prompt",
      resolution: "1.5K",
      size: "16:9",
      output_format: "png",
      image_urls: ["https://example.com/reference-1.png", "https://example.com/reference-2.png"],
    })
    assert.equal("n" in requestBody, false)
    assert.equal("official_fallback" in requestBody, false)
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.APIMART_API_KEY
    } else {
      process.env.APIMART_API_KEY = originalApiKey
    }
    if (originalRequest === undefined) {
      delete global.__apimartTestRequest
    } else {
      global.__apimartTestRequest = originalRequest
    }
  }
})
