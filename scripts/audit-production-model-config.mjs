import { createClient } from "@supabase/supabase-js"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

loadEnvFile(process.env.MODEL_CONFIG_ENV_FILE ?? ".env.production")

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL")
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
const outputDir = process.env.MODEL_CONFIG_AUDIT_DIR ?? "backups/model-config-audit"
const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
const client = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const supported = new Set([
  "image:gemini-3.1-flash-image-preview",
  "image:gpt-image-2-all",
  "image:image2-M通道",
  "image:image2-Toa通道",
  "image:doubao-seedream-5-0-260128",
  "video:veo_3_1-fast",
  "video:grok-video-3",
])

const { data, error } = await client
  .from("model_pricing")
  .select("id, model, type, quality, duration_seconds, aspect_ratio, cost_cny, markup, enabled, created_at, updated_at")
  .eq("enabled", true)
  .order("type", { ascending: true })
  .order("model", { ascending: true })
  .order("updated_at", { ascending: false })

if (error) throw error

const rows = data ?? []
const groups = new Map()
for (const row of rows) {
  const key = row.type === "video"
    ? `${row.type}:${row.model}:${row.quality ?? ""}:${row.duration_seconds ?? ""}`
    : `${row.type}:${row.model}:${row.quality ?? ""}`
  const items = groups.get(key) ?? []
  items.push(row)
  groups.set(key, items)
}

const duplicateEnabledPrices = Array.from(groups.entries())
  .filter(([, items]) => items.length > 1)
  .map(([key, items]) => ({
    key,
    effectiveId: items[0].id,
    rowIds: items.map((item) => item.id),
  }))

const unsupportedEnabledModels = rows.filter((row) => !supported.has(`${row.type}:${row.model}`))
const effectivePrices = Array.from(groups.values()).map((items) => items[0])

const report = {
  generatedAt: new Date().toISOString(),
  source: url,
  enabledPriceCount: rows.length,
  effectivePriceCount: effectivePrices.length,
  duplicateEnabledPrices,
  unsupportedEnabledModels,
  effectivePrices,
}

mkdirSync(outputDir, { recursive: true })
const outputPath = join(outputDir, `model-config-audit-${timestamp}.json`)
writeFileSync(outputPath, JSON.stringify(report, null, 2))

console.log(`Audit written: ${outputPath}`)
console.log(`Enabled prices: ${rows.length}`)
console.log(`Effective prices: ${effectivePrices.length}`)
console.log(`Duplicate enabled dimensions: ${duplicateEnabledPrices.length}`)
console.log(`Unsupported enabled models: ${unsupportedEnabledModels.length}`)

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const equals = trimmed.indexOf("=")
    if (equals === -1) continue
    const key = trimmed.slice(0, equals)
    const value = trimmed.slice(equals + 1)
    if (!(key in process.env)) process.env[key] = value
  }
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}
