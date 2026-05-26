#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  pnpm commit:push -- "Commit message" [path ...]
  bash scripts/commit-and-push.sh "Commit message" [path ...]

If no paths are provided, the script stages all tracked and untracked changes
that are not ignored by .gitignore. The script syncs main with origin/main,
runs lint and build, commits, then pushes to GitHub.

Set SKIP_VERIFY=1 to skip lint and build for urgent commits.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "--" ]; then
  shift
fi

if [ "$#" -lt 1 ]; then
  usage >&2
  exit 2
fi

message="$1"
shift

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  echo "Refusing to push from '$branch'. Switch to main first." >&2
  exit 1
fi

echo "[1/6] Fetching origin/main"
git fetch origin main

local_head="$(git rev-parse main)"
remote_head="$(git rev-parse origin/main)"
merge_base="$(git merge-base main origin/main)"

if [ "$local_head" != "$remote_head" ] && [ "$local_head" = "$merge_base" ]; then
  echo "Local main is behind origin/main. Rebasing with autostash."
  git pull --rebase --autostash origin main
  local_head="$(git rev-parse main)"
  remote_head="$(git rev-parse origin/main)"
  merge_base="$(git merge-base main origin/main)"
fi

if [ "$local_head" != "$remote_head" ] && [ "$remote_head" != "$merge_base" ]; then
  echo "Local main and origin/main have diverged. Reconcile before committing." >&2
  exit 1
fi

echo "[2/6] Staging changes"
if [ "$#" -gt 0 ]; then
  git add "$@"
else
  git add -A
fi

if git diff --cached --quiet; then
  echo "No staged changes to commit."
  exit 0
fi

if [ "${SKIP_VERIFY:-}" != "1" ]; then
  echo "[3/6] Running lint"
  pnpm lint

  echo "[4/6] Running build"
  pnpm build
else
  echo "[3/6] Skipping lint"
  echo "[4/6] Skipping build"
fi

echo "[5/6] Committing"
git commit -m "$message"

echo "[6/6] Pushing to origin/main"
git push origin main
