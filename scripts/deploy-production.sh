#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/usr/storm-ai"
SERVICE_LINK="/var/www/storm-ai"
STATIC_ARCHIVE_DIR="/var/www/storm-ai-static/_next/static"
RELEASE_ROOT="/var/www/storm-ai-releases"
LOCK_DIR="/tmp/storm-ai-deploy.lock"
PNPM_DATA_HOME="/usr/storm-ai/.pnpm-data"
PNPM_STORE_DIR="/usr/storm-ai/.pnpm-store"
SWITCHED="false"

cleanup() {
  rm -rf "$LOCK_DIR"
  if [[ "$SWITCHED" == "false" && -n "${RELEASE_DIR:-}" && -d "$RELEASE_DIR" ]]; then
    rm -rf "$RELEASE_DIR"
  fi
}
trap cleanup EXIT

switch_service_link() {
  local target="$1"
  local next_link="${SERVICE_LINK}.next-${deployment_version}"
  ln -sfn "$target" "$next_link"
  mv -Tf "$next_link" "$SERVICE_LINK"
}

rollback() {
  local failed_version="$1"

  echo "Deployment ${failed_version} failed. Rolling back service link." >&2
  if [[ -n "${PREVIOUS_RELEASE:-}" ]]; then
    switch_service_link "$PREVIOUS_RELEASE"
    pm2 restart storm-ai --update-env || true
    pm2 save || true
  fi
}

wait_for_health() {
  local attempt=1
  local max_attempts=12

  while true; do
    if curl -fsI http://127.0.0.1:3000 >/dev/null; then
      return 0
    fi

    if [[ "$attempt" -ge "$max_attempts" ]]; then
      return 1
    fi

    attempt=$((attempt + 1))
    sleep 5
  done
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another production deploy is already running." >&2
  exit 1
fi

cd "$SOURCE_DIR"

echo "[1/9] Checking repository state"
if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Production deploy must run from main." >&2
  exit 1
fi

if [[ -n "$(git status --short)" ]]; then
  echo "Working tree must be clean before production deploy." >&2
  git status --short
  exit 1
fi

git fetch origin main
local_head="$(git rev-parse HEAD)"
origin_head="$(git rev-parse origin/main)"
if [[ "$local_head" != "$origin_head" ]]; then
  echo "Local main is not aligned with origin/main. Pull/rebase before deploying." >&2
  exit 1
fi

release_sha="$(git rev-parse --short=12 HEAD)"
release_stamp="$(date -u +%Y%m%d%H%M%S)"
deployment_version="${release_stamp}-${release_sha}"
RELEASE_DIR="${RELEASE_ROOT}/${deployment_version}"
PREVIOUS_RELEASE="$(readlink -f "$SERVICE_LINK" 2>/dev/null || true)"

echo "[2/9] Preparing production environment"
if [[ ! -f "$SOURCE_DIR/.env.production" ]]; then
  echo ".env.production is required." >&2
  exit 1
fi

chmod 600 "$SOURCE_DIR/.env.production"
mkdir -p "$RELEASE_ROOT" "$STATIC_ARCHIVE_DIR" "$PNPM_DATA_HOME" "$PNPM_STORE_DIR"

echo "[3/9] Creating isolated release directory"
mkdir -p "$RELEASE_DIR"
git archive HEAD | tar -x -C "$RELEASE_DIR"
cp "$SOURCE_DIR/.env.production" "$RELEASE_DIR/.env.production"
chmod 600 "$RELEASE_DIR/.env.production"

echo "[4/9] Installing dependencies"
(
  cd "$RELEASE_DIR"
  XDG_DATA_HOME="$PNPM_DATA_HOME" corepack pnpm install --frozen-lockfile --store-dir "$PNPM_STORE_DIR"
)

echo "[5/9] Checking production environment"
(
  cd "$RELEASE_DIR"
  DEPLOYMENT_VERSION="$deployment_version" XDG_DATA_HOME="$PNPM_DATA_HOME" corepack pnpm check:env
)

echo "[6/9] Building production bundle"
(
  cd "$RELEASE_DIR"
  DEPLOYMENT_VERSION="$deployment_version" XDG_DATA_HOME="$PNPM_DATA_HOME" corepack pnpm build
)

echo "[7/9] Publishing release and archived assets"
cp -a "$RELEASE_DIR/.next/static/." "$STATIC_ARCHIVE_DIR/"
switch_service_link "$RELEASE_DIR"
SWITCHED="true"

echo "[8/9] Restarting PM2 service"
if ! DEPLOYMENT_VERSION="$deployment_version" pm2 restart storm-ai --update-env; then
  rollback "$deployment_version"
  exit 1
fi
pm2 save

echo "[9/9] Verifying production health and assets"
if ! wait_for_health; then
  rollback "$deployment_version"
  exit 1
fi

if ! node "$RELEASE_DIR/scripts/verify-production-assets.mjs"; then
  rollback "$deployment_version"
  exit 1
fi

echo "Production deploy completed: ${deployment_version}"
