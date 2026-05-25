import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

loadEnvFile(".env.production")

const required = [
  "APIMART_API_KEY",
  "APIMART_BASE_URL",
  "MENGFACTORY_API_KEY",
  "MENGFACTORY_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_GENERATED_IMAGES_BUCKET",
  "CRON_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
]

const placeholderPatterns = [
  /^your_/i,
  /^replace_/i,
  /_here$/i,
]

const errors = []

for (const key of required) {
  const value = process.env[key]?.trim()

  if (!value) {
    errors.push(`${key} is required.`)
    continue
  }

  if (placeholderPatterns.some((pattern) => pattern.test(value))) {
    errors.push(`${key} still contains a placeholder value.`)
  }
}

const cronSecret = process.env.CRON_SECRET?.trim() ?? ""
if (cronSecret && cronSecret.length < 32) {
  errors.push("CRON_SECRET must be at least 32 characters.")
}

const serverActionsEncryptionKey = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY?.trim() ?? ""
if (serverActionsEncryptionKey) {
  let decodedLength
  try {
    decodedLength = Buffer.from(serverActionsEncryptionKey, "base64").length
  } catch {
    decodedLength = 0
  }

  if (![16, 24, 32].includes(decodedLength)) {
    errors.push("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY must be base64-encoded and decode to 16, 24, or 32 bytes.")
  }
}

const apimartProxyUrl = process.env.APIMART_PROXY_URL?.trim() ?? ""
if (apimartProxyUrl && /(127\.0\.0\.1|localhost|\[::1\])/i.test(apimartProxyUrl)) {
  errors.push("APIMART_PROXY_URL must not point to localhost in production.")
}

if (errors.length > 0) {
  console.error("Production environment check failed:")
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log("Production environment check passed.")

function loadEnvFile(filename) {
  const path = resolve(process.cwd(), filename)
  if (!existsSync(path)) return

  const content = readFileSync(path, "utf8")

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const equalsIndex = trimmed.indexOf("=")
    if (equalsIndex === -1) continue

    const key = trimmed.slice(0, equalsIndex).trim()
    const rawValue = trimmed.slice(equalsIndex + 1).trim()
    if (!key || process.env[key] !== undefined) continue

    process.env[key] = unquoteEnvValue(rawValue)
  }
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
