#!/usr/bin/env sh
# 拦截疑似真实密钥进入提交。命中后请把值移到 .env.local，仓库里只留占位符。

set -eu

staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && exit 0

found=0

for file in $staged; do
  [ -f "$file" ] || continue

  case "$file" in
    pnpm-lock.yaml|package-lock.json|yarn.lock) continue ;;
    .githooks/_secret-scan.sh) continue ;;
  esac

  # sk- 开头的长密钥；占位符（your-..., xxx, <...>）不算
  hits=$(git show ":$file" 2>/dev/null | grep -nE "sk-[A-Za-z0-9_-]{20,}" | grep -viE "your-|placeholder|example|xxxx|<.*>" || true)

  # Supabase / JWT service_role 密钥
  jwt=$(git show ":$file" 2>/dev/null | grep -nE "eyJhbGciOi[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}" || true)

  if [ -n "$hits" ] || [ -n "$jwt" ]; then
    found=1
    printf '\n  %s\n' "$file"
    [ -n "$hits" ] && printf '%s\n' "$hits" | sed 's/^/    /'
    [ -n "$jwt" ] && printf '%s\n' "$jwt" | sed 's/^/    /'
  fi
done

if [ "$found" -ne 0 ]; then
  printf '\n拒绝提交：检测到疑似真实密钥（见上方文件与行号）。\n'
  printf '请把真实值移到 .env.local，仓库内只保留 your-xxx 形式的占位符。\n'
  printf '确认为误报时可用 git commit --no-verify 跳过。\n\n'
  exit 1
fi

exit 0
