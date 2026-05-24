import {
  grokImagineImageModelName,
  grokVideo310sModelName,
  grokVideo3ModelName,
  yunwuGeminiImageModelName,
  yunwuSeedream5ImageModelName,
  yunwuSeedance15ProVideoModelName,
  yunwuVeo31FastVideoModelName,
} from "@/lib/model-options"
import type { GenerationResponse, NormalizedTaskStatus } from "@/lib/generation-types"

const YUNWU_BASE_URL = process.env.YUNWU_BASE_URL ?? "https://yunwu.ai"
const yunwuDefaultTimeoutMs = 60_000
const yunwuGeminiImageTimeoutMs = 360_000
const yunwuGptImageTimeoutMs = 360_000
const yunwuSeedreamImageTimeoutMs = 360_000
const yunwuGrokImagineImageTimeoutMs = 360_000
const yunwuVeo31FastApiModel = "veo3.1-fast"
const yunwuSeedance15ProApiModel = yunwuSeedance15ProVideoModelName

export interface YunwuReferenceImage {
  buffer: Buffer
  mimeType: string
}

export interface YunwuGeminiImageRequest {
  model: string
  prompt: string
  quality: string
  ratio: string
  referenceImages: YunwuReferenceImage[]
}

export interface YunwuGeneratedImage {
  buffer: Buffer
  mimeType: string
}

export interface YunwuGptImageRequest {
  imageCount?: number
  imageUrls?: string[]
  model: string
  prompt: string
  ratio: string
}

export interface YunwuSeedreamImageRequest {
  imageCount?: number
  imageUrls?: string[]
  model: string
  prompt: string
  quality: string
  ratio: string
}

export interface YunwuGrokImagineImageRequest {
  imageCount?: number
  model: string
  prompt: string
  quality: string
  ratio: string
  referenceImage: YunwuReferenceImage
}

export interface YunwuVideoRequest {
  aspectRatio: string
  imageUrls: string[]
  durationSeconds: number
  model: string
  prompt: string
  quality: string
}

interface GeminiInlineData {
  data?: unknown
  mime_type?: unknown
  mimeType?: unknown
}

export async function createYunwuGeminiImage(request: YunwuGeminiImageRequest): Promise<YunwuGeneratedImage> {
  const apiKey = getYunwuApiKey()
  const parts: Array<Record<string, unknown>> = [
    { text: request.prompt },
    ...request.referenceImages.map((image) => ({
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
  const url = new URL(`/v1beta/models/${yunwuGeminiImageModelName}:generateContent`, YUNWU_BASE_URL)
  url.searchParams.set("key", apiKey)

  logYunwu("gemini image input", {
    model: request.model,
    promptLength: request.prompt.length,
    quality: request.quality,
    ratio: request.ratio,
    referenceImageCount: request.referenceImages.length,
  })

  const data = await yunwuJsonRequest(
    url,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: yunwuGeminiImageTimeoutMs,
      timeoutMessage: "yw 图片生成等待超时，请稍后重试，或减少参考图后再试。",
    }
  )
  const image = extractFirstGeneratedImage(data)

  logYunwu("gemini image output", {
    byteLength: image.buffer.byteLength,
    mimeType: image.mimeType,
  })

  return image
}

export async function createYunwuGptImages(request: YunwuGptImageRequest) {
  const imageCount = normalizeImageCount(request.imageCount)
  const results = await Promise.allSettled(Array.from({ length: imageCount }, () => createSingleYunwuGptImage(request)))
  const imageUrls = results
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .map((result) => result.value)

  if (imageUrls.length === 0) {
    const errors = Array.from(
      new Set(
        results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
          .filter(Boolean)
      )
    )
    throw new Error(errors.length > 0 ? errors.join("；") : "yw 图片接口已返回，但未找到可用图片地址。")
  }

  return imageUrls
}

export async function createYunwuSeedreamImages(request: YunwuSeedreamImageRequest) {
  const imageCount = normalizeImageCount(request.imageCount)
  const results = await Promise.allSettled(Array.from({ length: imageCount }, () => createSingleYunwuSeedreamImage(request)))
  const imageUrls = results
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .map((result) => result.value)

  if (imageUrls.length === 0) {
    const errors = Array.from(
      new Set(
        results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
          .filter(Boolean)
      )
    )
    throw new Error(errors.length > 0 ? errors.join("；") : "yw Seedream 图片接口已返回，但未找到可用图片地址。")
  }

  return imageUrls
}

export async function createYunwuGrokImagineImages(request: YunwuGrokImagineImageRequest) {
  const imageCount = normalizeImageCount(request.imageCount)
  const formData = new FormData()
  formData.set("model", grokImagineImageModelName)
  formData.set("prompt", request.prompt)
  formData.set("aspect_ratio", normalizeGrokImagineAspectRatio(request.ratio))
  formData.set("response_format", "url")
  formData.set("resolution", normalizeGrokImagineResolution(request.quality))
  formData.set("quality", "medium")
  formData.set("n", String(imageCount))
  formData.set(
    "image",
    new Blob([request.referenceImage.buffer], { type: request.referenceImage.mimeType }),
    getGrokImagineReferenceFilename(request.referenceImage.mimeType)
  )

  logYunwu("grok imagine image input", {
    aspect_ratio: normalizeGrokImagineAspectRatio(request.ratio),
    image: 1,
    model: request.model,
    n: imageCount,
    quality: "medium",
    resolution: normalizeGrokImagineResolution(request.quality),
  })

  const data = await yunwuFormRequest(
    "/v1/images/edits",
    {
      method: "POST",
      body: formData,
    },
    {
      timeoutMs: yunwuGrokImagineImageTimeoutMs,
      timeoutMessage: "yw Grok Imagine 图片生成等待超时，请稍后重试。",
    }
  )
  const urls = extractMediaUrls(data, ["url", "image", "image_url", "image_urls", "data", "content", "b64_json"], [
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "avif",
  ])

  if (urls.length === 0) {
    throw new Error("yw Grok Imagine 图片接口已返回，但未找到可用图片地址。")
  }

  logYunwu("grok imagine image output", { imageUrls: urls.length })
  return urls.slice(0, imageCount)
}

async function createSingleYunwuSeedreamImage(request: YunwuSeedreamImageRequest) {
  const imageUrls = request.imageUrls ?? []
  const payload = {
    model: yunwuSeedream5ImageModelName,
    prompt: request.prompt,
    size: normalizeSeedreamImageSize(request.quality, request.ratio),
    output_format: "png",
    response_format: "url",
    watermark: false,
    ...(imageUrls.length > 0 ? { image: imageUrls } : {}),
  }

  logYunwu("seedream image input", {
    ...payload,
    image: imageUrls.length,
    model: request.model,
  })

  const data = await yunwuJsonRequest(
    "/v1/images/generations",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: yunwuSeedreamImageTimeoutMs,
      timeoutMessage: "yw Seedream 图片生成等待超时，请稍后重试，或减少参考图后再试。",
    }
  )
  const urls = extractMediaUrls(data, ["url", "image", "image_url", "image_urls", "data", "content", "b64_json"], [
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "avif",
  ])

  if (urls.length === 0) {
    throw new Error("yw Seedream 图片接口已返回，但未找到可用图片地址。")
  }

  logYunwu("seedream image output", { imageUrls: urls.length })
  return urls[0]
}

async function createSingleYunwuGptImage(request: YunwuGptImageRequest) {
  const imageUrls = request.imageUrls ?? []
  const data = imageUrls.length > 0
    ? await createYunwuGptImageWithReferences(request, imageUrls)
    : await createYunwuGptImageFromText(request)
  const urls = extractMediaUrls(data, ["url", "image", "image_url", "image_urls", "data", "content", "b64_json"], [
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "avif",
  ])

  if (urls.length === 0) {
    throw new Error("yw 图片接口已返回，但未找到可用图片地址。")
  }

  logYunwu("gpt image output", { imageUrls: urls.length })
  return urls[0]
}

async function createYunwuGptImageFromText(request: YunwuGptImageRequest) {
  const payload = {
    model: request.model,
    prompt: request.prompt,
    size: normalizeGptImageSize(request.ratio),
    n: 1,
  }

  logYunwu("gpt image input", {
    ...payload,
    image: 0,
  })

  return yunwuJsonRequest(
    "/v1/images/generations",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: yunwuGptImageTimeoutMs,
      timeoutMessage: "yw 图片生成等待超时，请稍后重试，或减少参考图后再试。",
    }
  )
}

async function createYunwuGptImageWithReferences(request: YunwuGptImageRequest, imageUrls: string[]) {
  const payload = {
    model: request.model,
    prompt: request.prompt,
    size: normalizeGptImageSize(request.ratio),
    n: 1,
    image: imageUrls,
  }

  logYunwu("gpt image input", {
    ...payload,
    image: imageUrls.length,
  })

  return yunwuJsonRequest(
    "/v1/images/generations",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: yunwuGptImageTimeoutMs,
      timeoutMessage: "yw 图片生成等待超时，请稍后重试，或减少参考图后再试。",
    }
  )
}

export async function createYunwuVideo(request: YunwuVideoRequest): Promise<GenerationResponse> {
  if (isYunwuSeedance15ProVideoModel(request.model)) {
    return createYunwuSeedanceVideo(request)
  }

  const apiModel = getYunwuVideoApiModel(request.model)
  const payload = {
    model: apiModel,
    prompt: request.prompt,
    aspect_ratio: request.aspectRatio,
    ...(isYunwuVeoComponentsModel(apiModel)
      ? {
          enhance_prompt: true,
          enable_upsample: request.quality.trim().toUpperCase() !== "720P",
        }
      : {
          size: normalizeGrokVideoSize(request.quality),
        }),
    ...(request.imageUrls.length > 0 ? { images: request.imageUrls } : {}),
  }

  logYunwu("video create input", {
    ...payload,
    images: request.imageUrls.length,
  })

  const data = await yunwuJsonRequest("/v1/video/create", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const taskId = findStringValue(data, ["id", "task_id", "taskId"])

  if (!taskId) {
    throw new Error("yw 视频接口未返回任务 ID。")
  }

  const result: GenerationResponse = {
    ok: true,
    mode: "yunwu",
    taskId,
    status: "submitted",
    type: "video",
  }

  logYunwu("video create output", result)
  return result
}

export async function getYunwuVideoTaskStatus(taskId: string, model?: string): Promise<NormalizedTaskStatus> {
  if (isYunwuSeedance15ProVideoModel(model ?? "")) {
    return getYunwuSeedanceVideoTaskStatus(taskId)
  }

  const data = await yunwuJsonRequest(`/v1/video/query?id=${encodeURIComponent(taskId)}`, {
    method: "GET",
  })

  return normalizeYunwuVideoTaskStatus(taskId, data)
}

export function isYunwuRateLimitError(message: string) {
  const value = message.toLowerCase()
  return value.includes("request rate limit") || value.includes("rate limit") || value.includes("too many requests")
}

function getYunwuVideoApiModel(model: string) {
  if (model === yunwuVeo31FastVideoModelName) return yunwuVeo31FastApiModel
  if (model === grokVideo3ModelName) return "grok-video-3"
  if (model === grokVideo310sModelName) return "grok-video-3-10s"
  return model
}

function isYunwuVeoComponentsModel(model: string) {
  return model === yunwuVeo31FastApiModel
}

function isYunwuSeedance15ProVideoModel(model: string) {
  return model === yunwuSeedance15ProVideoModelName || model === yunwuSeedance15ProApiModel
}

async function createYunwuSeedanceVideo(request: YunwuVideoRequest): Promise<GenerationResponse> {
  const payload = {
    model: yunwuSeedance15ProApiModel,
    content: buildSeedanceVideoContent(request),
    generate_audio: true,
  }

  logYunwu("video create input", {
    ...payload,
    content: payload.content.length,
    images: request.imageUrls.length,
    model: request.model,
  })

  const data = await yunwuJsonRequest("/volc/v1/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const taskId = findStringValue(data, ["id", "task_id", "taskId"])
  const status = normalizeYunwuStatus(findStringValue(data, ["status", "task_status"]) || "submitted")

  if (!taskId) {
    throw new Error("yw 视频接口未返回任务 ID。")
  }

  const result: GenerationResponse = {
    ok: true,
    mode: "yunwu",
    taskId,
    status,
    type: "video",
  }

  logYunwu("video create output", result)
  return result
}

async function getYunwuSeedanceVideoTaskStatus(taskId: string): Promise<NormalizedTaskStatus> {
  const data = await yunwuJsonRequest(`/volc/v1/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
  })

  return normalizeYunwuVideoTaskStatus(taskId, data)
}

function normalizeYunwuVideoTaskStatus(taskId: string, data: unknown): NormalizedTaskStatus {
  const status = normalizeYunwuTaskStatus(data)
  const taskError = findYunwuTaskError(data, status)
  const videoUrl =
    findStringValue(data, ["upsample_video_url", "video_url", "videoUrl", "videoUrls", "video_urls"]) ||
    extractMediaUrls(data, ["video", "video_url", "video_urls", "videos", "url", "urls", "output", "result", "content", "data"], [
      "mp4",
      "mov",
      "webm",
    ])[0] ||
    ""

  return {
    ok: true,
    mode: "yunwu",
    taskId,
    status,
    progress: status === "completed" || status === "failed" ? 100 : 0,
    imageUrls: [],
    videoUrl,
    taskError,
    raw: data,
  }
}

function buildSeedanceVideoContent(request: YunwuVideoRequest) {
  const text = buildSeedanceVideoPrompt(request)
  const content: Array<Record<string, unknown>> = [
    {
      text,
      type: "text",
    },
  ]

  for (const imageUrl of request.imageUrls) {
    content.push({
      image_url: {
        url: imageUrl,
      },
      role: "reference_image",
      type: "image_url",
    })
  }

  return content
}

function buildSeedanceVideoPrompt(request: YunwuVideoRequest) {
  return [
    request.prompt.trim(),
    `--resolution ${normalizeSeedanceResolution(request.quality)}`,
    `--ratio ${request.aspectRatio.trim() || "16:9"}`,
    `--duration ${normalizeSeedanceDuration(request.durationSeconds)}`,
    "--watermark false",
  ].join(" ")
}

function normalizeSeedanceResolution(quality: string) {
  const normalized = quality.trim().toUpperCase()
  return normalized === "720P" ? "720p" : "720p"
}

function normalizeSeedanceDuration(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds)) return 5
  const value = Math.trunc(durationSeconds)
  return Math.min(12, Math.max(4, value || 5))
}

function normalizeImageCount(value: number | undefined): number {
  if (value === undefined) return 1
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 1
}

function normalizeGeminiAspectRatio(ratio: string) {
  const value = ratio.trim()
  return value && value !== "默认" && value !== "auto" ? value : "1:1"
}

function normalizeGeminiImageSize(quality: string) {
  const value = quality.trim().toUpperCase()
  if (value === "4K") return "4K"
  if (value === "2K") return "2K"
  return "1K"
}

function normalizeGptImageSize(ratio: string) {
  const value = ratio.trim()
  if (!value || value === "auto" || value === "默认" || value === "1:1") return "1024x1024"
  const [width, height] = value.split(":").map((part) => Number.parseFloat(part))

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "1024x1024"
  }

  if (width > height) return "1536x1024"
  if (height > width) return "1024x1536"
  return "1024x1024"
}

function normalizeSeedreamImageSize(quality: string, ratio: string) {
  const normalizedQuality = quality.trim().toUpperCase() === "3K" ? "3K" : "2K"
  const normalizedRatio = ratio.trim()

  if (!normalizedRatio || normalizedRatio === "默认" || normalizedRatio === "auto") {
    return normalizedQuality
  }

  const sizes: Record<string, Record<string, string>> = {
    "2K": {
      "1:1": "2048x2048",
      "4:3": "2304x1728",
      "3:4": "1728x2304",
      "16:9": "2848x1600",
      "9:16": "1600x2848",
      "3:2": "2496x1664",
      "2:3": "1664x2496",
      "21:9": "3136x1344",
    },
    "3K": {
      "1:1": "3072x3072",
      "4:3": "3456x2592",
      "3:4": "2592x3456",
      "16:9": "4096x2304",
      "9:16": "2304x4096",
      "2:3": "2496x3744",
      "3:2": "3744x2496",
      "21:9": "4704x2016",
    },
  }

  return sizes[normalizedQuality][normalizedRatio] ?? normalizedQuality
}

function normalizeGrokVideoSize(quality: string) {
  return quality.trim().toUpperCase() === "480P" ? "480P" : "720P"
}

function normalizeGrokImagineResolution(quality: string) {
  return quality.trim().toUpperCase() === "2K" ? "2k" : "1k"
}

function normalizeGrokImagineAspectRatio(ratio: string) {
  const value = ratio.trim()
  return value || "auto"
}

function getGrokImagineReferenceFilename(mimeType: string) {
  if (mimeType.includes("webp")) return "reference.webp"
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "reference.jpg"
  return "reference.png"
}

async function yunwuJsonRequest(
  pathOrUrl: string | URL,
  init: RequestInit,
  {
    timeoutMessage = "yw 请求等待超时，请稍后重试。",
    timeoutMs = yunwuDefaultTimeoutMs,
  }: {
    timeoutMessage?: string
    timeoutMs?: number
  } = {}
) {
  const apiKey = getYunwuApiKey()
  const url = typeof pathOrUrl === "string" ? new URL(pathOrUrl, YUNWU_BASE_URL) : pathOrUrl
  let response: Response

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(timeoutMessage, { cause: error })
    }

    throw error
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(describeYunwuError(response.status, data))
  }

  return data
}

async function yunwuFormRequest(
  pathOrUrl: string | URL,
  init: RequestInit,
  {
    timeoutMessage = "yw 请求等待超时，请稍后重试。",
    timeoutMs = yunwuDefaultTimeoutMs,
  }: {
    timeoutMessage?: string
    timeoutMs?: number
  } = {}
) {
  const apiKey = getYunwuApiKey()
  const url = typeof pathOrUrl === "string" ? new URL(pathOrUrl, YUNWU_BASE_URL) : pathOrUrl
  let response: Response

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(timeoutMessage, { cause: error })
    }

    throw error
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(describeYunwuError(response.status, data))
  }

  return data
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
}

function getYunwuApiKey() {
  const apiKey = process.env.YUNWU_API_KEY
  if (!apiKey) {
    throw new Error("缺少 yw API Key，请配置 YUNWU_API_KEY。")
  }
  return apiKey
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
    throw new Error("yw Gemini 已返回响应，但未包含可用图片数据。")
  }

  return {
    buffer: Buffer.from(data, "base64"),
    mimeType,
  }
}

function findInlineData(value: unknown): GeminiInlineData | null {
  if (!value || typeof value !== "object") return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInlineData(item)
      if (found) return found
    }
    return null
  }

  const record = value as Record<string, unknown>
  const inlineData = record.inline_data ?? record.inlineData

  if (inlineData && typeof inlineData === "object") {
    const data = (inlineData as GeminiInlineData).data
    if (typeof data === "string" && data) {
      return inlineData as GeminiInlineData
    }
  }

  for (const nested of Object.values(record)) {
    const found = findInlineData(nested)
    if (found) return found
  }

  return null
}

function normalizeYunwuTaskStatus(data: unknown): NormalizedTaskStatus["status"] {
  const statusValues = collectStringValuesForKeys(data, [
    "status",
    "state",
    "task_status",
    "taskStatus",
    "mediaGenerationStatus",
    "media_generation_status",
  ])

  if (statusValues.some(isFailedYunwuStatus) || hasYunwuFailureReason(data)) {
    return "failed"
  }

  for (const status of statusValues) {
    const normalized = normalizeYunwuStatus(status)
    if (normalized !== "processing") return normalized
  }

  return "processing"
}

function normalizeYunwuStatus(status: string): NormalizedTaskStatus["status"] {
  const value = status.toLowerCase()

  if (
    ["success", "succeeded", "completed", "complete", "done", "finish", "finished"].includes(value) ||
    value.endsWith("_succeeded") ||
    value.endsWith("_completed")
  ) {
    return "completed"
  }

  if (isFailedYunwuStatus(status)) {
    return "failed"
  }

  if (["queued", "pending", "submitted", "created"].includes(value)) {
    return "submitted"
  }

  return "processing"
}

function isFailedYunwuStatus(status: string) {
  const value = status.toLowerCase()
  return (
    ["failed", "fail", "error", "cancelled", "canceled"].includes(value) ||
    value.endsWith("_failed") ||
    value.includes("generation_status_failed")
  )
}

function hasYunwuFailureReason(data: unknown) {
  return collectStringValuesForKeys(data, ["failureReasons", "failure_reasons"]).length > 0
}

function findYunwuTaskError(data: unknown, status: NormalizedTaskStatus["status"]) {
  const failureReasons = collectStringValuesForKeys(data, ["failureReasons", "failure_reasons", "failure_reason"])
  const errorMessages = collectStringValuesForKeys(data, [
    "error_message",
    "errorMessage",
    "reason",
    "fail_reason",
    "failReason",
    "error",
    "message",
  ])
  const messages = status === "failed" ? collectStringValuesForKeys(data, ["message"]) : []
  const allMessages = [...errorMessages, ...messages]
  const tokens = [...failureReasons, ...allMessages.flatMap(extractYunwuErrorTokens)]
    .map((value) => value.trim())
    .filter(Boolean)

  if (tokens.length > 0) {
    return Array.from(new Set(tokens)).slice(0, 3).join(" / ")
  }

  const concise = allMessages.map((value) => value.trim()).filter(Boolean)

  return Array.from(new Set(concise)).slice(0, 3).join(" / ")
}

function describeYunwuError(status: number, data: unknown) {
  const message = findStringValue(data, ["message", "error", "details", "detail"])
  return message ? `yw 请求失败（${status}）：${message}` : `yw 请求失败（${status}）。`
}

function collectStringValuesForKeys(value: unknown, keys: string[]): string[] {
  const values: string[] = []
  collectStringValuesForKeysInto(value, new Set(keys.map((key) => key.toLowerCase())), values)
  return values
}

function collectStringValuesForKeysInto(value: unknown, keys: Set<string>, values: string[]) {
  if (!value || typeof value !== "object") return

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === "string") values.push(item)
      collectStringValuesForKeysInto(item, keys, values)
    })
    return
  }

  for (const [key, nested] of Object.entries(value)) {
    if (keys.has(key.toLowerCase())) {
      if (typeof nested === "string") {
        values.push(nested)
      } else if (Array.isArray(nested)) {
        nested.forEach((item) => {
          if (typeof item === "string") values.push(item)
          collectStringValuesForKeysInto(item, keys, values)
        })
      } else {
        collectStringValuesForKeysInto(nested, keys, values)
      }
      continue
    }

    collectStringValuesForKeysInto(nested, keys, values)
  }
}

function extractYunwuErrorTokens(message: string) {
  const tokens = message.match(/\b(?:PUBLIC_ERROR_[A-Z0-9_]+|GENERATED_VIDEO_[A-Z0-9_]+)\b/g)
  return tokens ?? []
}

function findStringValue(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return ""

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringValue(item, keys)
      if (found) return found
    }
    return ""
  }

  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key) && typeof nested === "string") return nested
    const found = findStringValue(nested, keys)
    if (found) return found
  }

  return ""
}

function extractMediaUrls(value: unknown, preferredKeys: string[], extensions: string[]) {
  const keyedUrls = new Set<string>()
  collectKeyedUrls(value, keyedUrls, preferredKeys)

  const preferred = Array.from(keyedUrls).filter((url) => hasExtension(url, extensions))
  if (preferred.length > 0) return preferred

  const urls = new Set<string>()
  collectUrls(value, urls)
  return Array.from(urls).filter((url) => hasExtension(url, extensions))
}

function collectKeyedUrls(value: unknown, urls: Set<string>, preferredKeys: string[]) {
  if (!value || typeof value !== "object") return

  if (Array.isArray(value)) {
    value.forEach((item) => collectKeyedUrls(item, urls, preferredKeys))
    return
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()

    if (preferredKeys.includes(normalizedKey)) {
      collectUrls(nested, urls)
      continue
    }

    collectKeyedUrls(nested, urls, preferredKeys)
  }
}

function collectUrls(value: unknown, urls: Set<string>) {
  if (!value) return

  if (typeof value === "string") {
    for (const url of extractUrlsFromString(value)) {
      urls.add(url)
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls))
    return
  }

  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectUrls(item, urls))
  }
}

function hasExtension(url: string, extensions: string[]) {
  if (url.startsWith("data:image/")) return true
  const normalized = url.split("?")[0].toLowerCase()
  return extensions.some((extension) => normalized.endsWith(`.${extension}`))
}

function extractUrlsFromString(value: string) {
  const urls: string[] = []
  const dataUrlPattern = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi
  const httpUrlPattern = /https?:\/\/[^\s"'<>()[\]]+/gi

  for (const match of value.matchAll(dataUrlPattern)) {
    urls.push(trimExtractedUrl(match[0]))
  }

  for (const match of value.matchAll(httpUrlPattern)) {
    urls.push(trimExtractedUrl(match[0]))
  }

  return urls.filter(Boolean)
}

function trimExtractedUrl(value: string) {
  return value.replace(/[),.;]+$/g, "")
}

function logYunwu(label: string, value: unknown) {
  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[Yunwu] ${label}`, value)
}
