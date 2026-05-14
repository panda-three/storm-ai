# Linux 服务器首次部署指南

这份文档用于从零把 Storm AI 部署到一台 Linux 服务器。当前生产环境已经部署完成，日常更新请优先看 [manual-release.md](manual-release.md)。只有换服务器、重装系统、重新配置域名时，才需要按本文重新走一遍。

## 当前生产信息

- 服务器 IP：`107.173.25.225`
- 网站域名：`https://www.zlaction.online`
- 项目目录：`/usr/storm-ai`
- PM2 工作目录别名：`/var/www/storm-ai -> /usr/storm-ai`
- 应用端口：`3000`
- 运行方式：Next.js Node 服务，不是静态站点
- 主要组件：Node.js、Corepack/pnpm、PM2、Nginx、Certbot、Supabase、APIMart、ToAPIs、云雾

## 1. 配置 DNS

在域名服务商或 Cloudflare 中配置：

```text
www.zlaction.online  A  107.173.25.225
```

注意：

- `www` 上不要同时保留冲突的 `CNAME`。
- 如果服务器没有配置 IPv6，不要保留旧的 `AAAA` 记录。
- DNS 生效后再申请 HTTPS 证书。

## 2. 登录服务器并安装基础环境

```bash
ssh root@107.173.25.225
```

安装系统依赖：

```bash
apt update
apt install -y ca-certificates curl gnupg git nginx ufw snapd
```

安装 Node.js 22、Corepack 和 PM2：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
corepack enable
corepack prepare pnpm@10 --activate
npm install -g pm2
node -v
corepack pnpm -v
pm2 -v
```

如果系统里没有直接的 `pnpm` 命令，后续统一使用 `corepack pnpm`。

## 3. 拉取项目

当前仓库地址：

```bash
mkdir -p /usr
git clone git@github.com:panda-three/storm-ai.git /usr/storm-ai
cd /usr/storm-ai
git checkout main
```

创建 PM2 需要的路径别名：

```bash
mkdir -p /var/www
ln -s /usr/storm-ai /var/www/storm-ai
```

如果 `/var/www/storm-ai` 已存在，先确认它是不是正确指向 `/usr/storm-ai`，不要随便删除真实项目目录。

## 4. 配置环境变量

创建生产环境文件：

```bash
cd /usr/storm-ai
cp .env.example .env.production
nano .env.production
```

生产环境至少需要检查这些变量：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_GENERATED_IMAGES_BUCKET`
- `CRON_SECRET`
- `YUNWU_API_KEY`
- `YUNWU_BASE_URL`
- `TOAPIS_API_KEY`
- `TOAPIS_BASE_URL`
- `APIMART_API_KEY`
- `APIMART_BASE_URL`
- `APIMART_SYNC_BATCH_SIZE`

重要注意：

- `.env.production` 和 `.env.local` 不能提交到 Git。
- `SUPABASE_SERVICE_ROLE_KEY` 只能放在服务端环境变量里。
- `CRON_SECRET` 建议至少 32 位随机字符串。
- 生产环境通常不要配置 `APIMART_PROXY_URL`。如果复制了本地配置，执行：

```bash
perl -0pi -e 's/^APIMART_PROXY_URL=.*$/APIMART_PROXY_URL=/m' .env.production
```

## 5. 准备 Supabase

如果使用 Supabase Cloud：

1. 打开生产项目的 SQL Editor。
2. 执行仓库里的完整 `supabase-schema.sql`。
3. 确认这些表存在：`generation_jobs`、`user_accounts`、`redeem_codes`、`model_pricing`、`credit_packages`、`site_settings`。
4. 确认这些 RPC 存在：`create_generation_job_with_billing`、`fail_generation_job_with_refund`、`spend_generation_credits`、`record_free_generation_usage`、`refund_generation_credits`、`redeem_credit_code`、`save_user_projects`。
5. 创建或确认 Storage bucket：默认是 `generated-images`，或者使用 `SUPABASE_GENERATED_IMAGES_BUCKET` 中配置的名字。
6. 生成图片需要能通过公开 URL 在浏览器访问，否则历史项目会看不到图片。

如果要切到自托管 Supabase，先看 [self-hosted-supabase.md](self-hosted-supabase.md)。不要在数据库、Storage、SMTP、备份和回滚都没验证前切换 `.env.production`。

## 6. 安装依赖并构建

当前生产机建议使用固定 pnpm store，避免 root 环境下 pnpm 路径不一致：

```bash
cd /usr/storm-ai
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm install --frozen-lockfile --store-dir /usr/storm-ai/.pnpm-store
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
```

如果 build 失败，不要继续启动或重启 PM2，先修复错误。

## 7. 启动 PM2

当前 `ecosystem.config.cjs` 使用：

```js
script: "corepack"
args: "pnpm start:production"
cwd: "/var/www/storm-ai"
```

启动并保存：

```bash
cd /usr/storm-ai
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root
```

`pm2 startup` 会打印一条 systemd 命令，按它输出的命令执行一次。然后检查：

```bash
pm2 status
curl -I http://127.0.0.1:3000
```

健康状态应为：

- PM2 中 `storm-ai` 是 `online`
- 本机 `3000` 返回 `200 OK`

## 8. 配置 Nginx

安装项目 Nginx 配置：

```bash
cp /usr/storm-ai/deploy/nginx/storm-ai.conf /etc/nginx/sites-available/storm-ai
ln -s /etc/nginx/sites-available/storm-ai /etc/nginx/sites-enabled/storm-ai
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

开放防火墙：

```bash
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw enable
ufw status
```

先验证 HTTP：

```bash
curl -I -H "Host: www.zlaction.online" http://127.0.0.1
curl -I http://www.zlaction.online
```

## 9. 配置 HTTPS

安装并执行 Certbot：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d www.zlaction.online --redirect
```

检查：

```bash
curl -I https://www.zlaction.online
systemctl is-enabled certbot.timer
```

如果证书申请失败，优先检查：

- DNS 是否指向 `107.173.25.225`
- 服务器 `80`、`443` 是否开放
- Nginx 是否能通过 `nginx -t`
- Cloudflare 代理模式是否影响 HTTP-01 验证

## 10. 配置生成任务定时同步

生成任务需要定时同步上游状态。推荐从服务器本机调用，避免外部 DNS 或 Cloudflare 异常影响同步：

```bash
crontab -e
```

添加：

```cron
* * * * * curl -fsS -X POST -H "Host: www.zlaction.online" -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1/api/cron/sync-generation-jobs >/dev/null 2>&1
```

手动测试时不要把密钥粘到聊天或截图里：

```bash
secret=$(grep -E '^CRON_SECRET=' /usr/storm-ai/.env.production | sed 's/^CRON_SECRET=//')
curl -fsS -X POST \
  -H "Host: www.zlaction.online" \
  -H "Authorization: Bearer ${secret}" \
  http://127.0.0.1/api/cron/sync-generation-jobs
```

返回里应包含：

```json
{"ok":true}
```

## 11. 最终验收

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

期望结果：

- PM2 `storm-ai` 为 `online`
- `127.0.0.1:3000` 返回 `200 OK`
- HTTPS 域名返回 `200 OK`
- Nginx 配置测试成功
- `pm2-root` 和 `certbot.timer` 已启用

## 常见问题

- `corepack pnpm build` 失败：先修 build，不要重启生产。
- 登录、点数、后台或历史失败：检查 Supabase schema/RPC 是否已执行。
- 图片上传成功但页面不显示：检查 Storage bucket 是否存在且公开 URL 可访问。
- `127.0.0.1:3000` 失败：看 `pm2 logs storm-ai --lines 100`。
- Nginx 失败但 3000 正常：看 `/var/log/nginx/error.log` 并运行 `nginx -t`。
- Cloudflare 返回 `521`：通常是 Nginx/443/证书问题。
- APIMart、ToAPIs、云雾接口失败：检查 `.env.production` 的 key、base url、服务器出口网络和代理配置。
