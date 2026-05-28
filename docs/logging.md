# 日志与故障排查指南

这份文档说明生产环境出问题时应该去哪里看日志、按什么顺序排查。生产项目目录是 `/usr/storm-ai`，PM2 应用名是 `storm-ai`。

## 1. 最快排查顺序

网站或生成任务出问题时，先执行这一组：

```bash
pm2 status
pm2 logs storm-ai --lines 100
tail -n 100 /var/log/nginx/error.log
curl -I http://127.0.0.1:3000
curl -I -H "Host: www.zlaction.online" http://127.0.0.1
curl -I https://www.zlaction.online
```

怎么看：

- PM2 不是 `online`：优先看 `pm2 logs storm-ai --lines 100`。
- `127.0.0.1:3000` 不通：Next.js 应用没正常跑。
- `127.0.0.1:3000` 通，但 Nginx 不通：看 Nginx 配置和错误日志。
- 本机都通，但公网 HTTPS 不通：看域名、Cloudflare、证书、Nginx 443。

## 2. 应用日志

Next.js 应用由 PM2 管理，名称是 `storm-ai`。

实时看日志：

```bash
pm2 logs storm-ai
```

只看最近 100 行：

```bash
pm2 logs storm-ai --lines 100
```

查看 PM2 进程详情：

```bash
pm2 status
pm2 describe storm-ai
```

直接看日志文件：

```bash
tail -n 100 /root/.pm2/logs/storm-ai-out.log
tail -n 100 /root/.pm2/logs/storm-ai-error.log
tail -f /root/.pm2/logs/storm-ai-error.log
```

常见关键词：

- `APIMart`：APIMart 生图或任务同步。
- `ToAPIs`：ToAPIs 生图或任务同步。
- `VectorEngine`：VectorEngine 生图。
- `Yunwu`：云雾图片/视频。
- `Generate Image`：生图提交接口。
- `Generate Video`：视频提交接口。
- `Sync`：定时任务同步。
- `Supabase`：数据库、Storage、Auth 相关问题。

## 3. Nginx 日志

访问日志：

```bash
tail -f /var/log/nginx/access.log
tail -n 100 /var/log/nginx/access.log
```

错误日志：

```bash
tail -f /var/log/nginx/error.log
tail -n 100 /var/log/nginx/error.log
```

检查 Nginx 状态和配置：

```bash
systemctl status nginx --no-pager
nginx -t
```

常见情况：

- `connect() failed`：Nginx 连不上 `127.0.0.1:3000`，通常是 PM2 应用没跑。
- `certificate` 相关错误：看 Certbot 和证书配置。
- Cloudflare `521`：通常是源站 443/Nginx/证书不可用。

## 4. HTTPS 和证书日志

查看 Certbot 日志：

```bash
tail -n 100 /var/log/letsencrypt/letsencrypt.log
tail -f /var/log/letsencrypt/letsencrypt.log
```

检查自动续期：

```bash
systemctl status certbot.timer --no-pager
systemctl is-enabled certbot.timer
```

手动检查 HTTPS：

```bash
curl -I https://www.zlaction.online
```

## 5. 定时任务日志和检查

当前生成任务同步 cron 默认把输出丢弃：

```cron
* * * * * curl -fsS -X POST -H "Host: www.zlaction.online" -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1/api/cron/sync-generation-jobs >/dev/null 2>&1
```

查看已安装的 cron，并隐藏密钥：

```bash
crontab -l | sed 's/Bearer [^\"]*/Bearer ***REDACTED***/'
```

手动测试同步接口：

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

如果是 `401`，说明 `CRON_SECRET` 不对。如果是 `500`，看 PM2 错误日志。

## 6. Supabase 检查

本机自托管 Supabase 如果在用，可以看容器状态：

```bash
docker ps
```

当前常见容器名：

- `supabase-db`
- `supabase-kong`
- `supabase-auth`
- `supabase-storage`
- `supabase-rest`
- `supabase-studio`

检查本机 Supabase API：

```bash
curl -I http://127.0.0.1:8000
```

返回 `401 Unauthorized` 是正常的，表示 Kong/API 在响应，只是没有带 key。

进入数据库执行只读检查：

```bash
docker exec -it supabase-db psql -U postgres -d postgres
```

不要在不清楚影响的情况下执行删除、更新或重置命令。

## 7. 看生产环境变量

不要直接把 `.env.production` 全量贴出来。只检查变量是否存在：

```bash
awk -F= '/^(APIMART|TOAPIS|YUNWU|NEXT_PUBLIC_SUPABASE|SUPABASE|CRON_SECRET)/ {print $1"=<set>"}' /usr/storm-ai/.env.production
```

如果要检查 `CRON_SECRET` 是否一致，不要输出原文，可以看长度或哈希。

## 8. 常见故障对照

| 现象 | 优先检查 |
|---|---|
| 网站打不开 | `pm2 status`、`curl -I http://127.0.0.1:3000`、Nginx 日志 |
| HTTPS 报错 | `nginx -t`、Certbot 日志、Cloudflare DNS |
| 登录失败 | Supabase URL/key、Auth 服务、PM2 日志 |
| 点数或后台失败 | Supabase RPC、RLS、service role key |
| 生图提交失败 | `/api/generate/image` 日志、上游 key、价格配置 |
| 历史项目不更新 | cron 路由、`generation_jobs` 状态、同步日志 |
| APIMart/ToAPIs 图片不显示 | 上游任务状态、图片 URL 转存、Storage 公开访问 |
