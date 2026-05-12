import { createClient } from "@supabase/supabase-js"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

loadEnvFile(".env.production")

const args = new Set(process.argv.slice(2))
const apply = args.has("--apply")
const fromDatabase = args.has("--from-database")
const bucket = process.env.SUPABASE_GENERATED_IMAGES_BUCKET ?? "generated-images"
const outputRoot = process.env.SUPABASE_MIGRATION_DIR ?? "/usr/storm-ai/backups/supabase-migration"
const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
const outputDir = join(outputRoot, `storage-${timestamp}`)

const source = {
  url: requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
}

const targetEnvPath = process.env.SUPABASE_SELF_HOSTED_ENV ?? "/opt/supabase-storm/.env"
const targetEnv = loadEnvFile(targetEnvPath)
const target = {
  url: process.env.SUPABASE_SELF_HOSTED_URL ?? "https://supabase.zlaction.online",
  serviceRoleKey: targetEnv.get("SERVICE_ROLE_KEY"),
}

if (!target.serviceRoleKey) {
  throw new Error(`SERVICE_ROLE_KEY is missing from ${targetEnvPath}.`)
}

const sourceClient = createClient(source.url, source.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: timeoutFetch },
})
const targetClient = createClient(target.url, target.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: timeoutFetch },
})

mkdirSync(outputDir, { mode: 0o700, recursive: true })

console.log(`Source: ${source.url}`)
console.log(`Target: ${target.url}`)
console.log(`Bucket: ${bucket}`)
console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`)
console.log(`Source paths: ${fromDatabase ? "database storage_urls" : "bucket listing"}`)
console.log(`Output: ${outputDir}`)

const objects = fromDatabase
  ? await listObjectsFromDatabase(targetClient)
  : await listObjects(sourceClient, bucket)
writeJson("storage-objects.json", objects)
console.log(`Storage objects: ${objects.length}`)

let copied = 0
let skipped = 0
let failed = 0
const failures = []

if (apply) {
  for (const [index, object] of objects.entries()) {
    if (index > 0 && index % 10 === 0) {
      console.log(`Progress ${index}/${objects.length}: copied=${copied}, skipped=${skipped}, failed=${failed}`)
    }

    const existing = await targetObjectExists(object.path)
    if (existing) {
      skipped += 1
      continue
    }

    const downloaded = await downloadSourceObject(object.path)
    if (!downloaded.ok) {
      failed += 1
      failures.push({ path: object.path, error: downloaded.error })
      continue
    }

    const { error: uploadError } = await targetClient.storage
      .from(bucket)
      .upload(object.path, downloaded.buffer, {
        cacheControl: "31536000",
        contentType: downloaded.contentType ?? object.metadata?.mimetype ?? undefined,
        upsert: true,
      })

    if (uploadError) {
      failed += 1
      failures.push({ path: object.path, error: uploadError.message })
      continue
    }

    copied += 1
  }

  console.log(`Progress ${objects.length}/${objects.length}: copied=${copied}, skipped=${skipped}, failed=${failed}`)
}

const summary = {
  bucket,
  copied,
  failed,
  mode: apply ? "apply" : "dry-run",
  objectCount: objects.length,
  skipped,
}

writeJson("storage-summary.json", summary)
writeJson("storage-failures.json", failures)

console.log(`Copied=${copied}, skipped=${skipped}, failed=${failed}`)
if (!apply) {
  console.log("Dry run complete. Re-run with --apply to copy Storage objects.")
} else if (failed > 0) {
  throw new Error(`Storage migration completed with ${failed} failure(s).`)
} else {
  console.log("Storage migration apply complete.")
}

async function listObjects(client, bucketName, prefix = "") {
  const output = []
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await client.storage.from(bucketName).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    })

    if (error) throw new Error(`Failed to list ${bucketName}/${prefix}: ${error.message}`)
    const items = data ?? []

    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) {
        output.push(...await listObjects(client, bucketName, path))
      } else {
        output.push({ ...item, path })
      }
    }

    if (items.length < pageSize) break
    offset += pageSize
  }

  return output
}

async function listObjectsFromDatabase(client) {
  const urls = new Set()
  const pageSize = 1000
  let from = 0

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await client
      .from("generation_jobs")
      .select("storage_urls")
      .range(from, to)

    if (error) throw new Error(`Failed to read generation_jobs storage URLs: ${error.message}`)

    for (const row of data ?? []) {
      if (!Array.isArray(row.storage_urls)) continue

      for (const url of row.storage_urls) {
        const path = parseStoragePath(url)
        if (path) urls.add(path)
      }
    }

    if (!data || data.length < pageSize) break
    from += pageSize
  }

  return [...urls].sort().map((path) => ({ path }))
}

async function targetObjectExists(path) {
  const { data, error } = await targetClient.storage.from(bucket).list(dirname(path), {
    limit: 1,
    search: basename(path),
  })

  if (error) return false
  return Boolean(data?.some((item) => item.name === basename(path)))
}

async function downloadSourceObject(path) {
  const url = `${source.url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`

  try {
    const response = await timeoutFetch(url, {
      headers: {
        apikey: source.serviceRoleKey,
        Authorization: `Bearer ${source.serviceRoleKey}`,
      },
    })

    if (!response.ok) {
      return { ok: false, error: `download failed with HTTP ${response.status}` }
    }

    const arrayBuffer = await response.arrayBuffer()
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get("content-type") ?? undefined,
      ok: true,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function parseStoragePath(value) {
  if (typeof value !== "string" || !value) return ""

  try {
    const url = new URL(value)
    const marker = `/storage/v1/object/public/${bucket}/`
    const index = url.pathname.indexOf(marker)
    if (index === -1) return ""

    return decodeURIComponent(url.pathname.slice(index + marker.length))
  } catch {
    return ""
  }
}

function dirname(path) {
  const index = path.lastIndexOf("/")
  return index === -1 ? "" : path.slice(0, index)
}

function basename(path) {
  const index = path.lastIndexOf("/")
  return index === -1 ? path : path.slice(index + 1)
}

function writeJson(filename, data) {
  writeFileSync(join(outputDir, filename), `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
}

async function timeoutFetch(input, init = {}) {
  const timeoutMs = Number(process.env.SUPABASE_STORAGE_REQUEST_TIMEOUT_MS ?? 60_000)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function requiredEnv(key) {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function loadEnvFile(filename) {
  const path = resolve(process.cwd(), filename)
  const env = new Map()
  if (!existsSync(path)) return env

  const content = readFileSync(path, "utf8")
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const equalsIndex = trimmed.indexOf("=")
    if (equalsIndex === -1) continue

    const key = trimmed.slice(0, equalsIndex).trim()
    const value = unquoteEnvValue(trimmed.slice(equalsIndex + 1).trim())
    if (!key) continue

    env.set(key, value)
    if (process.env[key] === undefined) process.env[key] = value
  }

  return env
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
