import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

const projectDir = process.env.SUPABASE_SELF_HOSTED_DIR ?? "/opt/supabase-storm"
const backupRoot = process.env.SUPABASE_BACKUP_DIR ?? "/usr/storm-ai/backups/supabase"
const storageDir = resolve(projectDir, "volumes/storage")
const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
const backupDir = join(backupRoot, timestamp)

mkdirSync(backupDir, { recursive: true })

const dbDumpPath = join(backupDir, "postgres.dump")
const globalsPath = join(backupDir, "postgres-globals.sql")
const storageArchivePath = join(backupDir, "storage.tar.gz")
const manifestPath = join(backupDir, "manifest.txt")

console.log(`Writing Supabase backup to ${backupDir}`)

run("docker", [
  "exec",
  "supabase-db",
  "pg_dump",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "--format=custom",
  "--blobs",
  "--no-owner",
  "--file=/tmp/storm-ai-postgres.dump",
])

run("docker", [
  "cp",
  "supabase-db:/tmp/storm-ai-postgres.dump",
  dbDumpPath,
])

run("docker", [
  "exec",
  "supabase-db",
  "rm",
  "-f",
  "/tmp/storm-ai-postgres.dump",
])

run("docker", [
  "exec",
  "supabase-db",
  "pg_dumpall",
  "-U",
  "postgres",
  "--globals-only",
  "--file=/tmp/storm-ai-postgres-globals.sql",
])

run("docker", [
  "cp",
  "supabase-db:/tmp/storm-ai-postgres-globals.sql",
  globalsPath,
])

run("docker", [
  "exec",
  "supabase-db",
  "rm",
  "-f",
  "/tmp/storm-ai-postgres-globals.sql",
])

if (existsSync(storageDir)) {
  run("tar", [
    "-czf",
    storageArchivePath,
    "-C",
    storageDir,
    ".",
  ])
} else {
  console.warn(`Storage directory not found: ${storageDir}`)
}

const files = [dbDumpPath, globalsPath]
if (existsSync(storageArchivePath)) files.push(storageArchivePath)

const hashes = files
  .map((path) => execFileSync("sha256sum", [path], { encoding: "utf8" }).trim())
  .join("\n")

writeFileSync(
  manifestPath,
  [
    `created_at=${new Date().toISOString()}`,
    `supabase_dir=${projectDir}`,
    `backup_dir=${backupDir}`,
    `db_dump=${basename(dbDumpPath)}`,
    `globals=${basename(globalsPath)}`,
    existsSync(storageArchivePath) ? `storage=${basename(storageArchivePath)}` : "storage=missing",
    "",
    hashes,
    "",
  ].join("\n"),
  "utf8",
)

console.log("Backup completed.")
console.log(`Manifest: ${manifestPath}`)

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" })
}
