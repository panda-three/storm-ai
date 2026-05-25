# Storm AI 生产服务器记录

这份文档记录当前生产服务器的实际状态，方便以后接手、续费、排查和迁移。它不是每天发布都要执行的步骤；日常发布看 [manual-release.md](manual-release.md)，日志排查看 [logging.md](logging.md)。

## 当前生产环境

- 网站域名：`https://www.zlaction.online`
- 服务器 IP：`107.173.25.225`
- 源码目录：`/usr/storm-ai`
- Release 目录：`/var/www/storm-ai-releases/<version>`
- PM2 工作目录：`/var/www/storm-ai`，指向当前 release 的 symlink
- 静态资源归档：`/var/www/storm-ai-static`
- 应用端口：`3000`
- Nginx 端口：`80`、`443`
- PM2 应用名：`storm-ai`
- GitHub 仓库：`git@github.com:panda-three/storm-ai.git`
- 分支：`main`

当前部署方式是 Next.js Node 服务，不是静态站点。

## 主要组件

- Node.js 22
- Corepack 管理的 pnpm
- PM2 管理 Next.js 进程
- Nginx 反向代理到 `127.0.0.1:3000`
- Certbot 管理 HTTPS 证书
- Supabase Cloud 或本机自托管 Supabase
- 上游 AI 渠道：云雾、ToAPIs、APIMart

## PM2 配置

`ecosystem.config.cjs` 当前使用：

```js
module.exports = {
  apps: [
    {
      name: "storm-ai",
      script: "corepack",
      args: "pnpm start:production",
      cwd: "/var/www/storm-ai",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
}
```

`start:production` 会先执行环境变量检查，再启动 Next.js：

```bash
node scripts/check-production-env.mjs && next start
```

## 常用发布命令

```bash
cd /usr/storm-ai
./scripts/deploy-production.sh
```

发布后检查：

```bash
pm2 status
curl -I http://127.0.0.1:3000
curl -I https://www.zlaction.online
node /usr/storm-ai/scripts/verify-production-assets.mjs
```

不要在生产服务目录原地执行 `pnpm build` 后手动重启。发布脚本会创建独立 release、安装依赖、隔离构建、同步 `/_next/static` 归档、原子切换 `/var/www/storm-ai`、设置 `DEPLOYMENT_VERSION`，并在资源错配时自动失败。

## Nginx 配置

项目 Nginx 模板在：

```bash
/usr/storm-ai/deploy/nginx/storm-ai.conf
```

服务器上的启用位置：

```bash
/etc/nginx/sites-available/storm-ai
/etc/nginx/sites-enabled/storm-ai
```

修改后检查并重载：

```bash
nginx -t
systemctl reload nginx
```

## HTTPS 证书

当前用 Certbot 管理：

```bash
certbot certificates
systemctl status certbot.timer --no-pager
systemctl is-enabled certbot.timer
```

如果 HTTPS 出问题：

```bash
tail -n 100 /var/log/letsencrypt/letsencrypt.log
nginx -t
curl -I https://www.zlaction.online
```

## 环境变量

生产环境文件：

```bash
/usr/storm-ai/.env.production
```

注意：

- 不要提交 `.env.production`。
- 不要截图或复制里面的密钥。
- 生产环境通常应清空 `APIMART_PROXY_URL`。

只检查变量是否存在：

```bash
awk -F= '/^(APIMART|TOAPIS|YUNWU|NEXT_PUBLIC_SUPABASE|SUPABASE|CRON_SECRET)/ {print $1"=<set>"}' /usr/storm-ai/.env.production
```

如果 `.env.production` 变了，需要走标准发布脚本：

```bash
cd /usr/storm-ai
./scripts/deploy-production.sh
```

`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 是必需项，用于让 Server Functions 加密 key 跨构建保持一致。生成方式：

```bash
openssl rand -base64 32
```

## 生成任务同步 cron

当前推荐 cron 从本机访问，避免外部 DNS 或 Cloudflare 影响同步：

```cron
* * * * * curl -fsS -X POST -H "Host: www.zlaction.online" -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1/api/cron/sync-generation-jobs >/dev/null 2>&1
```

查看 cron，隐藏密钥：

```bash
crontab -l | sed 's/Bearer [^\"]*/Bearer ***REDACTED***/'
```

手动测试：

```bash
secret=$(grep -E '^CRON_SECRET=' /usr/storm-ai/.env.production | sed 's/^CRON_SECRET=//')
curl -fsS -X POST \
  -H "Host: www.zlaction.online" \
  -H "Authorization: Bearer ${secret}" \
  http://127.0.0.1/api/cron/sync-generation-jobs
```

健康响应包含：

```json
{"ok":true}
```

## Supabase 现状

本项目依赖：

- Supabase Auth
- PostgREST/RPC
- RLS
- Storage
- `auth.users` 相关触发器

服务器上已经存在一套自托管 Supabase 容器，主要用于迁移或备用验证。是否已经切换为正式数据源，要以 `.env.production` 里的 `NEXT_PUBLIC_SUPABASE_URL` 为准。

查看容器：

```bash
docker ps
```

本机 Supabase API 检查：

```bash
curl -I http://127.0.0.1:8000
```

返回 `401 Unauthorized` 通常表示服务在运行，只是没有带 API key。

## 重要历史记录

- 2026-05-11：生产服务器完成首次部署。
- 项目从 Vercel 形态迁移为 VPS 上的 Node.js Next.js 服务。
- Nginx/Certbot 修复了 Cloudflare `521` 问题。
- cron 同步任务改为 `/api/cron/sync-generation-jobs`。
- 2026-05-14：新增 APIMart `image2-M通道` 后重新部署，PM2、HTTPS、本机 3000 验证通过。

## 健康检查命令

```bash
pm2 status
curl -I http://127.0.0.1:3000
curl -I -H "Host: www.zlaction.online" http://127.0.0.1
curl -I http://www.zlaction.online
curl -I https://www.zlaction.online
nginx -t
systemctl status nginx --no-pager
systemctl is-enabled pm2-root
systemctl is-enabled certbot.timer
```

期望：

- PM2 `storm-ai` 是 `online`。
- 本机 3000 返回 `200 OK`。
- 公网 HTTPS 返回 `200 OK`。
- Nginx 配置正确。
- `pm2-root`、`certbot.timer` 已启用。

## 不要轻易做的事

- 不要把 `.env.production` 发到聊天窗口或提交到 Git。
- 不要在没备份时改生产数据库结构。
- 不要直接删除 `/usr/storm-ai`、`/opt/supabase-storm`、`/root/.pm2`。
- 不要随便执行 `git reset --hard`，除非明确知道会丢掉哪些文件。
- 不要在不确认数据源的情况下切换 Supabase URL。
