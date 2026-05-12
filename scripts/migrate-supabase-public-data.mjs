import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

loadEnvFile(".env.production")

const args = new Set(process.argv.slice(2))
const apply = args.has("--apply")
const skipAuthUsers = args.has("--skip-auth-users")
const outputRoot = process.env.SUPABASE_MIGRATION_DIR ?? "/usr/storm-ai/backups/supabase-migration"
const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
const outputDir = join(outputRoot, timestamp)

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

if (source.url === target.url) {
  throw new Error("Source and target Supabase URLs are the same. Refusing to migrate.")
}

const sourceClient = createClient(source.url, source.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const targetClient = createClient(target.url, target.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const tables = [
  { name: "credit_packages", order: "created_at", conflict: "id", clearColumn: "id" },
  { name: "site_settings", order: "key", conflict: "key", clearColumn: "key" },
  { name: "model_pricing", order: "created_at", conflict: "id", clearColumn: "id" },
  { name: "user_accounts", order: "created_at", conflict: "user_id", clearColumn: "user_id", forcePasswordChange: true },
  { name: "user_active_sessions", order: "created_at", conflict: "user_id", clearColumn: "user_id", skipImport: true },
  { name: "redeem_codes", order: "created_at", conflict: "code", clearColumn: "code" },
  { name: "account_security_events", order: "created_at", conflict: "id", clearColumn: "id" },
  { name: "generation_jobs", order: "created_at", conflict: "id", clearColumn: "id" },
]

mkdirSync(outputDir, { mode: 0o700, recursive: true })
chmodSync(outputDir, 0o700)

console.log(`Source: ${source.url}`)
console.log(`Target: ${target.url}`)
console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`)
console.log(`Output: ${outputDir}`)

const authUsers = await listAuthUsers(sourceClient)
const sourceUserAccounts = await fetchAllRows(sourceClient, "user_accounts", "created_at")
writeJson("auth-users.json", sanitizeUsers(authUsers))
console.log(`Auth users: ${authUsers.length}`)

const temporaryPasswords = []
if (apply && !skipAuthUsers) {
  await createMissingAuthUsers(authUsers, sourceUserAccounts, temporaryPasswords)
  writeJson("temporary-passwords.json", temporaryPasswords)
  console.log(`Temporary passwords written for ${temporaryPasswords.length} created user(s).`)
} else if (!skipAuthUsers) {
  console.log("Dry run: auth users would be created with preserved IDs and temporary passwords.")
} else {
  console.log("Skipping auth user creation.")
}

const summary = []
const beforeTargetCounts = new Map()

for (const table of tables) {
  beforeTargetCounts.set(table.name, await countRows(targetClient, table.name))
}

if (apply) {
  console.log("Clearing target public data before import.")
  for (const table of [...tables].reverse()) {
    await deleteRows(targetClient, table.name, table.clearColumn)
  }
}

for (const table of tables) {
  const rows = table.name === "user_accounts"
    ? sourceUserAccounts
    : await fetchAllRows(sourceClient, table.name, table.order)
  const preparedRows = table.forcePasswordChange ? rows.map(markPasswordChangeRequired) : rows
  writeJson(`${table.name}.json`, preparedRows)

  const sourceCount = rows.length
  const beforeTargetCount = beforeTargetCounts.get(table.name) ?? 0

  if (apply && preparedRows.length > 0) {
    if (!table.skipImport) {
      await upsertRows(targetClient, table.name, preparedRows, table.conflict)
    }
  }

  const afterTargetCount = await countRows(targetClient, table.name)

  summary.push({
    table: table.name,
    sourceCount,
    beforeTargetCount,
    afterTargetCount,
    changed: apply,
  })

  console.log(
    `${table.name}: source=${sourceCount}, target_before=${beforeTargetCount}, target_after=${afterTargetCount}`,
  )
}

writeJson("summary.json", summary)

if (!apply) {
  console.log("Dry run complete. Re-run with --apply to write to the self-hosted Supabase.")
} else {
  console.log("Migration apply complete. Review summary and temporary-passwords.json before cutover.")
}

async function createMissingAuthUsers(users, sourceAccounts, passwordRows) {
  const accountByUserId = new Map(sourceAccounts.map((account) => [account.user_id, account]))

  for (const user of users) {
    const { data: existing, error: getError } = await targetClient.auth.admin.getUserById(user.id)
    if (getError && getError.status !== 404) {
      throw new Error(`Failed to read target auth user ${user.id}: ${getError.message}`)
    }

    if (existing?.user) continue

    const email = user.email || undefined
    if (!email) {
      console.warn(`Skipping auth user without email: ${user.id}`)
      continue
    }

    const password = generateTemporaryPassword()
    const account = accountByUserId.get(user.id)
    const username = getMigrationUsername(user, account)
    const { error } = await targetClient.auth.admin.createUser({
      app_metadata: user.app_metadata ?? {},
      email,
      email_confirm: Boolean(user.email_confirmed_at || user.confirmed_at),
      id: user.id,
      password,
      user_metadata: {
        ...(user.user_metadata ?? {}),
        username,
      },
    })

    if (error) {
      throw new Error(`Failed to create target auth user ${user.id}: ${error.message}`)
    }

    passwordRows.push({
      email,
      temporaryPassword: password,
      userId: user.id,
    })
  }
}

function getMigrationUsername(user, account) {
  const candidates = [
    account?.username,
    user.user_metadata?.username,
    `user_${user.id.replace(/-/g, "").slice(0, 18)}`,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[A-Za-z0-9_]{3,24}$/.test(candidate)) {
      return candidate
    }
  }

  return `user_${randomBytes(9).toString("hex")}`
}

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

async function fetchAllRows(client, table, orderColumn) {
  const rows = []
  const pageSize = 1000
  let from = 0

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await client
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: true })
      .range(from, to)

    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`)
    rows.push(...(data ?? []))

    if (!data || data.length < pageSize) break
    from += pageSize
  }

  return rows
}

async function upsertRows(client, table, rows, conflict) {
  const batchSize = 500

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize)
    const { error } = await client
      .from(table)
      .upsert(batch, { onConflict: conflict })

    if (error) throw new Error(`Failed to upsert ${table}: ${error.message}`)
  }
}

async function deleteRows(client, table, column) {
  const { error } = await client
    .from(table)
    .delete()
    .not(column, "is", null)

  if (error) throw new Error(`Failed to clear ${table}: ${error.message}`)
}

async function countRows(client, table) {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true })

  if (error) throw new Error(`Failed to count ${table}: ${error.message}`)
  return count ?? 0
}

function markPasswordChangeRequired(row) {
  return {
    ...row,
    must_change_password: true,
    temporary_password_set_at: new Date().toISOString(),
    temporary_password_set_by: null,
  }
}

function sanitizeUsers(users) {
  return users.map((user) => ({
    app_metadata: user.app_metadata ?? {},
    confirmed_at: user.confirmed_at ?? null,
    created_at: user.created_at ?? null,
    email: user.email ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    id: user.id,
    last_sign_in_at: user.last_sign_in_at ?? null,
    phone: user.phone ?? null,
    updated_at: user.updated_at ?? null,
    user_metadata: user.user_metadata ?? {},
  }))
}

function writeJson(filename, data) {
  const path = join(outputDir, filename)
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  chmodSync(path, 0o600)
}

function generateTemporaryPassword() {
  return `${randomBytes(18).toString("base64url")}Aa1!`
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
