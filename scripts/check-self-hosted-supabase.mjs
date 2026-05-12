import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { lookup } from "node:dns/promises"
import { resolve } from "node:path"

const projectDir = process.env.SUPABASE_SELF_HOSTED_DIR ?? "/opt/supabase-storm"
const expectedHost = process.env.SUPABASE_SELF_HOSTED_HOST ?? "supabase.zlaction.online"
const expectedIp = process.env.SUPABASE_SELF_HOSTED_IP ?? "107.173.25.225"
const envPath = resolve(projectDir, ".env")

const checks = []
const pendingChecks = []

check("Supabase self-hosted directory exists", () => {
  assert(existsSync(projectDir), `${projectDir} does not exist.`)
})

check("Supabase .env exists", () => {
  assert(existsSync(envPath), `${envPath} does not exist.`)
})

const env = existsSync(envPath) ? loadEnvFile(envPath) : new Map()

check("Public URLs target the dedicated Supabase host", () => {
  assertEquals(env.get("SUPABASE_PUBLIC_URL"), `https://${expectedHost}`)
  assertEquals(env.get("API_EXTERNAL_URL"), `https://${expectedHost}`)
})

check("Kong responds through localhost", () => {
  const response = requestHeaders("http://127.0.0.1:8000")
  assert(
    /HTTP\/\d(?:\.\d)? 401/.test(response) && /X-Kong-/i.test(response),
    "Expected a 401 response from Kong on 127.0.0.1:8000.",
  )
})

check("Nginx proxies the Supabase host locally", () => {
  const response = requestHeaders("http://127.0.0.1", ["-H", `Host: ${expectedHost}`])
  assert(
    isKongUnauthorized(response) || isHttpsRedirect(response),
    `Expected Nginx to proxy ${expectedHost} to Kong or redirect HTTP to HTTPS.`,
  )
})

check("HTTPS reaches Supabase Kong through Nginx", () => {
  const response = requestHeaders(`https://${expectedHost}`, [
    "--resolve",
    `${expectedHost}:443:127.0.0.1`,
  ])
  assert(
    isKongUnauthorized(response),
    `Expected HTTPS ${expectedHost} to reach Kong through Nginx.`,
  )
})

check("Postgres is reachable inside the Supabase stack", () => {
  const output = execFileSync(
    "docker",
    ["exec", "supabase-db", "psql", "-U", "postgres", "-d", "postgres", "-tAc", "select 1;"],
    { encoding: "utf8" },
  )
  assert(output.trim() === "1", "Expected PostgreSQL to return 1.")
})

check("Generated images bucket exists", () => {
  const serviceRoleKey = env.get("SERVICE_ROLE_KEY")
  assert(serviceRoleKey, "SERVICE_ROLE_KEY is missing from the Supabase .env file.")

  const output = execFileSync(
    "curl",
    [
      "-fsS",
      "http://127.0.0.1:8000/storage/v1/bucket/generated-images",
      "-H",
      `apikey: ${serviceRoleKey}`,
      "-H",
      `Authorization: Bearer ${serviceRoleKey}`,
    ],
    { encoding: "utf8" },
  )
  const bucket = JSON.parse(output)
  assert(bucket.name === "generated-images", "generated-images bucket was not returned.")
  assert(bucket.public === true, "generated-images bucket must be public for browser reads.")
})

check("DNS points the Supabase host at this server", async () => {
  const records = await lookup(expectedHost, { all: true })
  const addresses = records.map((record) => record.address)
  assert(
    addresses.includes(expectedIp),
    `${expectedHost} resolves to ${addresses.join(", ") || "no addresses"}, expected ${expectedIp}.`,
  )
})

await Promise.all(pendingChecks)

const failed = checks.filter((item) => item.status === "failed")

for (const item of checks) {
  const marker = item.status === "passed" ? "PASS" : "FAIL"
  console.log(`${marker} ${item.name}`)
  if (item.message) console.log(`  ${item.message}`)
}

if (failed.length > 0) {
  console.error(`Self-hosted Supabase check failed: ${failed.length} issue(s).`)
  process.exit(1)
}

console.log("Self-hosted Supabase check passed.")

function check(name, fn) {
  checks.push({ name, status: "pending" })
  const current = checks.at(-1)

  try {
    const result = fn()
    if (result && typeof result.then === "function") {
      pendingChecks.push(result
        .then(() => {
          current.status = "passed"
        })
        .catch((error) => {
          current.status = "failed"
          current.message = error.message
        }))
      return
    }

    current.status = "passed"
  } catch (error) {
    current.status = "failed"
    current.message = error.message
  }
}

function requestHeaders(url, extraArgs = []) {
  return execFileSync("curl", ["-sS", "-I", ...extraArgs, url], { encoding: "utf8" })
}

function isKongUnauthorized(response) {
  return /HTTP\/\d(?:\.\d)? 401/.test(response) && /X-Kong-/i.test(response)
}

function isHttpsRedirect(response) {
  return (
    /HTTP\/\d(?:\.\d)? 30[178]/.test(response) &&
    new RegExp(`Location: https://${escapeRegExp(expectedHost)}/`, "i").test(response)
  )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function loadEnvFile(path) {
  const env = new Map()
  const content = readFileSync(path, "utf8")

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const equalsIndex = trimmed.indexOf("=")
    if (equalsIndex === -1) continue

    const key = trimmed.slice(0, equalsIndex).trim()
    const value = unquoteEnvValue(trimmed.slice(equalsIndex + 1).trim())
    if (key) env.set(key, value)
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

function assertEquals(actual, expected) {
  assert(actual === expected, `Expected ${expected}, got ${actual || "(empty)"}.`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
