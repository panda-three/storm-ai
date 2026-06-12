# 生产服务器磁盘巡检和清理记录

这份文档沉淀 2026-06-09 对生产服务器磁盘、内存和日志情况的排查结论，以及后续可以复用的清理方法。当前生产服务器 IP 是 `107.173.25.225`。

## 当前状态摘要

截图里的系统状态整体正常：

- 运行时间：约 `104` 天。
- CPU：约 `18%`，当前压力不高。
- 内存：约 `3.8G / 7.8G`，使用率约 `50%`。
- Swap：约 `1.6G / 4G`，使用率约 `40%`，需要关注是否有内存峰值或长期进程占用。
- 根分区：`144G` 总量，清理 release 后约 `58G` 已用、`79G` 可用，使用率约 `43%`。

截图里很多 `/var/lib/docker/rootfs/overlayfs/...` 是容器 overlay 挂载层重复显示，不代表每一项都单独占用 `144G`。

## 主要磁盘占用来源

实际排查到的主要大目录：

| 路径 | 大小 | 说明 |
|---|---:|---|
| `/var/lib/containerd` | 约 `11G` | Docker/containerd 镜像层、快照和内容缓存。 |
| `/opt/supabase-storm/volumes/storage` | 约 `8.5G` | Supabase Storage，主要是 `generated-images`、`canvas-assets`、`canvas-thumbnails`。 |
| `/opt/supabase-storm/volumes/db/data` | 约 `4.1G` | 自托管 Supabase/Postgres 数据库数据目录。 |
| `/usr/storm-ai/backups` | 约 `4.3G` | Supabase 备份，包含较大的 `storage.tar.gz`。 |
| `/var/www/storm-ai-releases` | 清理前约 `5.4G`，清理后约 `2.8G` | 每次生产发布生成的独立 release 目录。 |
| `/var/log/journal` | 约 `4.0G` | systemd journal 持久化系统日志。 |

磁盘可用空间持续下降的主要原因是生产数据和历史产物自然累积，尤其是 Supabase Storage 中的用户生成图片。部分单张生成图可达到十几 MB，用户生成越多，Storage 占用会继续增长。

## Release 目录清理

生产服务通过 `/var/www/storm-ai` symlink 指向当前 release：

```bash
readlink -f /var/www/storm-ai
```

发布目录位于：

```bash
/var/www/storm-ai-releases
```

2026-06-09 已执行一次清理：保留最近 3 个 release，删除更旧目录。

清理前：

- `/var/www/storm-ai-releases`：约 `5.4G`
- 根分区：约 `61G` 已用、`76G` 可用

清理后：

- `/var/www/storm-ai-releases`：约 `2.8G`
- 根分区：约 `58G` 已用、`79G` 可用
- PM2 `storm-ai` 保持 `online`
- `http://127.0.0.1:3000` 返回 `200 OK`

以后需要清理旧 release 时，先预览：

```bash
readlink -f /var/www/storm-ai
ls -dt /var/www/storm-ai-releases/*
ls -dt /var/www/storm-ai-releases/* | tail -n +4
```

确认只会删除旧 release 后，再执行：

```bash
ls -dt /var/www/storm-ai-releases/* | tail -n +4 | xargs -r rm -rf
```

清理后验证：

```bash
df -h /
du -sh /var/www/storm-ai-releases
ls -ldt /var/www/storm-ai-releases/*
readlink -f /var/www/storm-ai
pm2 status
curl -I http://127.0.0.1:3000
```

注意：

- 不要删除 `/var/www/storm-ai`，它是当前服务 symlink。
- 不要删除 `/var/www/storm-ai-static`，它保存旧、新 `/_next/static` 静态资源，用于避免旧页面 chunk 404。
- 默认保留最近 3 个 release；如果只保留最近 2 个，把 `tail -n +4` 改成 `tail -n +3`。

## systemd journal 是什么

`/var/log/journal` 是 systemd journal 的持久化日志目录，保存系统和服务日志，例如：

- 系统启动、关机、内核日志。
- `systemd` 管理的服务日志。
- Nginx、Docker、PM2 相关服务输出。
- SSH 登录、定时任务、错误告警等系统事件。

常用查看命令：

```bash
journalctl
journalctl -u nginx
journalctl -u docker
journalctl -p err
journalctl --since "1 hour ago"
journalctl --disk-usage
```

journal 不是业务核心数据，可以限制大小或清理旧日志。不要直接 `rm -rf /var/log/journal`，优先使用 `journalctl --vacuum-*` 或 journald 配置。

建议将 journal 上限设为 `1G`：

```ini
SystemMaxUse=1G
SystemKeepFree=5G
MaxRetentionSec=30day
```

推荐用 drop-in 配置，不直接改主配置：

```bash
mkdir -p /etc/systemd/journald.conf.d
cat >/etc/systemd/journald.conf.d/storm-ai-disk-limit.conf <<'EOF'
[Journal]
SystemMaxUse=1G
SystemKeepFree=5G
MaxRetentionSec=30day
EOF
systemctl restart systemd-journald
journalctl --vacuum-size=1G
journalctl --disk-usage
```

含义：

- `SystemMaxUse=1G`：journal 最多使用约 `1G`。
- `SystemKeepFree=5G`：尽量保证磁盘至少保留 `5G` 空间。
- `MaxRetentionSec=30day`：最多保留 30 天日志。

## 后续建议

- 给 Supabase Storage 制定保留策略，例如过期生成任务的结果图是否自动删除。
- 发布目录保留最近 2-3 个 release，旧 release 定期清理。
- 给 systemd journal 设置上限，避免日志无限增长。
- 定期清理不用的 Docker/containerd 镜像层。
- Supabase 备份保留最近几份，旧备份转移到对象存储或其他服务器。
- 每月检查一次 `df -h /`、`du -sh /opt/supabase-storm/volumes/storage`、`du -sh /var/www/storm-ai-releases` 和 `journalctl --disk-usage`。
