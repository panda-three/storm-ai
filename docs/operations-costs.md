# 费用、续费和开支检查清单

这份文档帮你知道 Storm AI 后续哪些地方可能产生费用、需要续费，或者需要定期检查。它不包含真实密钥和账单金额。

## 主要费用来源

| 项目 | 用途 | 谁会影响费用 |
|---|---|---|
| VPS 服务器 | 运行 Next.js、Nginx、PM2、自托管 Supabase 容器 | 网站持续在线、生成任务同步、数据库服务 |
| 域名 | `zlaction.online` 和子域名 | 年度续费 |
| Cloudflare | DNS、CDN、HTTPS 代理能力 | 一般免费，是否付费看你开通的套餐 |
| Supabase Cloud | 数据库、Auth、Storage，如果仍在使用 Cloud 项目 | 用户数、数据库容量、Storage、请求量 |
| 自托管 Supabase | 如果切到本机容器，费用主要落在 VPS 和备份存储 | 数据库、Storage、备份、服务器资源 |
| APIMart | `image2-M通道` 生图 | 用户生成次数、清晰度、上游定价 |
| ToAPIs | `image2-Toa通道` 生图 | 用户生成次数、清晰度、张数 |
| 云雾 | Gemini/GPT 图片和视频通道 | 用户生成次数、视频时长、清晰度 |
| 备份存储 | 数据库和图片备份 | 备份频率、保留时间、图片数量 |

## 每月建议检查

1. 服务器是否到期或资源不足。
2. 域名是否快到期。
3. Cloudflare DNS 是否仍指向正确服务器。
4. Supabase 用量是否接近套餐限制。
5. APIMart、ToAPIs、云雾余额或账单是否正常。
6. 生成任务是否有大量失败或卡住。
7. Storage 图片容量是否增长过快。
8. 备份是否真的生成，并且能从服务器外部拿到。

## 服务器检查

```bash
pm2 status
df -h
free -h
docker ps
```

怎么看：

- `df -h`：磁盘快满时要尽快处理，图片和数据库备份最容易占空间。
- `free -h`：内存长期很低时，可能需要升级服务器或减少容器。
- `docker ps`：如果自托管 Supabase 在用，容器应保持运行。

## 生成任务和上游费用检查

后台需要重点看：

- 模型价格配置是否覆盖所有上架模型和清晰度。
- 用户点数扣费是否符合预期。
- 是否有大量失败退款。
- 是否有大量 `submitted` / `processing` 长时间不结束。

服务器可以手动触发同步检查：

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

## APIMart 费用注意

当前 `image2-M通道` 使用 APIMart 非官方 `gpt-image-2`：

- 固定单张生成。
- 请求里显式设置 `official_fallback: false`。
- 不使用 `gpt-image-2-official`，避免误走更贵接口。

如果以后要支持多张，不能直接传 `n: 4`。需要设计“一个用户任务对应多个 APIMart 上游任务”，否则容易计费和同步混乱。

## Supabase 费用注意

如果仍使用 Supabase Cloud：

- 注意数据库容量。
- 注意 Storage 容量。
- 注意 Auth 用户数。
- 注意 API 请求量。

如果切到自托管 Supabase：

- Supabase Cloud 费用会下降或取消，但 VPS、备份、维护成本会上升。
- 必须有离线备份。
- 必须定期做恢复演练。

## 备份费用注意

备份至少包括：

- PostgreSQL 数据库。
- 生成图片 Storage。
- 关键环境变量的安全备份。

本地备份命令：

```bash
pnpm backup:supabase:selfhosted
```

本地备份不够安全，必须复制到服务器外部，例如对象存储、另一台服务器或可信备份服务。

## 不要为了省钱做的事

- 不要关闭数据库备份。
- 不要把生产数据库和图片只保存在一台服务器上。
- 不要把 `SUPABASE_SERVICE_ROLE_KEY` 放到前端。
- 不要删除旧 Supabase 项目，除非新环境已经稳定并验证过恢复。
- 不要为了减少上游费用而静默切换用户选择的模型或清晰度。

## 续费提醒建议

建议单独在日历里设置提醒：

- 域名到期前 30 天。
- VPS 到期前 15 天。
- 上游 API 余额低于安全线时。
- Supabase 套餐或账单周期开始前。
- 证书通常由 Certbot 自动续期，但每月可以检查一次：

```bash
systemctl status certbot.timer --no-pager
certbot certificates
```
