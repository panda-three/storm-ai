# 无限画布阶段性开发拆分

## 1. 开发目标

将当前 `/canvas-lab` 实验页升级为可长期使用的 AI 设计工作台。开发顺序应先解决“画布文档可云端保存和恢复”，再扩展“多画布、素材资产、画布触发生成、结果回填”，最后补齐版本恢复、容量治理和移动端体验。

当前代码基线：

- 入口路由：`app/canvas-lab/page.tsx`
- 画布主组件：`components/canvas-lab/canvas-lab-shell.tsx`
- 本地存储与导入工具：`lib/canvas-lab.ts`
- 生成历史来源：`useAccountSession()` 中的 `account.projects`，以及 `/api/history`
- 下载代理：`/api/download`
- 生成任务接口：`/api/generate/image`、`/api/generate/video`、`/api/tasks/[id]`
- 数据库基线：`supabase-schema.sql`

## 2. 总体架构原则

### 2.1 存储分层

画布应从“IndexedDB 主存储”改为“Supabase 主存储 + IndexedDB 缓存”。

- Supabase 保存画布文档、资产元数据、版本快照。
- Supabase Storage 保存用户上传素材、必要的画布派生文件和缩略图。
- IndexedDB 保存最近打开画布的离线缓存，作为加载加速和保存失败兜底。
- Excalidraw scene 中尽量保存轻量引用，不长期保存大量 base64。

### 2.2 数据边界

- `canvas_documents` 是用户画布主文档。
- `canvas_assets` 是画布内可复用资产和外部资源引用。
- `canvas_versions` 是可恢复快照。
- 生成历史项目仍归现有生成任务体系管理，画布只引用或复制必要元数据。
- 删除画布不删除历史生成项目。

### 2.3 API 边界

所有画布读写必须走服务端 API，统一校验 Supabase 登录态和 `user_id` 归属。客户端不直接写画布表，避免 RLS 配置不完整时出现越权风险。

### 2.4 UI 边界

保留 Excalidraw 作为画布内核。产品级功能通过外层工具栏、画布列表、素材栏、生成面板和任务卡实现，不深度依赖 Excalidraw 私有 DOM。

## 3. 数据库与存储设计

### 3.1 表结构阶段一

优先新增 `canvas_documents`，支撑单画布云端保存。

字段建议：

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `title text not null default '未命名画布'`
- `scene jsonb not null default '{}'::jsonb`
- `app_state jsonb not null default '{}'::jsonb`
- `files jsonb not null default '{}'::jsonb`
- `thumbnail_url text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `deleted_at timestamptz`

索引：

- `(user_id, updated_at desc)`，用于画布列表排序。
- `(user_id, deleted_at)`，用于过滤软删除。

约束：

- `title` 服务端裁剪长度，建议 1-80 字符。
- `scene`、`app_state`、`files` 入库前做大小限制。

### 3.2 表结构阶段二

新增 `canvas_assets`，支撑上传、本地素材、生成结果引用和去重。

字段建议：

- `id uuid primary key default gen_random_uuid()`
- `canvas_id uuid not null references public.canvas_documents(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `source_type text not null`
- `source_project_id text`
- `source_task_id text`
- `source_key text`
- `storage_url text`
- `external_url text`
- `mime_type text`
- `width integer`
- `height integer`
- `file_size integer`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

建议唯一约束：

- `(canvas_id, source_key)` where `source_key is not null`

### 3.3 表结构阶段三

新增 `canvas_versions`，支撑版本恢复。

字段建议：

- `id uuid primary key default gen_random_uuid()`
- `canvas_id uuid not null references public.canvas_documents(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `scene jsonb not null`
- `app_state jsonb not null default '{}'::jsonb`
- `files jsonb not null default '{}'::jsonb`
- `reason text not null default 'autosave'`
- `created_at timestamptz not null default now()`

保留策略：

- 每个画布最多保留最近 20 个自动快照。
- 用户主动恢复前可额外生成一个 `before_restore` 快照。

### 3.4 Storage 规划

建议新增或复用 Supabase Storage bucket：

- `canvas-assets`：用户上传素材、画布生成素材副本。
- `canvas-thumbnails`：画布缩略图。

路径建议：

- `canvas-assets/{user_id}/{canvas_id}/{asset_id}.{ext}`
- `canvas-thumbnails/{user_id}/{canvas_id}.webp`

## 4. API 拆分

### 4.1 画布文档 API

第一阶段必须完成：

- `GET /api/canvas-documents`
  - 返回当前用户未删除画布列表。
  - 字段包含 `id`、`title`、`thumbnailUrl`、`updatedAt`、`assetCount`。

- `POST /api/canvas-documents`
  - 创建画布。
  - 支持传入 `title`，默认 `未命名画布`。

- `GET /api/canvas-documents/[id]`
  - 返回画布详情。
  - 校验 `canvas_documents.user_id === auth.userId`。

- `PATCH /api/canvas-documents/[id]`
  - 保存 `scene`、`appState`、`files`、`thumbnailUrl`、`title`。
  - 支持局部更新。
  - 服务端更新 `updated_at`。

- `DELETE /api/canvas-documents/[id]`
  - 软删除画布。
  - 不删除历史生成项目。

### 4.2 素材 API

第二阶段完成：

- `GET /api/canvas-documents/[id]/assets`
  - 返回画布资产列表。

- `POST /api/canvas-documents/[id]/assets`
  - 绑定历史项目素材、生成结果素材，或登记上传结果。
  - 对 `source_key` 做去重。

- `POST /api/canvas-documents/[id]/uploads`
  - 上传本地图片到 Storage。
  - 校验 MIME、大小、用户归属和画布归属。

### 4.3 版本 API

第五阶段完成：

- `GET /api/canvas-documents/[id]/versions`
  - 返回版本列表，不返回完整大 JSON，详情可按需扩展。

- `POST /api/canvas-documents/[id]/versions`
  - 创建版本快照。

- `POST /api/canvas-documents/[id]/restore`
  - 恢复指定版本。
  - 恢复前自动保存 `before_restore`。

### 4.4 生成闭环 API

第三、四阶段完成：

- 扩展 `POST /api/generate/image`
  - 支持 `sourceCanvasId`、`sourceElementIds`、`sourceAssetIds`、`canvasPrompt`。
  - 创建任务后返回 `taskId` 和可插入画布的占位卡数据。

- 扩展 `GET /api/tasks/[id]`
  - 返回画布回填需要的结果 URL、状态、错误信息。

- 可选新增 `POST /api/canvas-documents/[id]/tasks`
  - 封装“从画布创建生成任务”的上下文解析。
  - 如果现有生成接口改动风险较大，优先采用该包装接口。

## 5. 前端模块拆分

### 5.1 `lib/canvas-lab.ts`

保留纯客户端工具，但拆出清晰职责：

- `canvas-lab-local-store.ts`：IndexedDB 缓存。
- `canvas-lab-scene.ts`：Excalidraw scene 序列化、签名、元素 customData。
- `canvas-lab-assets.ts`：项目素材、文件下载、图片尺寸、导入布局。
- `canvas-lab-api.ts`：调用画布 API。

### 5.2 `components/canvas-lab/`

建议拆分：

- `canvas-lab-shell.tsx`：账户校验、顶层状态编排。
- `canvas-workspace.tsx`：Excalidraw 实例和保存逻辑。
- `canvas-header.tsx`：标题、保存状态、画布操作。
- `canvas-document-menu.tsx`：新建、打开、重命名、删除。
- `project-asset-rail.tsx`：历史素材栏。
- `canvas-generation-panel.tsx`：从画布发起生成。
- `canvas-task-card.ts`：任务占位卡元素创建工具。

## 6. 阶段开发计划

## Phase 0：基础整理与技术预备

目标：降低后续改动风险，不改变用户可见功能。

范围：

- 梳理当前 `canvas-lab-shell.tsx` 中的存储、导入、UI 混杂逻辑。
- 抽出 IndexedDB 本地存储工具。
- 抽出 scene 签名与保存防抖逻辑。
- 抽出项目导入元素创建逻辑。
- 明确 Excalidraw 保存 payload 格式。

交付物：

- 本地画布功能行为保持不变。
- 代码模块边界清晰，便于接入云端 API。

验收：

- `/canvas-lab` 可正常打开。
- 本地自动保存、刷新恢复、导入历史图片、导出 JSON、清空画布仍可用。
- `pnpm lint`、`pnpm build` 通过。

## Phase 1：云端单画布保存

目标：完成跨浏览器、跨设备恢复的最小闭环。

范围：

- 新增 `canvas_documents` 表和 RLS 或服务端归属校验。
- 新增画布文档 CRUD API。
- 首次进入 `/canvas-lab` 时：
  - 查询当前用户最近更新的画布。
  - 没有画布则创建默认画布。
  - 有云端画布则加载云端数据。
- 自动保存从 IndexedDB 改为 Supabase API 主写入。
- IndexedDB 仍保存最近画布缓存。
- 保存状态显示 `正在保存`、`已保存`、`保存失败`。
- 保存失败时保留本地缓存，并提供重试。

实现重点：

- 保存防抖建议 800-1500ms。
- `PATCH` 只在 scene 签名变化时触发。
- 服务端限制 payload 体积，避免超大 base64 直接写爆数据库。
- 云端加载失败时允许打开本地缓存或空白画布。

验收：

- 用户编辑后刷新不丢失。
- 用户换浏览器登录后可恢复同一画布。
- 保存失败不会导致画布崩溃。
- 现有主页生成流程不受影响。

## Phase 2：多画布管理与历史素材增强

目标：支持用户长期项目化使用。

范围：

- 画布列表页或画布切换菜单。
- 新建、打开、重命名、软删除画布。
- 最近打开画布自动进入。
- 画布列表展示名称、更新时间、缩略图、素材数量。
- 历史素材栏支持搜索和筛选：
  - 项目名称、prompt 搜索。
  - 类型筛选：生图、视频。
  - 状态筛选：完成、部分完成、生成中、失败。
- 生图项目支持导入全部图片。
- 视频项目导入为视频卡片。
- 失败项目导入为错误说明卡。
- 重复导入时定位到已导入元素。

实现重点：

- 当前 `getProjectPreviewUrl()` 只取首图，需要扩展为多图资产枚举。
- `source_key` 应精确到单张结果，例如 `project:{projectId}:image:{index}`。
- 视频卡片不走图片下载逻辑，避免错误 MIME。
- 画布文档切换时必须重置 Excalidraw scene、保存签名和本地缓存 key。

验收：

- A 设备创建多个画布后，B 设备能看到同样列表。
- 删除画布不删除历史生成项目。
- 多图项目可以逐张导入或批量导入。
- 重复导入不会产生重复元素。

## Phase 3：本地素材上传与资产持久化

目标：解决“画布素材只在本地文件系统”的长期风险。

范围：

- 支持用户上传本地图片到画布。
- 支持拖拽 PNG、JPG、WEBP 到画布。
- 上传前校验类型、大小和尺寸。
- 上传后写入 Supabase Storage 和 `canvas_assets`。
- Excalidraw 文件引用改为可恢复资产引用。
- 资源过期或加载失败时展示占位卡并保留元数据。

实现重点：

- 不建议把大图长期保存到 `files` 的 base64。
- 对已在 Supabase `generated-images` 中的结果图，优先复用已有 URL。
- 对外部 URL 或代理下载结果，必要时复制到 `canvas-assets`。
- 需要定义从 `canvas_assets.storage_url` 恢复 Excalidraw `BinaryFileData` 的策略。

验收：

- 上传图片刷新后仍可显示。
- 换设备打开同一画布后图片仍可显示。
- 超过大小限制时给出明确提示。
- 图片加载失败时画布仍保留标题、来源和错误说明。

## Phase 4：画布触发生成

目标：让画布成为生成流程入口。

范围：

- 读取当前选中的 Excalidraw 元素。
- 选中图片元素时可作为参考图发起生图。
- 选中文本元素时可作为 prompt。
- 支持从画布打开生成参数面板。
- 生成任务创建成功后在画布插入任务占位卡。
- 占位卡记录：
  - `canvasId`
  - `taskId`
  - `sourceElementIds`
  - `sourceAssetIds`
  - `createdAt`

实现重点：

- 不影响主页现有生成表单。
- 参考图要走现有 `/api/uploads/reference-image` 或新增画布资产转参考图流程。
- 生成接口需要识别画布上下文，但不应依赖 Excalidraw 内部结构。
- 占位卡应是普通 Excalidraw 元素，使用 `customData` 记录任务元数据。

验收：

- 用户选中画布图片后可以进入生图流程。
- 文本卡内容可以自动填入 prompt。
- 任务创建成功后画布出现生成中状态卡。
- 主页生成流程行为不变。

## Phase 5：生成结果自动回填

目标：完成“画布发起 - 任务执行 - 结果回填”的创作闭环。

范围：

- 画布轮询或手动刷新任务状态。
- 从画布发起的任务完成后自动插入结果图片。
- 任务失败后更新占位卡为失败说明。
- 部分完成时显示已完成图片和失败说明。
- 任务结果写入 `canvas_assets`。
- 回填后保存画布 scene。

实现重点：

- 可先使用前端轮询 `GET /api/tasks/[id]`，后续再考虑后台 cron 或 realtime。
- 回填元素位置应靠近原任务占位卡。
- 同一任务只回填一次，重复刷新应定位到已有结果。
- 对多张结果图生成稳定 `source_key`。

验收：

- 用户无需回历史页查找从画布发起的结果。
- 成功任务自动出现结果图片。
- 失败任务在原占位卡显示错误信息。
- 手动刷新不会重复插入结果。

## Phase 6：版本恢复、缩略图、容量治理与移动端

目标：补齐长期使用能力和运营可控性。

范围：

- 定期版本快照。
- 版本列表和恢复确认。
- 画布缩略图生成与列表展示。
- 单用户画布数量限制。
- 单画布资产数量、总大小限制。
- 自动快照清理策略。
- 移动端基础查看、素材导入和关键按钮适配。
- 管理员排查能力：
  - 查看用户画布数量。
  - 查看资产体积。
  - 查看最近保存错误日志。

实现重点：

- 版本快照不要每次自动保存都创建，应按时间间隔或重要操作创建。
- 恢复前先创建 `before_restore` 快照。
- 缩略图可通过 Excalidraw export 或客户端截图生成，再上传 Storage。
- 容量限制应在 API 层兜底，前端只做提示。

验收：

- 用户误删后可恢复历史版本。
- 大画布不会无限增长。
- 画布列表有可识别缩略图。
- 移动端不出现关键按钮遮挡。

## 7. 建议实施顺序

1. Phase 0：先拆模块，不改功能。
2. Phase 1：完成单画布云端保存，这是后续所有功能的基础。
3. Phase 2：补多画布和历史素材增强，让用户能项目化使用。
4. Phase 4：接入画布触发生成，先完成创建任务和占位卡。
5. Phase 5：完成结果回填，形成核心闭环。
6. Phase 3：本地上传和资产持久化可与 Phase 4 并行，但必须在大规模使用前完成。
7. Phase 6：版本、容量、缩略图和移动端产品化。

## 8. 第一阶段任务清单

M1 云端保存基础版建议拆成以下开发任务：

- 数据库
  - 在 `supabase-schema.sql` 增加 `canvas_documents`。
  - 增加索引和更新时间触发器。
  - 明确 RLS 或仅服务端 service role 访问策略。

- 服务端
  - 新增 `lib/canvas-documents.ts`，封装画布文档查询和保存。
  - 新增 `app/api/canvas-documents/route.ts`。
  - 新增 `app/api/canvas-documents/[id]/route.ts`。
  - API 返回统一 `{ ok, data, error }` 结构。

- 客户端
  - 新增 `lib/canvas-lab-api.ts`。
  - 将 `loadCanvasLabDocument()` 扩展为先云端、后 IndexedDB。
  - 将 `saveCanvasLabDocument()` 扩展为先写云端、再写本地缓存。
  - 本地缓存 key 从固定 `main` 改为 `canvas:{canvasId}`。
  - Header 显示当前画布标题和保存状态。

- 验证
  - 新账号首次进入自动创建默认画布。
  - 已有账号打开最近画布。
  - 编辑、刷新、重新登录后内容仍在。
  - 断网或 API 失败时提示保存失败且不丢当前画布。

## 9. 关键风险与处理策略

### 9.1 Excalidraw 文件持久化

风险：当前导入图片会变成 `BinaryFileData.dataURL`，长期保存会导致数据库 JSON 急剧膨胀。

策略：

- M1 可以保留 base64，但必须加 payload 大小限制。
- M3 前完成 Storage URL 资产化。
- 大图和多图项目优先保存 `canvas_assets` 引用。

### 9.2 保存频率过高

风险：Excalidraw `onChange` 在移动、缩放、编辑时频繁触发。

策略：

- 使用 scene 签名过滤无效变化。
- 防抖保存。
- 只保存必要 `appState` 字段。
- 后续可区分 viewport 变化和内容变化。

### 9.3 多设备编辑冲突

风险：同一用户两个设备同时编辑同一画布，后保存覆盖先保存。

策略：

- M1 使用最后写入覆盖，保存时带 `updated_at`。
- M2 起可在 API 中支持 `clientUpdatedAt` 或 `revision` 检测。
- 冲突时提示用户刷新或另存副本。

### 9.4 生成任务和画布耦合

风险：直接改现有生成流程可能影响主页稳定性。

策略：

- 先通过可选字段接入画布上下文。
- 或新增 `/api/canvas-documents/[id]/tasks` 包装接口，内部调用现有生成逻辑。
- 主页不传画布上下文字段时行为保持不变。

### 9.5 成本失控

风险：画布、版本和图片长期增长会增加数据库、Storage 和带宽成本。

策略：

- 单用户画布数量限制。
- 单画布资产数量和总大小限制。
- 自动版本快照滚动清理。
- 复用历史生成 Storage URL，避免重复复制。

## 10. 阶段验收总表

| 阶段 | 核心交付 | 必过验收 |
| --- | --- | --- |
| Phase 0 | 模块整理 | 本地画布原功能不回归 |
| Phase 1 | 单画布云端保存 | 跨浏览器恢复同一画布 |
| Phase 2 | 多画布与素材增强 | 多画布管理、多图导入、筛选搜索 |
| Phase 3 | 上传与资产持久化 | 本地上传图片跨设备可显示 |
| Phase 4 | 画布触发生成 | 选中图片和文本可创建生成任务 |
| Phase 5 | 结果自动回填 | 任务完成后结果自动插入画布 |
| Phase 6 | 产品化治理 | 版本恢复、缩略图、容量限制、移动端基础可用 |

## 11. 推荐优先级

P0：

- `canvas_documents`
- 画布 CRUD API
- 单画布云端保存和恢复
- 多图历史素材导入
- 画布触发生图
- 生成结果回填

P1：

- 多画布管理
- 本地素材上传
- 素材搜索筛选
- 版本恢复
- 缩略图
- 容量限制

P2：

- 管理员画布诊断面板
- 更强的移动端编辑
- 多人协作
- 实时同步
