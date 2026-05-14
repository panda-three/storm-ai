# 自托管 Supabase 运维和迁移说明

这份文档说明如何理解、验证和迁移自托管 Supabase。它是基础设施迁移，不是普通代码发布。操作前一定要备份，且最好安排维护窗口。

## 先明确一件事

本项目不是只连一个普通 PostgreSQL 数据库。它依赖 Supabase 的这些能力：

- Auth 登录和用户表 `auth.users`
- PostgREST/RPC
- RLS 权限策略
- Storage 图片存储
- `auth.users` 触发器

所以不能简单把连接串换成普通 PostgreSQL，除非重新设计登录、权限和存储。

## 目标形态

- Next.js 仍由 PM2 运行在 `3000` 端口。
- Supabase API 使用独立域名，例如 `https://supabase.zlaction.online`。
- PostgreSQL、Supabase 内部服务、Studio 不直接暴露到公网。
- `.env.production` 在验证完成后再切换到自托管 Supabase 的 URL 和 key。

## 当前服务器上的自托管实例

服务器上已经安装了一套自托管 Supabase，目录：

```bash
/opt/supabase-storm
```

已知信息：

- Supabase API 计划域名：`https://supabase.zlaction.online`
- DNS 应指向：`107.173.25.225`
- 内部 Kong：`127.0.0.1:8000`
- 内部 Postgres：`127.0.0.1:5432`
- Nginx 配置：`/etc/nginx/sites-available/supabase-storm`
- 已应用应用 schema：`supabase-schema.sql`
- Storage bucket：`generated-images`

查看容器：

```bash
docker ps
```

检查本机 API：

```bash
curl -I http://127.0.0.1:8000
```

返回 `401 Unauthorized` 是正常信号，表示 API 在响应，只是没有带 key。

## 上线前必须完成的加固

1. 生成新的生产密钥：
   - Postgres 密码
   - JWT secret
   - anon key
   - service role key
   - Studio/dashboard 登录信息
2. 执行完整 `supabase-schema.sql`。
3. 确认 schema 末尾的授权正确：
   - 用户 RPC 只授权给 `authenticated` 或需要的 `anon`。
   - 服务端专用 RPC 撤销 `public`、`anon`、`authenticated` 权限，只授权给 `service_role`。
4. 创建 `generated-images` bucket，或与 `SUPABASE_GENERATED_IMAGES_BUCKET` 保持一致。
5. 生成图片对象必须能通过公开 URL 被浏览器读取。
6. 配置 SMTP，再允许真实用户使用邮件流程。
7. `SUPABASE_SERVICE_ROLE_KEY` 只能放服务端环境文件。
8. `CRON_SECRET` 至少 32 位，并优先从服务器本机调用 cron。
9. 配置数据库和 Storage 备份。

## DNS 和 HTTPS

先添加 DNS：

```text
supabase.zlaction.online  A  107.173.25.225
```

如果用 Cloudflare，申请证书前建议先用 DNS-only，或者确保 HTTP-01 验证能到达这台服务器。

DNS 生效后执行：

```bash
certbot --nginx -d supabase.zlaction.online --redirect
nginx -t
systemctl reload nginx
```

然后检查：

```bash
pnpm check:supabase:selfhosted
```

如果 DNS 没配好，这个检查会失败。检查通过前，不要切生产 `.env.production`。

## 迁移流程

建议流程：

1. 安排短维护窗口，避免最后导出时还有新写入。
2. 从旧 Supabase 导出：
   - `auth.users`
   - `public` schema 数据
   - `generated-images` bucket 中的 Storage 对象
3. 导入到自托管 Supabase。
4. 导入后再次执行 `supabase-schema.sql`，确保函数、触发器、策略、索引和授权一致。
5. 对比关键表行数：
   - `auth.users`
   - `public.user_accounts`
   - `public.credit_packages`
   - `public.redeem_codes`
   - `public.model_pricing`
   - `public.generation_jobs`
   - `public.site_settings`
6. 更新 `.env.production`：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_GENERATED_IMAGES_BUCKET`
7. 执行：

   ```bash
   XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm check:env
   XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
   pm2 restart storm-ai --update-env
   pm2 save
   ```

8. 验证：
   - 登录
   - 后台读取和保存
   - 点数扣费和退款
   - 生图/视频提交
   - 任务同步 cron
   - Storage 上传
   - 历史图片公开访问

## API 迁移脚本

如果旧 Supabase 的数据库直连密码拿不到，可以用仓库脚本迁移 API 可见数据：

```bash
pnpm migrate:supabase:public
pnpm migrate:supabase:public -- --apply
pnpm migrate:supabase:storage
pnpm migrate:supabase:storage -- --apply
```

说明：

- 不带 `--apply` 是 dry run，只预演。
- 带 `--apply` 才会写入自托管 Supabase。
- 迁移产物会输出到 `backups/supabase-migration/`。
- 如果创建了临时密码，会生成 `temporary-passwords.json`。
- `temporary-passwords.json` 是敏感文件，发给用户重置后要安全删除。

限制：

- Supabase Admin API 不暴露旧用户密码哈希。
- API 迁移无法保留用户原密码。
- 如果必须保留原密码，需要源 Supabase 的数据库级 dump。

## 备份和恢复

上线自托管后，备份是必须项：

- 每天加密备份 PostgreSQL。
- 备份生成图片 Storage 对象。
- 备份要复制到服务器外部。
- 保留足够时间，防止误删和坏迁移。
- 至少每月做一次恢复演练。

创建本地备份：

```bash
pnpm backup:supabase:selfhosted
```

默认输出到：

```bash
backups/supabase/
```

这个目录已被 Git 忽略。本地备份不等于生产备份，仍然要复制到服务器外部。

可以指定备份目录：

```bash
SUPABASE_BACKUP_DIR=/path/to/backup/root pnpm backup:supabase:selfhosted
```

## 回滚

迁移窗口内保留旧 Supabase Cloud 项目，不要马上删除。

如果验证失败：

1. 把 `.env.production` 恢复为旧 Supabase Cloud 的值。
2. 执行：

   ```bash
   XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm check:env
   XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
   pm2 restart storm-ai --update-env
   pm2 save
   ```

3. 确认网站恢复。
4. 暂停自托管切换，排查数据差异。

## 不要做的事

- 不要在没备份时切换生产 Supabase。
- 不要把自托管 Studio、Postgres 端口直接暴露公网。
- 不要把 service role key 放进前端变量。
- 不要把迁移出来的临时密码文件提交或发送到不安全渠道。
- 不要把旧 Supabase 项目立即删除，至少保留到新环境稳定运行并完成备份恢复演练。
