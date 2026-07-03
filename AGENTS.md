# 仓库指南

## 项目结构与模块组织

这是一个使用 Next.js 16、TypeScript、React 19、Tailwind CSS 4 和 shadcn-style UI components 的应用。App routes 和顶层 layouts 位于 `app/`；当前主页面是 `app/page.tsx`，全局样式在 `app/globals.css`。可复用的功能组件放在 `components/`，生成的或共享的基础组件放在 `components/ui/`。Hooks 位于 `hooks/`，辅助函数位于 `lib/`，SVG placeholders 和 icons 等静态资源位于 `public/`。`@/*` 路径别名映射到仓库根目录。

## 构建、测试与开发命令

请使用 pnpm，因为本仓库包含 `pnpm-lock.yaml`。

- `pnpm install`: 安装依赖。
- `pnpm dev`: 启动本地 Next.js 开发服务器。
- `pnpm build`: 创建生产构建，并捕获框架或类型集成问题。
- `pnpm start`: 在 `pnpm build` 之后运行生产构建。
- `pnpm lint`: 对项目运行 ESLint。

## 编码风格与命名约定

编写 TypeScript 和 TSX 时要以严格类型检查为前提。优先使用函数式 React components、hooks，以及现有的 `@/` imports。组件和工具文件名保持小写并使用连字符，例如 `chat-message.tsx` 和 `use-mobile.ts`。组件导出使用 PascalCase；hooks 应以 `use` 开头。遵循现有风格：两个空格缩进、不使用分号、使用双引号，并用 Tailwind utility classes 编写样式。添加自定义 UI patterns 之前，优先使用 `lucide-react` icons 和现有的 `components/ui/` primitives。

## 测试指南

当前尚未配置 test runner。添加测试前，请先引入项目级脚本，例如 `pnpm test`，并记录所选框架。针对 React behavior，优先使用与代码放在一起的测试文件，命名为 `*.test.tsx` 或 `*.spec.tsx`；针对 utilities，使用 `*.test.ts`。打开 pull request 前，至少运行 `pnpm lint` 和 `pnpm build`。

## Commit 与 Pull Request 指南

此目录当前尚未初始化为 Git repository，因此没有项目历史可用于推断 commit conventions。请使用简洁的祈使句 commit subjects，例如 `Add chat input loading state` 或 `Fix sidebar mobile toggle`。Pull requests 应包含简短摘要、验证步骤、适用时关联的 issues，以及针对可见 UI changes 的 screenshots 或 screen recordings。

## Git 同步工作流

这个项目可能会同时从本地机器和 production Linux server 编辑。请将 `origin/main` 视为唯一可信来源。

- 在 `main` 上 commit 或 push 之前，先确认当前 checkout 没有落后于 `origin/main`。
- 在任一机器开始工作前，只要 working tree 允许，优先运行 `git pull --rebase origin main`。
- 在 Linux server 上进行的任何 production hotfix 都必须及时 commit 并 push 到 `origin/main`，以便本地 checkout 能接收。
- 使用通过 `sh scripts/install-git-hooks.sh` 安装的 repository hooks；不要绕过同步相关的 hook failures。
- 当被要求在此 repo 中 commit changes 时，先检查哪些 changes 已经存在，避免包含无关的 user edits，验证同步状态，然后只 commit 目标工作。
- 详细操作流程位于 `docs/git-sync-workflow.md`。

## 安全与配置提示

不要把 secrets 放进 source files，只 commit 安全的默认值。使用 `.env.local` 存放 local environment variables，并只记录必需 keys，不记录 values。除非框架要求，否则不要编辑生成的 Next.js 文件，例如 `next-env.d.ts`。


## 代码检索

检索优先级：LSP → rg → 小范围读文件

**1. LSP（精确符号操作）**

修改代码前优先用 LSP：
- `documentSymbol` → 文件结构概览，替代读全文
- `goToDefinition` / `findReferences` → 精确到行的符号定位
- `hover` → 类型签名
- `getDiagnostics` → 快速看当前文件诊断

LSP 冷启动失败后等 3 秒重试一次。不要臆造当前会话里没有暴露的 LSP 工具。

**2. rg（文本搜索）**

路由字符串、配置 key、错误消息、环境变量、非代码文件。

**3. git / 小范围读文件**

- `git` 看状态、分支、提交、diff
- 只精读前面工具定位到的行范围，不读全文

## 开发管线

按场景路由到对应 skill，不要跳步：

| 场景              | 做什么                                                   |
| --------------- | ----------------------------------------------------- |
| 新功能 / 新想法       | `/grill-with-docs` → `/to-prd` → TDD 编码               |
| 想先看看效果          | `/prototype`（grill 之后、to-prd 之前）                      |
| 需求大，想并行         | `/to-issues` 垂直切片 → 多窗口并行                             |
| 代码写完了           | `/thermo-nuclear-code-quality-review` → `/e2e-verify` |
| 验证不通过           | `/bugfix`，修完回 `/e2e-verify`                           |
| 上线前手测           | `/functional-test`                                    |
| Bug / 报错 / 性能退化 | `/bugfix`                                             |
| 上下文快满           | `/handoff`                                            |
| 想改善代码结构         | `/improve-codebase-architecture`                      |
|                 |                                                       |

