# 本地和服务器双端改代码时的 Git 同步规则

这个项目允许两种工作方式：

- 在本地开发后推送到 GitHub。
- 在 Linux 服务器上紧急修复后推送到 GitHub。

为了避免两边各自保留一份不同代码，GitHub 上的 `origin/main` 必须始终作为唯一真相源。任何一端开始工作前先同步，任何一端修完后尽快推送。

## 第一次启用

本地仓库和 Linux 服务器仓库都要各执行一次：

```bash
cd /项目目录
sh scripts/install-git-hooks.sh
```

当前生产服务器对应命令：

```bash
cd /usr/storm-ai
sh scripts/install-git-hooks.sh
```

执行后会把仓库的 Git hooks 路径设置为 `.githooks`。以后仓库里的 `pre-commit` 和 `pre-push` 会自动生效。

## hooks 会拦住什么

当你在 `main` 分支执行 `git commit` 或 `git push` 时，hooks 会先自动运行：

```bash
git fetch origin main
```

然后检查当前 `main` 是否落后于 `origin/main`：

- 没落后：允许继续。
- 落后了：拒绝提交或推送，并提示先执行 `git pull --rebase origin main`。
- 无法连接 GitHub、SSH 权限异常、远程分支不存在：也会拒绝继续，避免你在无法确认版本状态时继续改。

hooks 只保护 `main`。如果你以后使用功能分支，分支提交不会被这套规则拦住。

## 本地正常开发

开始工作前：

```bash
git pull --rebase origin main
```

改完以后：

```bash
git status
git add .
git commit -m "你的提交说明"
git push origin main
```

也可以用仓库脚本一次完成同步检查、提交和推送：

```bash
pnpm commit:push -- "你的提交说明"
```

只提交指定文件时，把路径追加到提交说明后面：

```bash
pnpm commit:push -- "Add production deploy script" package.json scripts/deploy-production.sh docs/manual-release.md
```

如果服务器刚刚有修复已经推到 GitHub，`git commit` 会先被 hook 拦下。按提示执行：

```bash
git pull --rebase origin main
```

处理完可能出现的冲突后，再重新提交和推送。

## 服务器上紧急修复

开始修复前：

```bash
cd /usr/storm-ai
git pull --rebase origin main
```

修复完成后立刻提交并推送：

```bash
git status
git add .
git commit -m "Fix production issue"
git push origin main
```

然后再执行正常发布流程：

```bash
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm install --frozen-lockfile --store-dir /usr/storm-ai/.pnpm-store
XDG_DATA_HOME=/usr/storm-ai/.pnpm-data corepack pnpm build
pm2 restart storm-ai --update-env
pm2 save
```

修完线上问题后不要只留在服务器本地。只要没有 `git push origin main`，你的本地电脑就拿不到这次修复。

## 每天最少记住的四句话

1. 开始改代码前先 `git pull --rebase origin main`。
2. 谁先修完，谁先 `git push origin main`。
3. 服务器修完问题后，也必须 commit 和 push。
4. 看到 hook 拦截时，不要跳过，先按提示同步。
