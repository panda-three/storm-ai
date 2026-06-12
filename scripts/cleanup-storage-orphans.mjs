import { createClient } from "@supabase/supabase-js"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

loadEnvFile(".env.production")

const supportedBuckets = ["generated-images", "canvas-assets", "canvas-thumbnails"]
const args = parseArgs(process.argv.slice(2))
const apply = args.apply
const limit = args.limit
const batchSize = args.batchSize
const olderThanHours = args.olderThanHours
const buckets = args.bucket ? [args.bucket] : supportedBuckets
const outputDir = process.env.STORAGE_CLEANUP_REPORT_DIR ?? "/usr/storm-ai/backups/storage-cleanup"
const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

for (const bucket of buckets) {
  if (!supportedBuckets.includes(bucket)) {
    throw new Error(`Unsupported bucket: ${bucket}. Expected one of ${supportedBuckets.join(", ")}.`)
  }
}

const supabase = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    fetch: timeoutFetch,
  },
})

mkdirSync(outputDir, { recursive: true, mode: 0o700 })

console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`)
console.log(`Buckets: ${buckets.join(", ")}`)
console.log(`Older than: ${olderThanHours} hour(s)`)
console.log(`Limit: ${limit}`)
console.log(`Batch size: ${batchSize}`)

const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000
const initialProtectedPaths = await loadProtectedStoragePaths()
const allCandidates = []
const summaries = []

for (const bucket of buckets) {
  const objects = await listStorageObjects(bucket)
  const protectedPaths = initialProtectedPaths.get(bucket) ?? new Set()
  const candidates = objects
    .filter((object) => {
      if (!object.createdAtMs || object.createdAtMs > cutoff) return false
      return !protectedPaths.has(object.path)
    })
    .slice(0, limit)

  allCandidates.push(...candidates.map((object) => ({ ...object, bucket })))
  summaries.push(summarizeBucket({ bucket, candidates, objects, protectedPaths }))
}

writeJson(`storage-cleanup-candidates-${timestamp}.json`, allCandidates)
writeJson(`storage-cleanup-summary-${timestamp}.json`, {
  apply,
  batchSize,
  buckets,
  candidateCount: allCandidates.length,
  olderThanHours,
  summaries,
})

for (const summary of summaries) {
  console.log(
    [
      `${summary.bucket}:`,
      `objects=${summary.objectCount}`,
      `protected=${summary.protectedCount}`,
      `candidates=${summary.candidateCount}`,
      `candidateSize=${formatBytes(summary.candidateBytes)}`,
    ].join(" ")
  )
}

if (!apply) {
  console.log(`Dry run complete. Candidate report written to ${outputDir}. Re-run with --apply to delete.`)
  process.exit(0)
}

const latestProtectedPaths = await loadProtectedStoragePaths()
const applySummary = []

for (const bucket of buckets) {
  const bucketCandidates = allCandidates.filter((object) => object.bucket === bucket)
  const protectedPaths = latestProtectedPaths.get(bucket) ?? new Set()
  const deletable = bucketCandidates.filter((object) => !protectedPaths.has(object.path))
  const protectedSkipped = bucketCandidates.length - deletable.length
  const result = await deleteObjectsInBatches(bucket, deletable)

  applySummary.push({
    bucket,
    deleted: result.deleted,
    failed: result.failed.length,
    failedPaths: result.failed,
    protectedSkipped,
    releasedBytes: result.releasedBytes,
  })

  console.log(
    [
      `${bucket} apply:`,
      `deleted=${result.deleted}`,
      `protectedSkipped=${protectedSkipped}`,
      `failed=${result.failed.length}`,
      `released=${formatBytes(result.releasedBytes)}`,
    ].join(" ")
  )
}

writeJson(`storage-cleanup-apply-${timestamp}.json`, {
  applySummary,
  completedAt: new Date().toISOString(),
})

const failed = applySummary.reduce((total, item) => total + item.failed, 0)
if (failed > 0) {
  throw new Error(`Storage cleanup completed with ${failed} failed object deletion(s).`)
}

console.log("Storage cleanup apply complete.")

async function loadProtectedStoragePaths() {
  const protectedPaths = new Map(supportedBuckets.map((bucket) => [bucket, new Set()]))

  await collectGenerationJobReferences(protectedPaths)
  await collectUserAccountProjectReferences(protectedPaths)
  await collectCanvasDocumentReferences(protectedPaths)
  await collectCanvasAssetReferences(protectedPaths)

  return protectedPaths
}

async function collectGenerationJobReferences(protectedPaths) {
  let from = 0
  const pageSize = 1000

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("result_urls, storage_urls, input_reference_images")
      .range(from, to)

    if (error) throw new Error(`Failed to read generation_jobs references: ${error.message}`)

    for (const row of data ?? []) {
      addRefs(protectedPaths, row.result_urls)
      addRefs(protectedPaths, row.storage_urls)
      addRefs(protectedPaths, row.input_reference_images)
    }

    if (!data || data.length < pageSize) break
    from += pageSize
  }
}

async function collectUserAccountProjectReferences(protectedPaths) {
  let from = 0
  const pageSize = 1000

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from("user_accounts")
      .select("projects")
      .range(from, to)

    if (error) throw new Error(`Failed to read user_accounts project references: ${error.message}`)

    for (const row of data ?? []) {
      addRefs(protectedPaths, row.projects)
    }

    if (!data || data.length < pageSize) break
    from += pageSize
  }
}

async function collectCanvasDocumentReferences(protectedPaths) {
  let from = 0
  const pageSize = 1000

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from("canvas_documents")
      .select("scene, files, thumbnail_url")
      .is("deleted_at", null)
      .range(from, to)

    if (error) throw new Error(`Failed to read canvas_documents references: ${error.message}`)

    for (const row of data ?? []) {
      addRefs(protectedPaths, row.scene)
      addRefs(protectedPaths, row.files)
      addRefs(protectedPaths, row.thumbnail_url)
    }

    if (!data || data.length < pageSize) break
    from += pageSize
  }
}

async function collectCanvasAssetReferences(protectedPaths) {
  let from = 0
  const pageSize = 1000

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from("canvas_assets")
      .select("storage_url, external_url, metadata")
      .range(from, to)

    if (error) throw new Error(`Failed to read canvas_assets references: ${error.message}`)

    for (const row of data ?? []) {
      addRefs(protectedPaths, row.storage_url)
      addRefs(protectedPaths, row.external_url)
      addRefs(protectedPaths, row.metadata)
    }

    if (!data || data.length < pageSize) break
    from += pageSize
  }
}

function addRefs(protectedPaths, value) {
  for (const ref of extractStorageRefs(value)) {
    const bucketPaths = protectedPaths.get(ref.bucket)
    if (bucketPaths) bucketPaths.add(ref.path)
  }
}

function extractStorageRefs(value) {
  if (!value) return []
  const refs = []

  if (typeof value === "string") {
    const direct = parseStorageRef(value)
    if (direct) refs.push(direct)
    refs.push(...scanStorageRefs(value))
    return uniqueRefs(refs)
  }

  if (Array.isArray(value)) {
    return uniqueRefs(value.flatMap(extractStorageRefs))
  }

  if (typeof value === "object") {
    return uniqueRefs(Object.values(value).flatMap(extractStorageRefs))
  }

  return []
}

function parseStorageRef(value) {
  const normalized = String(value ?? "").trim()
  if (!normalized) return null

  try {
    const parsed = new URL(normalized, "https://www.zlaction.online")
    const parts = parsed.pathname.split("/").filter(Boolean)
    const publicIndex = parts.findIndex((part, index) => part === "public" && parts[index - 1] === "object")

    if (publicIndex === -1) return null

    const bucket = decodeURIComponent(parts[publicIndex + 1] ?? "")
    if (!supportedBuckets.includes(bucket)) return null

    const path = parts.slice(publicIndex + 2).map(decodeURIComponent).join("/")
    if (!isSafeStoragePath(path)) return null
    return { bucket, path }
  } catch {
    return null
  }
}

function scanStorageRefs(value) {
  const refs = []
  const text = String(value)

  for (const bucket of supportedBuckets) {
    const expression = new RegExp(`${escapeRegExp(bucket)}/([^\\s"'<>?\\\\)]+)`, "g")
    let match

    while ((match = expression.exec(text))) {
      const path = safeDecode(match[1])
      if (isSafeStoragePath(path)) refs.push({ bucket, path })
    }
  }

  return refs
}

function uniqueRefs(refs) {
  const seen = new Set()
  return refs.filter((ref) => {
    const key = `${ref.bucket}/${ref.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function listStorageObjects(bucket, prefix = "") {
  const output = []
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    })

    if (error) throw new Error(`Failed to list ${bucket}/${prefix}: ${error.message}`)

    const items = data ?? []
    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) {
        output.push(...await listStorageObjects(bucket, path))
      } else {
        output.push({
          bucket,
          createdAt: item.created_at ?? item.updated_at ?? "",
          createdAtMs: Date.parse(item.created_at ?? item.updated_at ?? ""),
          metadata: item.metadata ?? {},
          path,
          size: getObjectSize(item.metadata),
        })
      }
    }

    if (items.length < pageSize) break
    offset += pageSize
  }

  return output
}

async function deleteObjectsInBatches(bucket, objects) {
  let deleted = 0
  let releasedBytes = 0
  const failed = []

  for (let index = 0; index < objects.length; index += batchSize) {
    const batch = objects.slice(index, index + batchSize)
    const paths = batch.map((object) => object.path)
    const { error } = await supabase.storage.from(bucket).remove(paths)

    if (error) {
      failed.push(...paths.map((path) => ({ error: error.message, path })))
      continue
    }

    deleted += batch.length
    releasedBytes += batch.reduce((total, object) => total + object.size, 0)
  }

  return { deleted, failed, releasedBytes }
}

function summarizeBucket({ bucket, candidates, objects, protectedPaths }) {
  return {
    bucket,
    candidateBytes: candidates.reduce((total, object) => total + object.size, 0),
    candidateCount: candidates.length,
    objectCount: objects.length,
    protectedCount: objects.filter((object) => protectedPaths.has(object.path)).length,
    sampleCandidates: candidates.slice(0, 20).map((object) => ({
      createdAt: object.createdAt,
      path: object.path,
      size: object.size,
    })),
  }
}

function getObjectSize(metadata) {
  const value = metadata?.size ?? metadata?.contentLength ?? metadata?.content_length
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function isSafeStoragePath(path) {
  return Boolean(path && !path.startsWith("/") && !path.includes("..") && path.includes("/"))
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function parseArgs(argv) {
  const parsed = {
    apply: false,
    batchSize: 50,
    bucket: "",
    limit: 100,
    olderThanHours: 24,
  }

  for (const arg of argv) {
    if (arg === "--") {
      continue
    } else if (arg === "--apply") {
      parsed.apply = true
    } else if (arg.startsWith("--bucket=")) {
      parsed.bucket = arg.slice("--bucket=".length)
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = parsePositiveInteger(arg.slice("--limit=".length), "limit")
    } else if (arg.startsWith("--batch-size=")) {
      parsed.batchSize = parsePositiveInteger(arg.slice("--batch-size=".length), "batch-size")
    } else if (arg.startsWith("--older-than-hours=")) {
      parsed.olderThanHours = parsePositiveInteger(arg.slice("--older-than-hours=".length), "older-than-hours")
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${label} must be a positive integer.`)
  }
  return parsed
}

function writeJson(filename, value) {
  writeFileSync(join(outputDir, filename), `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let current = value
  let unit = 0
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024
    unit += 1
  }
  return `${current.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function loadEnvFile(path) {
  if (!existsSync(path)) return new Map()

  const values = new Map()
  const content = readFile(path)

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const index = trimmed.indexOf("=")
    if (index === -1) continue

    const key = trimmed.slice(0, index).trim()
    const value = unquoteEnvValue(trimmed.slice(index + 1).trim())
    values.set(key, value)
    if (!process.env[key]) process.env[key] = value
  }

  return values
}

function readFile(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

async function timeoutFetch(input, init = {}) {
  const signal = init.signal ?? AbortSignal.timeout(30000)
  return fetch(input, {
    ...init,
    signal,
  })
}
