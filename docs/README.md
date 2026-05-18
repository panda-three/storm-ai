# Storm AI 文档入口

这个目录里放的是部署、发布、日志、费用和排查文档。你日常最常用的是前四个。

## 你应该先看哪一份

| 场景 | 文档 |
|---|---|
| 第一次在新服务器部署 | [linux-deployment.md](linux-deployment.md) |
| 平时把新代码发布到生产 | [manual-release.md](manual-release.md) |
| 本地和服务器都可能改代码，如何避免版本打架 | [git-sync-workflow.md](git-sync-workflow.md) |
| 网站或生成任务出问题，看日志 | [logging.md](logging.md) |
| 查看当前服务器实际信息 | [server-deployment-runbook.md](server-deployment-runbook.md) |
| 了解后续费用、续费、开支检查 | [operations-costs.md](operations-costs.md) |
| 准备迁移或维护自托管 Supabase | [self-hosted-supabase.md](self-hosted-supabase.md) |

## 当前生产环境一句话说明

当前网站 `https://www.zlaction.online` 跑在服务器 `107.173.25.225` 上，项目目录是 `/usr/storm-ai`，由 PM2 管理 Next.js 服务，Nginx 负责 HTTPS 入口。

生成任务依赖：

- 云雾
- ToAPIs
- APIMart
- Supabase 数据库和 Storage
- 每分钟执行一次的 cron 同步任务

## 日常发布最短流程

只要代码已经推到 GitHub，通常按这份文档执行：

[manual-release.md](manual-release.md)

核心命令是：

```bash
cd /usr/storm-ai
git pull origin main
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm install --frozen-lockfile --store-dir /usr/storm-ai/.pnpm-store
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

## 出问题时最短排查流程

看这份文档：

[logging.md](logging.md)

核心命令是：

```bash
pm2 status
pm2 logs storm-ai --lines 100
tail -n 100 /var/log/nginx/error.log
curl -I http://127.0.0.1:3000
curl -I https://www.zlaction.online
```

## 文档维护原则

- 生产服务器真实情况以 [server-deployment-runbook.md](server-deployment-runbook.md) 为准。
- 日常发布步骤以 [manual-release.md](manual-release.md) 为准。
- 不要把 `.env.local`、`.env.production`、API Key、数据库密码写进文档。
- 命令里出现 `<CRON_SECRET>`、`<GOOD_COMMIT_SHA>` 这种尖括号内容时，表示需要替换成你自己的真实值。
