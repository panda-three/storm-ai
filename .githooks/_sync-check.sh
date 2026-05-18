#!/usr/bin/env sh

set -eu

action=${1:-continue}
remote=${SYNC_REMOTE:-origin}
branch=${SYNC_BRANCH:-main}
remote_ref="${remote}/${branch}"

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not inside a Git repository."

current_branch=$(git branch --show-current)
if [ -z "$current_branch" ]; then
  die "Detached HEAD detected. Switch to ${branch} before ${action}."
fi

if [ "$current_branch" != "$branch" ]; then
  printf 'Skipping remote sync check on branch "%s". Protected branch is "%s".\n' "$current_branch" "$branch"
  exit 0
fi

if ! git remote get-url "$remote" >/dev/null 2>&1; then
  die "Remote \"${remote}\" is not configured. Cannot verify sync state before ${action}."
fi

if ! git fetch --quiet "$remote" "$branch"; then
  die "Could not fetch ${remote_ref}. Fix network or SSH access before ${action}."
fi

if ! git show-ref --verify --quiet "refs/remotes/${remote_ref}"; then
  die "Remote ref ${remote_ref} does not exist. Cannot verify sync state before ${action}."
fi

behind_count=$(git rev-list --count "HEAD..${remote_ref}")
ahead_count=$(git rev-list --count "${remote_ref}..HEAD")

if [ "$behind_count" -gt 0 ]; then
  cat >&2 <<EOF
Blocked: local ${branch} is behind ${remote_ref} by ${behind_count} commit(s).

Run:
  git pull --rebase ${remote} ${branch}

Then retry ${action}.
EOF
  exit 1
fi

printf 'Sync check passed: %s is up to date with %s' "$branch" "$remote_ref"
if [ "$ahead_count" -gt 0 ]; then
  printf ' and ahead by %s commit(s)' "$ahead_count"
fi
printf '.\n'
