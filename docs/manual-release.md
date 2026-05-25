# 手动发布指南

这份文档用于把 `origin/main` 发布到生产环境。生产源码目录是 `/usr/storm-ai`，每次发布会生成 `/var/www/storm-ai-releases/<version>`，PM2 从 `/var/www/storm-ai` 这个 release symlink 启动，静态资源归档在 `/var/www/storm-ai-static`。

## 发布前检查

```bash
cd /usr/storm-ai
git status --short
git branch --show-current
pm2 status
curl -I https://www.zlaction.online
```

继续发布前要确认：

- 当前分支是 `main`。
- `git status --short` 为空。
- 本机 `main` 已同步到 `origin/main`。
- `.env.production` 存在且权限为 `600`。
- `.env.production` 包含 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`。生成方式：`openssl rand -base64 32`。

如果服务器上有意外本地改动，不要直接发布。先按 [git-sync-workflow.md](git-sync-workflow.md) 处理提交、保留或放弃。

## 标准发布流程

只使用发布脚本：

```bash
cd /usr/storm-ai
./scripts/deploy-production.sh
```

脚本会完成：

- 加部署锁，防止并发发布。
- 校验 `main`、干净工作区、`HEAD == origin/main`。
- 在隔离 release 目录安装依赖并构建，不在正在服务的目录上原地构建。
- 为本次发布设置 `DEPLOYMENT_VERSION`。
- 同步 `.next/static` 到 `/var/www/storm-ai-static/_next/static`，保留旧 chunk 给旧浏览器页面使用。
- 原子切换 `/var/www/storm-ai` 到新 release、重启 PM2、保存进程列表。
- 校验首页和主要页面引用的 `/_next/static` 资源都能从本机 Next、本机 Nginx、公网 HTTPS 访问。
- 校验首页响应包含 `Cache-Control: no-store`。

不要再手动拆开执行 `pnpm build` + `pm2 restart`。这种原地构建流程会重新引入 HTML 和 chunk 错配风险。

## 发布后检查

```bash
pm2 status
curl -I http://127.0.0.1:3000
curl -I -H "Host: www.zlaction.online" http://127.0.0.1
curl -I https://www.zlaction.online
node /usr/storm-ai/scripts/verify-production-assets.mjs
nginx -t
```

健康结果：

- PM2 里 `storm-ai` 是 `online`。
- 本机 3000、本机 Nginx、公网 HTTPS 都返回 `200 OK`。
- 首页 `Cache-Control` 包含 `no-store`。
- 资源校验脚本通过。
- 浏览器控制台没有 chunk 404 或 “Failed to find Server Action” 新错误。

## 环境变量变更

如果 `.env.production` 变了，仍然走标准发布脚本。`NEXT_PUBLIC_*`、`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 和 `DEPLOYMENT_VERSION` 都会影响构建或运行时行为，不能只重启 PM2。

生产环境通常应清空 `APIMART_PROXY_URL`，不要指向 `127.0.0.1` 或 `localhost`。

## Nginx 变更

项目模板在：

```bash
/usr/storm-ai/deploy/nginx/storm-ai.conf
```

上线模板后执行：

```bash
cp /usr/storm-ai/deploy/nginx/storm-ai.conf /etc/nginx/sites-available/storm-ai
nginx -t
systemctl reload nginx
```

模板里 `/_next/static/` 会先从 `/var/www/storm-ai-static` 读旧、新静态资源；其他页面走 Next，并强制 HTML no-store。

## 回滚

如果发布脚本在切换 `/var/www/storm-ai` 后发现健康检查失败，会自动恢复上一份 release symlink 并重启 PM2。

如果需要代码级回滚：

```bash
cd /usr/storm-ai
git revert <BAD_COMMIT_SHA>
git push origin main
./scripts/deploy-production.sh
```

不要用 `git checkout <old-sha>` 在生产上长期运行脱离 `main` 的代码。

## 生成任务同步检查

```bash
secret=$(grep -E '^CRON_SECRET=' /usr/storm-ai/.env.production | sed 's/^CRON_SECRET=//')
curl -fsS -X POST \
  -H "Host: www.zlaction.online" \
  -H "Authorization: Bearer ${secret}" \
  http://127.0.0.1/api/cron/sync-generation-jobs
```

健康响应应包含：

```json
{"ok":true}
```
