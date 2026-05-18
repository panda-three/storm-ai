#!/usr/bin/env sh

set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

git config core.hooksPath .githooks

chmod +x .githooks/_sync-check.sh
chmod +x .githooks/pre-commit
chmod +x .githooks/pre-push

printf 'Configured Git hooks from %s/.githooks\n' "$repo_root"
printf 'Protected branch: main\n'
printf 'Protected remote: origin\n'
