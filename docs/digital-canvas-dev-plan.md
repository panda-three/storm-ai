# 数字画布（Digital Canvas）开发文档

> 目标：在当前 Storm AI 项目中新增一个「数字画布」入口，点击后进入一个**节点式无限画布 AI 设计工作台**，
> 1:1 复刻参考画布 http://118.89.78.236（KAKA-Design）的核心功能。
> 依据：`user_read_only_context/text_attachments/PRD-bS2Ey.md`（参考站逆向 PRD）+ 参考站实际交互 + 本仓库现有能力。

---

## 0. 一句话结论

- 参考站是「**无限画布 + 节点工作流**」形态（节点带输入/输出端口、可连线组合），与本仓库现有的**创作台（表单式生成）**和 **canvas-lab（Excalidraw 空间整理）** 都不同。
- 因此新建**独立路由 `/digital-canvas`**、独立组件目录、独立持久化表，**与 `canvas-lab` 完全隔离、互不影响**（仅共用底层生成/计费/鉴权 API）。
- 画布引擎选 **React Flow（`@xyflow/react`）**，因为它天然支持带类型端口的节点 + 连线，正好匹配参考站的节点工作流；不要用 Excalidraw 硬改。

---

## 1. 与现有代码的关系

### 1.1 现有三块形态对比

| 形态 | 路由/入口 | 技术 | 说明 |
|---|---|---|---|
| 创作台 | `/`（`app/page.tsx` → `Sidebar` + `ChatArea`，`section=image/video/upscale/history/credits`） | 表单式 | 输入提示词/比例/清晰度直接出图，不是画布 |
| 无限画布（canvas-lab） | `/canvas-lab`（`components/canvas-lab/canvas-lab-shell.tsx`） | Excalidraw | 把生成结果拖到画布上做空间整理、继续创作。**本次不动它** |
| **数字画布（本次新增）** | `/digital-canvas` | **React Flow** | 节点工作流：图片/文字/AI 绘图/AI 视频等节点连线组合 |

### 1.2 隔离原则（关键）

- 新增路由 `app/digital-canvas/`，新增组件目录 `components/digital-canvas/`，新增 `lib/digital-canvas/`。
- 不修改 `canvas-lab-shell.tsx` 及其 lib（`lib/canvas-lab-*.ts`、`lib/canvas-documents.ts`）。
- 侧边栏只**新增一个 link 项**，不改动现有项行为。
- 持久化用**新表 `digital_canvas_documents`**，不复用 `canvas_documents`（那是 Excalidraw 场景专用）。

---

## 2. 可直接复用的现有基础设施（避免重复造轮子）

实现节点里的「生成」动作时，**直接调用现有 API**，不要另起炉灶：

| 能力 | 现有 API / 模块 | 复用方式 |
|---|---|---|
| 鉴权 / 账户 / 点数 | `hooks/use-account-session.ts`、Supabase 客户端 `lib/supabase.ts` | 直接在 `/digital-canvas` 页面复用，未登录走 `AuthPanel` |
| AI 生图 | `POST /api/generate/image`（`app/api/generate/image/route.ts`） | AI 绘图节点点「生成」时调用，模型/比例/清晰度/张数/参考图参数已就绪 |
| AI 视频 | `POST /api/generate/video` | AI 视频节点复用 |
| 视频超分 | `POST /api/upscale` | 超分节点复用 |
| 任务轮询 / 状态 | `GET /api/tasks/[id]`、`GET /api/history` | 异步任务进度、生成历史面板 |
| 参考图上传 | `POST /api/uploads/reference-image` | 图片节点作为参考图输入时 |
| 计费/退款/任务表 | `lib/generation-jobs.ts`、`lib/generation-ledger.ts` | 由上面的 generate API 内部处理，前端无需重复 |
| 模型清单/价格 | `lib/model-options.ts`、`loadPublicModelConfigs/Pricing`（`lib/supabase.ts`） | 节点内模型下拉、价格展示 |
| 画布素材存储（Supabase Storage） | `SUPABASE_CANVAS_ASSETS_BUCKET`、签名上传模式（参考 `lib/canvas-documents.ts` 的 `createSignedUploadUrl`） | 数字画布素材沿用同一套签名上传范式，但走新 API |

> 已有环境变量（无需重复申请）：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_CANVAS_ASSETS_BUCKET`、`SUPABASE_GENERATED_IMAGES_BUCKET`，以及各模型上游 key（`YUNWU_*`、`GRSAI_*`、`APIMART_*`、`MANJU_*`、`MENGFACTORY_*`、`VECTORENGINE_*`）。

---

## 3. 入口改造（新增「数字画布」按钮）

`components/sidebar.tsx` 的 `navItems` 里，在 `canvas` link 项后新增一条 link：

```ts
{
  href: "/digital-canvas",
  id: "digital-canvas",
  kind: "link",
  label: "数字画布",
  description: "节点式 AI 设计工作台",
  icon: Workflow, // lucide-react 的 Workflow / Boxes / Network 皆可
}
```

- 只需扩展 `SidebarLinkItem` 的 `id` 联合类型（`"canvas" | "digital-canvas"`），渲染逻辑已支持 `kind: "link"`，无需改渲染代码。
- 图标从 `lucide-react` 引入（如 `Workflow`）。

---

## 4. 技术选型

| 项 | 选型 | 理由 |
|---|---|---|
| 画布/节点引擎 | `@xyflow/react`（React Flow v12） | 原生支持自定义节点、类型化输入/输出端口（handles）、连线、框选、缩放平移、小地图、网格背景，正好覆盖 PRD §2.3 交互 |
| 状态管理 | Zustand（React Flow 生态默认） | 节点/边/选择/历史栈集中管理，`components/digital-canvas/store.ts` |
| 撤销/重做 | 自建 history 栈（快照 nodes+edges）或 `zundo` | 对应 Ctrl+Z / Ctrl+Y |
| 拖拽上传 | 原生 `dragover`/`drop` + `paste` 事件 | 对应双击添加、Ctrl+V 粘贴建图片节点 |
| 数据获取 | SWR | 模型清单、历史、画布列表 |

安装（实现阶段执行，先装后引用）：
```bash
pnpm add @xyflow/react zustand
```

---

## 5. 目录结构（新增）

```
app/
  digital-canvas/
    page.tsx                      # 入口（鉴权壳 + 动态加载画布，ssr:false）
    [id]/page.tsx                 # 打开指定画布（可选，或用 query）
components/
  digital-canvas/
    digital-canvas-shell.tsx      # 顶层：顶部栏 + 左侧 Dock + 画布 + 快捷键条
    canvas/
      flow-canvas.tsx             # React Flow 容器（背景/网格/小地图/连线）
      node-context-menu.tsx       # 双击空白的「添加节点」菜单
    nodes/
      image-node.tsx
      text-node.tsx
      ai-image-node.tsx           # 核心生图节点
      ai-video-node.tsx           # 核心视频节点
      note-node.tsx
      ...（按阶段补齐 PRD §3 节点表）
    panels/
      quick-render-panel.tsx      # 快捷渲染面板（PRD §4，差异化核心）
      history-panel.tsx           # 生成历史
      templates-panel.tsx         # 模板库
      assets-panel.tsx            # 资产库
    topbar.tsx
    left-dock.tsx
    store.ts                      # zustand: nodes/edges/selection/history
    types.ts                      # 节点数据类型定义
lib/
  digital-canvas/
    api.ts                        # 前端调用封装（画布 CRUD、生成、上传）
    scene.ts                      # 序列化/反序列化 nodes+edges
    prompt-composer.ts            # 快捷渲染面板参数 → 提示词组装（PRD §4.1/§4.2）
    render-params.ts              # 参数分类体系常量（PRD §4.2 全量枚举）
    node-registry.ts              # nodeTypes 注册表
app/api/
  digital-canvas/
    route.ts                      # GET 列表 / POST 新建
    [id]/route.ts                 # GET 读取 / PUT 保存 / DELETE 删除
    [id]/uploads/route.ts         # 素材签名上传（沿用 canvas-documents 范式）
```

---

## 6. 数据模型

### 6.1 场景序列化（前端）

```ts
// lib/digital-canvas/types.ts
interface DigitalCanvasNode {
  id: string
  type: NodeType          // "image" | "text" | "ai-image" | "ai-video" | "note" | ...
  position: { x: number; y: number }
  data: Record<string, unknown>  // 各节点自定义，见 §7
}
interface DigitalCanvasEdge {
  id: string
  source: string; sourceHandle?: string
  target: string; targetHandle?: string
}
interface DigitalCanvasScene {
  nodes: DigitalCanvasNode[]
  edges: DigitalCanvasEdge[]
  viewport: { x: number; y: number; zoom: number }
}
```

### 6.2 持久化表（Supabase，新表，需通过 Supabase MCP 建表）

```sql
create table digital_canvas_documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  title       text not null default '未命名项目',
  scene       jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  viewport    jsonb,
  thumbnail_url text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
-- RLS: user_id = auth.uid() 的行才可读写（复刻 canvas_documents 的 RLS 策略）
```

- 素材沿用 `canvas_assets` 同款范式，但可加 `kind='digital'` 区分，或新建 `digital_canvas_assets`（推荐后者以彻底隔离）。
- 保存策略：debounce（如 1.5s）自动保存 scene；payload 大小上限参考 `lib/canvas-documents.ts`（4MB）；大图只存 URL 不存 dataURL。

---

## 7. 节点系统（对齐 PRD §3）

每个节点 = React Flow 自定义节点组件 + `data` 结构 + 输入/输出 handle。

| 节点 | `data` 关键字段 | 输入端口 | 输出端口 | 阶段 |
|---|---|---|---|---|
| `image` 图片 | `url, assetId, width, height` | — | image | P0 |
| `text` 文字 | `text` | — | text | P0 |
| `ai-image` AI 绘图 | `model, ratio, quality, imageCount, prompt, refs[], status, taskId, resultUrls[]` | image×N（参考图「图1/图2」）、text（提示词） | image | P0 |
| `ai-video` AI 视频 | `model, mode(文生/图生/首尾帧/参考生/延长), duration, resolution, ratio, prompt, refs[], status, taskId, resultUrl` | image、text | video | P2 |
| `note` 便签 | `text, color` | — | — | P1 |
| `video` 视频 | `url` | — | video | P2 |
| `drawing` 画板 | `strokes[]`（画笔/矩形/弧/橡皮） | image(底图) | image | P3 |
| `image-merge` 多图合并 | `layout` | image×N | image | P2 |
| `panorama` 全景 | `url, viewerState` | image | image | P3 |
| `upscale` 超分 | `scale, taskId` | image/video | image/video | P2 |
| `storyboard` 分镜表 | `shots[], grid(2x2..5x5)` | image/text | image×N | P3 |
| `json-prompt` | `json` | — | text | P2 |
| `chat` / `audio` / `video-decompose` / `editor` / `cloud-comfy` / `rh-comfyui` | 见 PRD §3 | — | — | P3/P4 |

**节点通用操作**（右键或悬浮工具条）：更换图片、发送到图片节点、设为底图、下载、双击全屏预览、复制、删除。

**连线语义**：上游 image 输出接入 `ai-image` 的 image 输入 → 作为参考图（「图1/图2」）；text 输出接入 prompt 输入。生成时从入边解析参考图与提示词。

---

## 8. 快捷渲染面板（PRD §4，差异化核心，P1）

这是与通用文生图最大的区别，务必完整实现参数体系。

- 结构：两个图片输入槽（图1 底图 / 图2 参考图，支持拖放/选择/Ctrl+V）→ 参数分类选择 → 提示词框（自动组装 + 手动编辑）→ 操作按钮（整图重绘 / 局部精修 / 设为底图）→ 生成参数（模型/比例/画质/张数/异步）。
- 参数分类体系（`lib/digital-canvas/render-params.ts` 全量枚举，均含「·自动」档）：
  大类（室内/建筑/景观/通用）、生成方式、空间场景、室内软装细分、光照/时刻、天空天气、季节、配景植栽、水景、建筑立面材质、铺装、景观场景、相机视角、3D 角度、风格档、纹理增强、其他修饰。
- 提示词组装：`prompt-composer.ts` 把选中的参数拼成中文提示词（默认模板见 PRD §4.1：「把我图1的白膜，保持空间内容不变，采用我图2的光影材质渲染成写实效果图…」）。
- 生成走 `POST /api/generate/image`：`prompt` = 组装结果，`referenceImages` = 图1/图2，`model` 默认 Nano Banana 2，`quality/ratio/imageCount` 由面板控制。局部精修传涂选 mask（后续接入 mask 参数）。

---

## 9. 生成对接流程（异步任务）

以 AI 绘图节点为例：

1. 收集入边参考图（上传未存的图 → `POST /api/uploads/reference-image` 拿 URL）。
2. `POST /api/generate/image`（multipart 或 json），带 `clientRequestId` 幂等。
3. 返回 `taskId`；节点进入 `submitted/processing` 态，轮询 `GET /api/tasks/[id]` 或订阅历史。
4. 完成后把 `resultUrls` 写回节点 `data`，节点渲染出图；失败展示 `taskError`（计费由后端自动退款）。
5. 结果可「发送到图片节点」派生新 `image` 节点，供下游继续连线。

> 计费、退款、错峰、水印、会员免费判定均已在 generate API 内实现，前端只读结果。

---

## 10. 画布交互与快捷键（PRD §2.3）

- 双击空白 → 添加节点菜单；Ctrl+V 粘贴图片直接建图片节点。
- Ctrl+Z 撤销 / Ctrl+Shift+Z(或 Ctrl+Y) 重做 / Ctrl+S 保存 / Delete 删除 / 滚轮缩放 / 空格+拖拽平移 / Shift 多选框选。
- 顶部栏：项目名内联编辑、模板库、资产库、下载导出、网格开关、小地图导航、自动整理、更多设置、找回全部节点（视图复位到节点包围盒）。
- 左侧 Dock：AI 助手、快捷渲染、生成历史、本地资料、项目管理、AI 对话、保存、导出分享、预览。
- 底部快捷键提示条。
- 对齐/排列：左对齐/居中/顶部对齐/网格排列/水平垂直等距。

---

## 11. 分阶段实现计划（对齐 PRD §11）

| 阶段 | 范围 | 交付 |
|---|---|---|
| **P0（MVP）** | 路由+入口按钮、React Flow 画布（缩放/平移/框选/网格/小地图）、图片/文字/AI 绘图节点、连线、快捷键、撤销、画布保存/加载（新表）、鉴权复用 | 能在画布上连图片+提示词→AI 绘图节点出图并保存 |
| **P1** | 快捷渲染面板（全参数体系+提示词组装+整图重绘/局部精修）、生成历史面板、便签节点、顶部栏/Dock 完整 | 行业化出图闭环 |
| **P2** | 模板库（公共/我的、分类、一键插入工作流）、AI 视频节点、图片工具（拆切/合并/超分）、JSON 提示词 | 模板生态 + 视频 |
| **P3** | 分镜表/导演模式、画板节点、全景/3D 预览、AI 音乐、视频编辑 | 进阶创作 |
| **P4** | 云端 ComfyUI、RH 工作流、资产库、本地资料、多端同步、会员/试用/错峰 | 平台化 |

---

## 12. 风险与注意事项

1. **与 canvas-lab 隔离**：不复用其表/组件/lib，避免 Excalidraw 与 React Flow 混淆。
2. **建表需 Supabase MCP**：`digital_canvas_documents` / `digital_canvas_assets` 及 RLS 需通过 Supabase 集成执行 schema 变更（实现阶段先请求 Supabase 集成）。
3. **payload 体积**：节点图片只存 URL/assetId，dataURL 不落库；大画布走签名上传。
4. **模型/价格动态**：模型下拉与价格从 `loadPublicModelConfigs/Pricing` 读，不硬编码。
5. **1:1 视觉校准**：实现时用 agent-browser 登录参考站（18657200442）截图逐屏比对顶部栏/Dock/节点样式，再用本地预览核对。
6. **SSR**：React Flow 需 `dynamic(() => import(...), { ssr: false })` 客户端加载。
7. **幂等**：所有生成请求带 `clientRequestId`，防重复扣费。

---

## 13. 验收标准（P0）

- [ ] 侧边栏出现「数字画布」，点击进入 `/digital-canvas`，canvas-lab 行为不变。
- [ ] 未登录显示登录面板；登录后进入画布。
- [ ] 双击空白可加节点；可拖入/粘贴图片建图片节点；可建文字节点、AI 绘图节点。
- [ ] 图片节点 + 文字节点连线到 AI 绘图节点，点击生成 → 调 `/api/generate/image` → 出图写回节点。
- [ ] Ctrl+S / 自动保存写入 `digital_canvas_documents`，刷新后可恢复 nodes+edges+viewport。
- [ ] Ctrl+Z 撤销、Delete 删除、滚轮缩放、空格平移、框选多选均可用。
