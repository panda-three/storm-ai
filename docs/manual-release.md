# 手动发布指南

这份文档用于“代码已经提交到 GitHub，需要把生产环境更新到最新版”的场景。当前生产项目目录是 `/usr/storm-ai`。

## 发布前检查

登录服务器后先执行：

```bash
cd /usr/storm-ai
git status --short
git branch --show-current
pm2 status
curl -I https://www.zlaction.online
```

继续发布前要确认：

- 当前分支是 `main`。
- `git status --short` 没有你看不懂的本地改动。
- PM2 里 `storm-ai` 当前是 `online`，除非你正在修故障。
- 网站 HTTPS 至少能正常响应。

如果服务器上有意外本地改动，不要直接 `git pull`。先找开发人员确认这些改动是否要提交、保留或丢弃。

如果这次是你刚刚在服务器上直接修过代码，先按 [git-sync-workflow.md](git-sync-workflow.md) 把修复提交并推送到 GitHub，再继续发布。

## 标准发布流程

现在推荐直接执行：

```bash
cd /usr/storm-ai
./scripts/deploy-production.sh
```

它会依次完成环境检查、构建、PM2 重启、保存进程列表和本机健康检查。

如果你想手动拆开执行，旧流程仍然可用：

```bash
cd /usr/storm-ai
git pull origin main
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm install --frozen-lockfile --store-dir /usr/storm-ai/.pnpm-store
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

如果 `pnpm build` 失败，停止发布，不要执行 PM2 重启。

## 发布后检查

```bash
pm2 status
curl -I http://127.0.0.1:3000
curl -I -H "Host: www.zlaction.online" http://127.0.0.1
curl -I https://www.zlaction.online
nginx -t
```

健康结果：

- PM2 里 `storm-ai` 是 `online`。
- `http://127.0.0.1:3000` 返回 `200 OK`。
- 本机 Nginx 代理返回 `200 OK` 或符合预期的跳转。
- `https://www.zlaction.online` 返回 `200 OK`。
- `nginx -t` 显示配置正确。

## 环境变量变更时

如果 `.env.local` 的内容要同步成生产配置：

```bash
cd /usr/storm-ai
cp .env.local .env.production
perl -0pi -e 's/^APIMART_PROXY_URL=.*$/APIMART_PROXY_URL=/m' .env.production
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

注意：

- `.env.production` 不能提交到 Git。
- `NEXT_PUBLIC_*` 变量会进入浏览器包，改了以后必须重新 build。
- 生产环境通常不要设置本地代理地址，例如 `127.0.0.1:7890`。

## 数据库结构变更时

如果本次发布改了 `supabase-schema.sql`，尤其是表、索引、RLS、RPC 函数：

1. 先备份或确认可回滚。
2. 在生产 Supabase 执行对应 SQL。
3. 确认 SQL 没有报错。
4. 再执行标准发布流程。
5. 发布后测试登录、后台、点数、生成任务、历史项目。

不要先部署会调用新 RPC 的代码，再补数据库函数。这样线上请求会直接报错。

如果只是新增或重建索引，一般不会影响数据，但仍建议在访问低峰执行。

## 生成任务同步检查

改动过生图、视频、APIMart、ToAPIs、云雾、Supabase 服务端逻辑后，手动检查 cron 路由：

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

返回 `401` 表示 `CRON_SECRET` 不匹配。返回 `500` 就看 PM2 日志。

## 回滚流程

先查看最近提交：

```bash
cd /usr/storm-ai
git log --oneline -5
```

临时回滚到某个已知可用版本：

```bash
git checkout <GOOD_COMMIT_SHA>
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm install --frozen-lockfile --store-dir /usr/storm-ai/.pnpm-store
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

回滚后检查：

```bash
pm2 status
curl -I https://www.zlaction.online
pm2 logs storm-ai --lines 100
```

问题修好后回到主分支：

```bash
git checkout main
git pull origin main
```

注意：如果本次发布包含数据库结构变更，代码回滚不一定等于数据库回滚。数据库回滚要单独评估。

## 常用排查命令

```bash
pm2 logs storm-ai --lines 100
tail -n 100 /var/log/nginx/error.log
nginx -t
systemctl status nginx --no-pager
```

完整日志说明见 [logging.md](logging.md)。
