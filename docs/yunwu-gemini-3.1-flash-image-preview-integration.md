# Yunwu Gemini 3.1 Flash Image Preview 对接指南

这份文档用于把另一个项目接入云雾渠道的 `gemini-3.1-flash-image-preview` 图片模型。内容以 Storm AI 当前实现为参考，优先覆盖服务端直连、文生图、图生图、结果入库和错误处理。

> 注意：Google 官方 Gemini 文档在 2026 年已把新版图片模型主推为 `gemini-3.1-flash-image`，并推荐使用 Interactions API。云雾当前渠道里使用的是兼容模型名 `gemini-3.1-flash-image-preview` 和 `generateContent` 形态。落地时应以云雾后台实际可用模型名为准，并先跑本文的最小探测请求。

## 目标能力

- 文生图：用户输入 prompt，返回 1 张图片。
- 图生图 / 参考图生成：用户上传 1 张或多张参考图，连同 prompt 一起生成图片。
- 可配置比例：`默认`、`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9`、`1:4`、`1:8`、`4:1`、`8:1`。
- 可配置清晰度：`1K`、`2K`、`4K`。
- 服务端保存生成结果：把上游返回的 base64 图片转成 `Buffer`，上传到对象存储，再把公开 URL 返回给前端。

## 推荐架构

不要从浏览器直接请求云雾。推荐链路：

1. 前端上传 prompt、ratio、quality、referenceImages 到你自己的后端接口。
2. 后端校验登录、扣费额度、图片数量、图片 MIME、图片大小。
3. 后端调用云雾。
4. 后端解析云雾返回的 inline base64 图片。
5. 后端把图片上传到 Supabase Storage、S3、R2 或 OSS。
6. 后端返回自己的任务 ID 和图片 URL。

这样可以避免 API Key 暴露，也方便做限流、重试、审计日志和成本控制。

## 环境变量

```bash
YUNWU_API_KEY="你的云雾 API Key"
YUNWU_BASE_URL="https://yunwu.ai"
```

如果你的云雾后台给的是 OpenAI-compatible base URL，例如 `https://yunwu.ai/v1`，不要直接套到本文的 `generateContent` 路径上。Storm AI 当前实现用的是根地址 `https://yunwu.ai`，请求路径会拼成：

```text
https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=<YUNWU_API_KEY>
```

## 请求协议

### Endpoint

```text
POST {YUNWU_BASE_URL}/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key={YUNWU_API_KEY}
```

### Headers

```http
Accept: application/json
Content-Type: application/json
Authorization: Bearer <YUNWU_API_KEY>
```

当前实现同时传了 URL query `key` 和 `Authorization: Bearer`。这是为了兼容 Gemini 原生和云雾网关。新项目也建议先保持一致，确认云雾只需要其中一种后再简化。

### Body

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "生成一张现代客厅效果图，暖色灯光，真实摄影风格"
        },
        {
          "inline_data": {
            "mime_type": "image/png",
            "data": "<BASE64_REFERENCE_IMAGE>"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "16:9",
      "imageSize": "2K"
    }
  }
}
```

文生图时只传 text part。图生图时在 text part 后追加一个或多个 `inline_data` part。

## 参数映射

### 模型名

```ts
const model = "gemini-3.1-flash-image-preview"
```

### 图片比例

前端可以显示中文 `默认`，但发给上游时要规范化：

```ts
function normalizeGeminiAspectRatio(ratio: string) {
  return ratio === "默认" || !ratio ? "1:1" : ratio
}
```

### 图片清晰度

```ts
function normalizeGeminiImageSize(quality: string) {
  const value = quality.trim().toUpperCase()
  if (value === "4K") return "4K"
  if (value === "2K") return "2K"
  return "1K"
}
```

### 参考图限制

建议先按产品侧保守限制：

- 支持 MIME：`image/png`、`image/jpeg`、`image/webp`。
- 单张大小：建议不超过 10 MB。
- 数量：先限制 1-4 张；确认云雾侧稳定后再放开。
- 处理方式：后端读取为 `Buffer`，转 base64 放入 `inline_data.data`。

Google 官方文档提到 Gemini 3.1 Flash Image 支持较多参考图，但第三方网关可能有自己的 body size、超时和风控限制，所以不要直接按官方上限开放。

## TypeScript 服务端封装

下面是可直接迁移到 Next.js / Node 服务端的最小封装。

```ts
export interface YunwuReferenceImage {
  buffer: Buffer
  mimeType: string
}

export interface YunwuGeminiImageRequest {
  prompt: string
  quality: string
  ratio: string
  referenceImages?: YunwuReferenceImage[]
}

export interface YunwuGeneratedImage {
  buffer: Buffer
  mimeType: string
}

const yunwuBaseUrl = process.env.YUNWU_BASE_URL ?? "https://yunwu.ai"
const yunwuModel = "gemini-3.1-flash-image-preview"
const yunwuTimeoutMs = 420_000

export async function createYunwuGeminiImage(
  request: YunwuGeminiImageRequest
): Promise<YunwuGeneratedImage> {
  const apiKey = process.env.YUNWU_API_KEY
  if (!apiKey) throw new Error("缺少 YUNWU_API_KEY")

  const parts: Array<Record<string, unknown>> = [
    { text: request.prompt },
    ...(request.referenceImages ?? []).map((image) => ({
      inline_data: {
        mime_type: image.mimeType,
        data: image.buffer.toString("base64"),
      },
    })),
  ]

  const payload = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: normalizeGeminiAspectRatio(request.ratio),
        imageSize: normalizeGeminiImageSize(request.quality),
      },
    },
  }

  const url = new URL(`/v1beta/models/${yunwuModel}:generateContent`, yunwuBaseUrl)
  url.searchParams.set("key", apiKey)

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(yunwuTimeoutMs),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(describeYunwuError(response.status, data))
  }

  return extractFirstGeneratedImage(data)
}

function normalizeGeminiAspectRatio(ratio: string) {
  return ratio === "默认" || !ratio ? "1:1" : ratio
}

function normalizeGeminiImageSize(quality: string) {
  const value = quality.trim().toUpperCase()
  if (value === "4K") return "4K"
  if (value === "2K") return "2K"
  return "1K"
}

function extractFirstGeneratedImage(value: unknown): YunwuGeneratedImage {
  const inlineData = findInlineData(value)
  const data = typeof inlineData?.data === "string" ? inlineData.data : ""
  const mimeType =
    typeof inlineData?.mime_type === "string"
      ? inlineData.mime_type
      : typeof inlineData?.mimeType === "string"
        ? inlineData.mimeType
        : "image/png"

  if (!data) {
    throw new Error("云雾 Gemini 已返回响应，但未包含可用图片数据")
  }

  return {
    buffer: Buffer.from(data, "base64"),
    mimeType,
  }
}

function findInlineData(value: unknown): { data?: unknown; mime_type?: unknown; mimeType?: unknown } | null {
  if (!value || typeof value !== "object") return null
  if ("inline_data" in value && value.inline_data && typeof value.inline_data === "object") {
    return value.inline_data as { data?: unknown; mime_type?: unknown; mimeType?: unknown }
  }
  if ("inlineData" in value && value.inlineData && typeof value.inlineData === "object") {
    return value.inlineData as { data?: unknown; mime_type?: unknown; mimeType?: unknown }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInlineData(item)
      if (found) return found
    }
    return null
  }

  for (const item of Object.values(value)) {
    const found = findInlineData(item)
    if (found) return found
  }
  return null
}

function describeYunwuError(status: number, data: unknown) {
  const message = extractErrorMessage(data)
  if (status === 401 || status === 403) return `云雾鉴权失败：${message || "请检查 YUNWU_API_KEY"}`
  if (status === 429) return `云雾限流或余额不足：${message || "请稍后重试"}`
  if (status >= 500) return `云雾服务异常：${message || `HTTP ${status}`}`
  return `云雾请求失败：${message || `HTTP ${status}`}`
}

function extractErrorMessage(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const record = value as Record<string, unknown>
  if (typeof record.message === "string") return record.message
  if (typeof record.error === "string") return record.error
  if (record.error && typeof record.error === "object") {
    const nested = record.error as Record<string, unknown>
    if (typeof nested.message === "string") return nested.message
  }
  return ""
}
```

## Next.js Route 示例

```ts
import { NextResponse } from "next/server"
import { createYunwuGeminiImage } from "@/lib/yunwu-gemini"

export async function POST(request: Request) {
  const formData = await request.formData()
  const prompt = String(formData.get("prompt") ?? "").trim()
  const ratio = String(formData.get("ratio") ?? "1:1")
  const quality = String(formData.get("quality") ?? "1K")
  const files = formData.getAll("referenceImages").filter((item): item is File => item instanceof File)

  if (!prompt) {
    return NextResponse.json({ ok: false, error: "请输入提示词" }, { status: 400 })
  }

  const referenceImages = await Promise.all(
    files.map(async (file) => ({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || "image/png",
    }))
  )

  const image = await createYunwuGeminiImage({
    prompt,
    quality,
    ratio,
    referenceImages,
  })

  // 生产环境建议上传到对象存储，然后返回 URL。
  // 这里仅展示最小返回方式，不建议大图长期经由 API Route 直出。
  return new Response(image.buffer, {
    headers: {
      "Content-Type": image.mimeType,
      "Cache-Control": "no-store",
    },
  })
}
```

生产项目不要长期用上面的直接返回图片方式。推荐上传到对象存储后返回：

```json
{
  "ok": true,
  "taskId": "job_xxx",
  "imageUrls": ["https://cdn.example.com/users/u1/images/result.png"]
}
```

## 最小 curl 探测

先在服务端执行文生图探测，确认 key、模型名和 base URL 正确：

```bash
curl -sS -X POST "https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=$YUNWU_API_KEY" \
  -H "Authorization: Bearer $YUNWU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "Create a simple 1:1 product render of a white ceramic coffee mug on a light gray background."
          }
        ]
      }
    ],
    "generationConfig": {
      "responseModalities": ["TEXT", "IMAGE"],
      "imageConfig": {
        "aspectRatio": "1:1",
        "imageSize": "1K"
      }
    }
  }'
```

返回 JSON 中应能找到类似下面的结构之一：

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inline_data": {
              "mime_type": "image/png",
              "data": "..."
            }
          }
        ]
      }
    }
  ]
}
```

也可能是 camelCase：

```json
{
  "inlineData": {
    "mimeType": "image/png",
    "data": "..."
  }
}
```

所以解析时要同时兼容 `inline_data` / `inlineData`、`mime_type` / `mimeType`。

## 任务与存储建议

图片生成可能等待几十秒到数分钟。建议不要让前端一直阻塞在提交按钮上：

- `POST /api/generate/image`：创建本地任务，扣减或冻结额度，后台执行生成。
- `GET /api/tasks/:id`：轮询任务状态。
- 任务状态：`queued`、`processing`、`completed`、`failed`。
- 上游同步生成完成后，把图片上传到对象存储，再把 URL 写入任务表。
- 如果生成失败，回滚或退还冻结额度。

如果项目暂时没有队列，也至少设置 420 秒左右的服务端 timeout，并在前端显示“生成中”状态。

## 错误处理

建议把错误归类，不要把上游原始 JSON 全量暴露给用户：

| HTTP 状态 | 后端含义 | 用户提示 |
|---|---|---|
| 400 | 参数不兼容、比例或清晰度不支持 | 生成参数无效，请调整比例或清晰度 |
| 401 / 403 | Key 错误、渠道未授权 | 生成服务配置异常，请联系管理员 |
| 408 / timeout | 生成等待超时 | 生成等待超时，请稍后重试 |
| 429 | 限流、余额不足或并发过高 | 当前生成繁忙，请稍后重试 |
| 500+ | 云雾或上游异常 | 生成服务暂时不可用 |

日志里建议记录：

- provider：`yunwu`
- model：`gemini-3.1-flash-image-preview`
- promptLength，不记录完整 prompt 或只记录脱敏摘要
- ratio、quality
- referenceImageCount
- durationMs
- response status
- error message

不要记录 API Key、完整 base64 图片、用户隐私图片内容。

## 前端配置建议

```ts
export const yunwuGeminiImageModelName = "gemini-3.1-flash-image-preview"

export const imageModelSettings = {
  [yunwuGeminiImageModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["默认", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"],
  },
}
```

产品展示名建议和内部模型名分开：

```ts
{
  provider: "yunwu",
  model: "gemini-3.1-flash-image-preview",
  apiModel: "gemini-3.1-flash-image-preview",
  displayName: "Gemini 3.1 Flash Image · 云雾"
}
```

## 上线前检查清单

- `YUNWU_API_KEY` 只存在服务端环境变量里，未暴露到 `NEXT_PUBLIC_*`。
- curl 文生图探测通过。
- 上传 1 张参考图的图生图探测通过。
- `1K`、`2K`、`4K` 至少各测一次。
- `1:1`、`16:9`、`9:16` 至少各测一次。
- 生成结果已上传对象存储，前端不依赖临时 base64。
- 生成接口有用户级限流。
- 超时、429、余额不足、无图返回都有可读错误。
- 日志不会输出 API Key 和 base64 图片。
- 如果接入扣费系统，失败任务会退款或释放冻结额度。

## 需要向云雾确认或实测的点

这些点第三方网关经常和官方 Gemini 行为不同：

- `gemini-3.1-flash-image-preview` 是否仍是当前可用模型名，是否已迁移到 `gemini-3.1-flash-image`。
- 是否必须同时传 query `key` 和 `Authorization: Bearer`。
- `generationConfig.imageConfig.aspectRatio` 和 `imageSize` 是否完整生效。
- 最大参考图数量、最大请求体大小、支持的 MIME。
- 是否支持多图一次返回；如果不支持，应应用层多次请求。
- 是否支持 Interactions API，路径是否为 `/v1beta/interactions`。
- 429 的具体含义：限流、余额不足、并发限制还是模型排队。

## 参考资料

- Google Gemini 图片生成文档：`https://ai.google.dev/gemini-api/docs/image-generation`
- Google Gemini OpenAI compatibility 文档：`https://ai.google.dev/gemini-api/docs/openai`
- Storm AI 当前参考实现：`lib/yunwu.ts`、`lib/model-options.ts`、`app/api/generate/image/route.ts`
