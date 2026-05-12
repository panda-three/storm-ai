import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const outputRoot = process.env.SUPABASE_MIGRATION_DIR ?? "/usr/storm-ai/backups/supabase-migration"
const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
const outputDir = join(outputRoot, `password-reset-${timestamp}`)
const targetEnvPath = process.env.SUPABASE_SELF_HOSTED_ENV ?? "/opt/supabase-storm/.env"
const targetEnv = loadEnvFile(targetEnvPath)
const target = {
  url: process.env.SUPABASE_SELF_HOSTED_URL ?? "https://supabase.zlaction.online",
  serviceRoleKey: targetEnv.get("SERVICE_ROLE_KEY"),
}

if (!target.serviceRoleKey) {
  throw new Error(`SERVICE_ROLE_KEY is missing from ${targetEnvPath}.`)
}

const targetClient = createClient(target.url, target.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

mkdirSync(outputDir, { mode: 0o700, recursive: true })
chmodSync(outputDir, 0o700)

const users = await listAuthUsers(targetClient)
const passwords = []

for (const user of users) {
  if (!user.email) {
    console.warn(`Skipping user without email: ${user.id}`)
    continue
  }

  const password = generateTemporaryPassword()
  const { error } = await targetClient.auth.admin.updateUserById(user.id, {
    password,
  })

  if (error) {
    throw new Error(`Failed to reset password for ${user.id}: ${error.message}`)
  }

  passwords.push({
    email: user.email,
    temporaryPassword: password,
    userId: user.id,
  })
}

const { error: accountError } = await targetClient
  .from("user_accounts")
  .update({
    must_change_password: true,
    temporary_password_set_at: new Date().toISOString(),
    temporary_password_set_by: null,
  })
  .not("user_id", "is", null)

if (accountError) {
  throw new Error(`Failed to mark users for password change: ${accountError.message}`)
}

writeJson("temporary-passwords.json", passwords)
console.log(`Reset temporary passwords for ${passwords.length} user(s).`)
console.log(`Temporary password file: ${join(outputDir, "temporary-passwords.json")}`)

async function listAuthUsers(client) {
  const users = []
  let page = 1
  const perPage = 1000

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`Failed to list auth users: ${error.message}`)

    const pageUsers = data.users ?? []
    users.push(...pageUsers)

    if (pageUsers.length < perPage) break
    page += 1
  }

  return users
}

function writeJson(filename, data) {
  const path = join(outputDir, filename)
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  chmodSync(path, 0o600)
}

function generateTemporaryPassword() {
  return `${randomBytes(18).toString("base64url")}Aa1!`
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
