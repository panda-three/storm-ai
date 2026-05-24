#!/usr/bin/env bash
set -euo pipefail

cd /usr/storm-ai

echo "[1/4] Checking production environment"
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm check:env

echo "[2/4] Building production bundle"
build_attempt=1
max_build_attempts=3
while true; do
  if XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm exec next build --webpack; then
    break
  fi

  if [ "$build_attempt" -ge "$max_build_attempts" ]; then
    exit 1
  fi

  echo "Build failed on attempt ${build_attempt}; retrying in 5 seconds..."
  build_attempt=$((build_attempt + 1))
  sleep 5
done

echo "[3/5] Restarting PM2 service"
systemctl restart pm2-root

echo "[4/5] Saving PM2 process list"
pm2 save

echo "[5/5] Verifying local health check"
health_attempt=1
max_health_attempts=12
while true; do
  if curl -fsI http://127.0.0.1:3000 >/dev/null; then
    break
  fi

  if [ "$health_attempt" -ge "$max_health_attempts" ]; then
    exit 1
  fi

  health_attempt=$((health_attempt + 1))
  sleep 5
done

echo "Production deploy completed."
