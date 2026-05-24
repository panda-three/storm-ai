#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  pnpm commit:push -- "Commit message" [path ...]
  bash scripts/commit-and-push.sh "Commit message" [path ...]

If no paths are provided, the script stages all tracked and untracked changes
that are not ignored by .gitignore.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
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

echo "[1/4] Fetching origin/main"
git fetch origin main

local_head="$(git rev-parse main)"
remote_head="$(git rev-parse origin/main)"
merge_base="$(git merge-base main origin/main)"

if [ "$local_head" != "$remote_head" ] && [ "$local_head" = "$merge_base" ]; then
  echo "Local main is behind origin/main. Run: git pull --rebase origin main" >&2
  exit 1
fi

if [ "$local_head" != "$remote_head" ] && [ "$remote_head" != "$merge_base" ]; then
  echo "Local main and origin/main have diverged. Reconcile before committing." >&2
  exit 1
fi

echo "[2/4] Staging changes"
if [ "$#" -gt 0 ]; then
  git add "$@"
else
  git add -A
fi

if git diff --cached --quiet; then
  echo "No staged changes to commit."
  exit 0
fi

echo "[3/4] Committing"
git commit -m "$message"

echo "[4/4] Pushing to origin/main"
git push origin main
