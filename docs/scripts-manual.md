# 脚本使用手册

这份手册记录仓库里 `package.json` 和 `scripts/` 下的常用脚本。默认使用 `pnpm`，并且所有命令都在仓库根目录执行。

## 日常开发

### `pnpm dev`

启动本地 Next.js 开发服务。

```bash
pnpm dev
```

适用场景：

- 本地开发和调试页面。
- 需要热更新预览 UI 或接口行为。

### `pnpm build`

执行生产构建，能发现 Next.js 集成、TypeScript 和静态生成问题。

```bash
pnpm build
```

适用场景：

- 提交或发布前验证。
- 修改路由、服务端接口、构建配置后做最终检查。

### `pnpm lint`

运行 ESLint。

```bash
pnpm lint
```

适用场景：

- 提交前检查代码风格和明显错误。
- CI 或人工发布前的基础验证。

### `pnpm typecheck`

只执行 TypeScript 类型检查，不做 Next.js 生产构建。

```bash
pnpm typecheck
```

适用场景：

- 快速验证类型改动。
- 构建太慢但想先确认类型是否通过。

### `pnpm start`

启动已经构建好的 Next.js 生产服务。

```bash
pnpm start
```

前提：

- 已经执行过 `pnpm build`。

### `pnpm start:production`

先检查生产环境变量，再启动生产服务。

```bash
pnpm start:production
```

它等价于：

```bash
node scripts/check-production-env.mjs && next start
```

适用场景：

- 在生产或类生产环境里启动服务。
- 想避免缺少关键环境变量时直接启动失败。

## 提交和同步

### `sh scripts/install-git-hooks.sh`

安装仓库 Git hooks，把 hooks 路径设置为 `.githooks`。

```bash
sh scripts/install-git-hooks.sh
```

适用场景：

- 新机器第一次拉取项目后。
- 本地或服务器需要启用 `main` 分支同步保护时。

它会让 `pre-commit` 和 `pre-push` 自动检查 `main` 是否落后于 `origin/main`。详细规则见 [git-sync-workflow.md](git-sync-workflow.md)。

### `pnpm commit:push -- "提交说明"`

一键完成同步检查、暂存、验证、提交和推送。

```bash
pnpm commit:push -- "Improve canvas lab persistence workflow"
```

脚本会依次执行：

```text
git fetch origin main
必要时 git pull --rebase --autostash origin main
git add -A
pnpm lint
pnpm build
git commit -m "提交说明"
git push origin main
```

只提交指定文件：

```bash
pnpm commit:push -- "Update deploy docs" docs/scripts-manual.md docs/README.md
```

紧急情况下跳过 `lint` 和 `build`：

```bash
SKIP_VERIFY=1 pnpm commit:push -- "Hotfix production config"
```

注意事项：

- 只能在 `main` 分支推送。
- 如果本地和远端分叉，脚本会停止，需要人工处理。
- 默认会暂存所有未忽略的改动；提交前先确认 `git status`。

## 生产发布

### `pnpm check:env`

检查 `.env.production` 中生产必需环境变量是否存在、是否仍是占位值，以及部分安全约束是否满足。

```bash
pnpm check:env
```

底层脚本：

```bash
node scripts/check-production-env.mjs
```

当前检查项包括：

- `APIMART_API_KEY`
- `APIMART_BASE_URL`
- `MENGFACTORY_API_KEY`
- `MENGFACTORY_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_GENERATED_IMAGES_BUCKET`
- `CRON_SECRET`
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`

### `pnpm deploy:production`

执行生产发布脚本。

```bash
pnpm deploy:production
```

在生产服务器上也可以直接执行：

```bash
cd /usr/storm-ai
bash scripts/deploy-production.sh
```

这个脚本面向当前生产服务器路径，默认配置如下：

```text
源码目录: /usr/storm-ai
服务链接: /var/www/storm-ai
release 目录: /var/www/storm-ai-releases
静态资源归档: /var/www/storm-ai-static/_next/static
PM2 服务名: storm-ai
```

它会执行：

```text
确认 main 分支且工作树干净
确认本地 main 等于 origin/main
创建独立 release 目录
安装依赖
检查 .env.production
生产构建
归档 _next/static
切换 /var/www/storm-ai symlink
重启 PM2
健康检查和静态资源检查
失败时回滚 symlink 并重启 PM2
```

### `node scripts/verify-production-assets.mjs`

检查页面引用的 `/_next/static` 资源是否可访问。

```bash
node scripts/verify-production-assets.mjs
```

可选环境变量：

```bash
VERIFY_ORIGINS="http://127.0.0.1:3000,https://www.zlaction.online" \
VERIFY_ROUTES="/,/admin" \
VERIFY_HOST="www.zlaction.online" \
node scripts/verify-production-assets.mjs
```

适用场景：

- 发布后确认本地服务和公网域名的静态资源没有 404。
- 排查 Next.js release 切换后旧页面引用新资源或新页面引用旧资源的问题。

## Supabase 运维

### `pnpm check:supabase:selfhosted`

检查自托管 Supabase 是否符合当前生产预期。

```bash
pnpm check:supabase:selfhosted
```

底层脚本：

```bash
node scripts/check-self-hosted-supabase.mjs
```

默认配置：

```text
Supabase 目录: /opt/supabase-storm
Supabase 域名: supabase.zlaction.online
期望 IP: 107.173.25.225
```

可选环境变量：

```bash
SUPABASE_SELF_HOSTED_DIR="/opt/supabase-storm" \
SUPABASE_SELF_HOSTED_HOST="supabase.zlaction.online" \
SUPABASE_SELF_HOSTED_IP="107.173.25.225" \
pnpm check:supabase:selfhosted
```

检查内容包括：

- Supabase 目录和 `.env` 是否存在。
- 公网 URL 是否指向专用 Supabase 域名。
- Kong、Nginx、HTTPS 代理是否正常。
- Docker 内 Postgres 是否可用。
- `generated-images` bucket 是否存在且公开。
- DNS 是否解析到预期服务器。

### `pnpm backup:supabase:selfhosted`

备份自托管 Supabase 的 Postgres 和 Storage。

```bash
pnpm backup:supabase:selfhosted
```

底层脚本：

```bash
node scripts/backup-self-hosted-supabase.mjs
```

默认路径：

```text
Supabase 目录: /opt/supabase-storm
备份目录: /usr/storm-ai/backups/supabase/<timestamp>
Storage 目录: /opt/supabase-storm/volumes/storage
```

可选环境变量：

```bash
SUPABASE_SELF_HOSTED_DIR="/opt/supabase-storm" \
SUPABASE_BACKUP_DIR="/usr/storm-ai/backups/supabase" \
pnpm backup:supabase:selfhosted
```

输出文件：

```text
postgres.dump
postgres-globals.sql
storage.tar.gz
manifest.txt
```

注意事项：

- 需要服务器上有 Docker、`tar`、`sha256sum`。
- 默认容器名是 `supabase-db`。

### `pnpm migrate:supabase:public`

从源 Supabase 迁移 public schema 业务数据到自托管 Supabase。默认是 dry run。

```bash
pnpm migrate:supabase:public
```

真正写入目标库：

```bash
pnpm migrate:supabase:public -- --apply
```

跳过 Auth 用户创建：

```bash
pnpm migrate:supabase:public -- --apply --skip-auth-users
```

默认读取：

```text
源 Supabase: .env.production 里的 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY
目标 Supabase env: /opt/supabase-storm/.env
目标 Supabase URL: https://supabase.zlaction.online
输出目录: /usr/storm-ai/backups/supabase-migration/<timestamp>
```

可选环境变量：

```bash
SUPABASE_SELF_HOSTED_ENV="/opt/supabase-storm/.env" \
SUPABASE_SELF_HOSTED_URL="https://supabase.zlaction.online" \
SUPABASE_MIGRATION_DIR="/usr/storm-ai/backups/supabase-migration" \
pnpm migrate:supabase:public
```

注意事项：

- `--apply` 会先清空目标 public 表里的相关数据，再导入。
- 创建缺失 Auth 用户时会生成临时密码，写入 `temporary-passwords.json`。
- 用户账户会被标记为必须改密码。
- 执行前建议先跑备份。

### `pnpm migrate:supabase:storage`

迁移 Supabase Storage 对象。默认是 dry run，只枚举对象并写报告。

```bash
pnpm migrate:supabase:storage
```

真正复制对象：

```bash
pnpm migrate:supabase:storage -- --apply
```

默认 bucket：

```text
generated-images
```

可选环境变量：

```bash
SUPABASE_GENERATED_IMAGES_BUCKET="generated-images" \
SUPABASE_SELF_HOSTED_ENV="/opt/supabase-storm/.env" \
SUPABASE_SELF_HOSTED_URL="https://supabase.zlaction.online" \
SUPABASE_MIGRATION_DIR="/usr/storm-ai/backups/supabase-migration" \
SUPABASE_STORAGE_REQUEST_TIMEOUT_MS="60000" \
pnpm migrate:supabase:storage
```

输出目录：

```text
/usr/storm-ai/backups/supabase-migration/storage-<timestamp>
```

输出文件：

```text
storage-objects.json
storage-summary.json
storage-failures.json
```

### `pnpm migrate:supabase:storage:db`

从数据库里的 `generation_jobs.storage_urls` 反推要迁移的 Storage 路径，而不是从 bucket listing 枚举。

```bash
pnpm migrate:supabase:storage:db
```

真正复制对象：

```bash
pnpm migrate:supabase:storage:db -- --apply
```

适用场景：

- bucket listing 不完整或权限异常。
- 只想迁移业务数据实际引用过的生成图片。

### `pnpm reset:supabase:selfhosted-passwords`

重置自托管 Supabase 所有 Auth 用户密码，并要求用户下次登录后改密码。

```bash
pnpm reset:supabase:selfhosted-passwords
```

默认读取：

```text
目标 Supabase env: /opt/supabase-storm/.env
目标 Supabase URL: https://supabase.zlaction.online
输出目录: /usr/storm-ai/backups/supabase-migration/password-reset-<timestamp>
```

输出文件：

```text
temporary-passwords.json
```

注意事项：

- 这是高风险操作，会重置所有用户密码。
- 执行前必须确认目标 Supabase URL 和 service role key。
- 临时密码文件权限为 `0600`，不要上传到 GitHub。

## 配置审计和排查

### `node scripts/audit-production-model-config.mjs`

审计生产 Supabase 中启用的模型价格配置，输出重复配置、未支持模型和实际生效价格。

```bash
node scripts/audit-production-model-config.mjs
```

可选环境变量：

```bash
MODEL_CONFIG_ENV_FILE=".env.production" \
MODEL_CONFIG_AUDIT_DIR="backups/model-config-audit" \
node scripts/audit-production-model-config.mjs
```

输出示例：

```text
backups/model-config-audit/model-config-audit-<timestamp>.json
```

适用场景：

- 调整后台模型和价格后检查重复项。
- 发布前确认是否存在启用但代码不支持的模型。

## 推荐执行顺序

### 本地开发提交

```bash
pnpm commit:push -- "提交说明"
```

### 服务器发布

```bash
cd /usr/storm-ai
git pull --rebase origin main
pnpm deploy:production
```

### Supabase 迁移前

```bash
pnpm check:supabase:selfhosted
pnpm backup:supabase:selfhosted
pnpm migrate:supabase:public
pnpm migrate:supabase:storage
```

确认 dry run 输出没问题后，再追加 `-- --apply` 执行写入。

