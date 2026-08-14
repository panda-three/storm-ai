# 交接：数字画布（digital-canvas）

这份文档用于新会话快速接手数字画布，避免重新把代码库探索一遍。开新会话时把这份文档给对方读一遍即可。

## Context

在现有 Storm AI 项目上新增了「数字画布」：一个节点工作流式的 AI 创作画布（节点带输入/输出端口、可连线），参考站为 `http://118.89.78.236/`，需求见 `docs/digital-canvas-dev-plan.md`。

它和已有的「无限画布」`canvas-lab` 是**两套独立功能，互不影响**：路由、组件目录、数据表全部分开，只共用底层的生成、计费、鉴权接口。

P0 已完成并验证通过：侧边栏入口、React Flow 画布、文字/图片/AI 绘图节点、连线出图、保存加载。之后又扩展了便签节点、生成历史面板、快捷渲染面板、蒙版编辑器。

## Current state

已完成：

- 侧边栏新增「数字画布」入口，指向 `/digital-canvas`（`components/sidebar.tsx` 第 74 行附近）。
- React Flow 画布可用：缩放、平移、小地图、连线、节点拖拽。
- 节点类型：文字、图片、AI 绘图、便签。
- AI 绘图节点会收集上游节点的文字和图片作为提示词与参考图，调用现有生成接口出图。
- 画布数据持久化到新表 `digital_canvas_documents`，跨刷新可恢复。
- 快捷渲染面板、生成历史面板、蒙版编辑器已就位。
- `pnpm lint` 和 `pnpm build` 通过，浏览器实测端到端出图成功，硬刷新后控制台无报错无警告。
- 最后一次修复已提交为 `ecde0ca`，并已 rebase 到当时的 `origin/main`。

## 必须知道的坑（都是踩过的）

1. **`imageModelOptions` 是字符串数组，不是对象数组。**
   写成 `option.value` 会拿到 `undefined`，导致 model 变成空字符串，进而
   `imageModelSettings[""].ratios` 读取 undefined 属性、整页崩溃，同时还会触发
   React key 缺失警告。这是本次唯一的线上级 bug，根因就在这里。

2. **Supabase 是自托管的，不能程序化建表。**
   实例只暴露 PostgREST 加 service role，没有 Postgres 直连串，也没有 `exec_sql` 之类的 RPC，
   所以 DDL 跑不了。新表必须人工在 Supabase SQL 编辑器里执行 SQL 文件，
   和 `supabase-schema.sql` 一样的流程。CRUD 走 PostgREST 没问题。
   当前实例的 `digital_canvas_documents` 已存在且读写正常；换实例时才需要重新执行
   `scripts/digital-canvas-schema.sql`。运维细节见 `docs/self-hosted-supabase.md`。

3. **本仓库没有启用 Next 的 ESLint 插件。**
   写 `// eslint-disable-next-line @next/next/no-img-element` 这类注释会让
   `pnpm lint` 直接失败，报规则未定义。仓库里有十来个文件用 `<img>`，都不加这种注释，跟着这个约定就行。

4. **报错先怀疑编译产物过期。**
   会话里出现过一次 `modeLead is not defined`，但磁盘上的源码是对的，
   属于 dev server 的过期产物（overlay 会标 stale）。重启 dev server 即恢复，不要去改代码。
   同理，`nodeTypes` 重建的警告也可能是 HMR 残留，硬刷新后如果消失就不是真问题。
   注意不要删 `.next`。

5. **React 严格模式下初始化 effect 会跑两次。**
   直接在 effect 里「没有画布就创建一个」会创建出两条空白画布。
   现在的解法是在 `canvas-workspace.tsx` 里用模块级 promise 缓存
   （`resolveInitialCanvas`）去重。不要改成用 ref 挡住整个加载流程，那会让第二次挂载永远停在加载中。

6. **不要恢复保存的 viewport。**
   试过把保存的 `viewport` 用 `defaultViewport` 还原，结果旧的过大缩放和平移会把节点顶出可视区。
   现在统一用 `fitView` 加 `fitViewOptions`（`maxZoom: 1`），更稳。

7. **截图里的方框是无头浏览器缺中文字体**，不是页面问题，别当 bug 修。

## Key files

数字画布自己的代码：

- `app/digital-canvas/page.tsx` - 路由入口。
- `components/digital-canvas/digital-canvas-shell.tsx` - 登录门禁，复用 `useAccountSession` 加 `AuthPanel`。
- `components/digital-canvas/canvas-workspace.tsx` - 画布主体，React Flow、工具栏、保存加载、节点放置逻辑。
- `components/digital-canvas/nodes/` - 文字、图片、AI 绘图、便签节点。
- `components/digital-canvas/panels/` - 快捷渲染面板、生成历史面板、图片槽位、蒙版编辑器。
- `lib/digital-canvas/types.ts` - 画布图数据结构。
- `lib/digital-canvas/api.ts` - 客户端封装：画布增删改查、提交生成、轮询任务、上传参考图。
- `lib/digital-canvas/prompt-composer.ts` - 提示词组装。
- `lib/digital-canvas/render-params.ts` - 渲染参数体系。
- `lib/digital-canvas-documents.ts` - 服务端持久化，按 `user_id` 归属加软删除。
- `app/api/digital-canvas-documents/route.ts` 和 `[id]/route.ts` - 画布读写接口。
- `scripts/digital-canvas-schema.sql` - 建表加 RLS，这张表唯一的迁移定义，需人工执行。

复用的既有能力，不要重复实现：

- `app/api/generate/image/route.ts` - 生图，支持 FormData 直传参考图文件。
- `app/api/tasks/[id]/route.ts` - 任务状态轮询。
- `app/api/uploads/reference-image/route.ts` - 参考图上传，FormData 字段名是 `file`，返回结构即 `StoredReferenceImage`。
- `lib/canvas-lab-api.ts` - 现成的「提交生成加轮询」客户端封装，数字画布直接复用。
- `lib/model-options.ts` - 模型、比例、清晰度选项。默认图片模型 `gemini-3.1-flash-image-preview`。
- `lib/server-supabase.ts` - `requireAuthenticatedUser` 返回 `{ userId }`，以及 service role client。
- `lib/reference-images.ts` - 参考图元数据与路径工具。
- `app/globals.css` - React Flow 的样式在这里统一 `@import`，不要在组件里再导一次。

参考文档：

- `docs/digital-canvas-dev-plan.md` - 分阶段开发计划、节点系统详表、数据模型、验收标准。
- `docs/self-hosted-supabase.md` - 自托管 Supabase 运维。
- `docs/git-sync-workflow.md` - 提交前的同步要求。

## Next steps

`docs/digital-canvas-dev-plan.md` 里 P1 之后的内容还没做，按那份计划继续即可。重点差异化是快捷渲染面板的完整参数体系、提示词自动组装、整图重绘与局部精修。

改完之后按仓库规范收尾：

1. `pnpm lint`
2. `pnpm build`
3. 浏览器实测一遍出图闭环，别只看编译通过。
4. 提交前确认没落后 `origin/main`，需要时 `git pull --rebase origin main`。
