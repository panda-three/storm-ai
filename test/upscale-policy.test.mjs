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

const {
  maxUpscaleInputBytes,
  maxUpscaleOutputEdge,
  resolveUpscaleScale,
  validateUpscaleFile,
} = loadTypeScriptModule("lib/upscale-policy.ts")

test("高清放大器只接受 JPG、PNG、WebP 且单图不超过 10MB", () => {
  assert.equal(validateUpscaleFile({ name: "photo.jpg", size: maxUpscaleInputBytes, type: "image/jpeg" }).ok, true)
  assert.equal(validateUpscaleFile({ name: "photo.png", size: 1024, type: "image/png" }).ok, true)
  assert.equal(validateUpscaleFile({ name: "photo.webp", size: 1024, type: "image/webp" }).ok, true)

  assert.deepEqual(validateUpscaleFile({ name: "notes.txt", size: 1024, type: "text/plain" }), {
    ok: false,
    error: "仅支持 JPG、PNG、WebP 格式。",
  })
  assert.deepEqual(validateUpscaleFile({ name: "large.png", size: maxUpscaleInputBytes + 1, type: "image/png" }), {
    ok: false,
    error: "单张图片不能超过 10MB。",
  })
})

test("4x 超过 8192px 但 2x 可满足时自动降级为 2x", () => {
  assert.deepEqual(resolveUpscaleScale({ width: 3000, height: 1800, requestedScale: 4 }), {
    actualScale: 2,
    ok: true,
    warning: `4x 会超过 ${maxUpscaleOutputEdge}px 输出限制，已自动降级为 2x。`,
  })
})

test("2x 仍超过 8192px 时阻止提交", () => {
  assert.deepEqual(resolveUpscaleScale({ width: 5000, height: 4200, requestedScale: 2 }), {
    actualScale: 2,
    ok: false,
    error: `这张图 2x 后仍会超过 ${maxUpscaleOutputEdge}px 输出限制，请换一张更小的图片。`,
  })
})

test("倍率只允许 2x 或 4x", () => {
  assert.throws(() => resolveUpscaleScale({ width: 1000, height: 1000, requestedScale: 3 }), /请选择 2x 或 4x/)
})
