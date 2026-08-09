import type { GenerationResponse, NormalizedTaskStatus } from "@/lib/generation-types"
import {
  manjuGemini4KImageApiModelName,
  manjuGemini4KImageModelName,
  manjuGeminiOmniFlashVideoApiModelName,
  manjuGrokImagineImageProApiModelName,
  manjuGrokImagineImageProModelName,
  manjuGrokImagineVideoModelName,
  manjuGeminiImageApiModelName,
  manjuGeminiImageModelName,
  manjuGptImage2ApiModelName,
  manjuGptImage2ModelName,
  manjuNanoBanana24KImageApiModelName,
  manjuNanoBanana24KImageModelName,
  manjuNanoBanana2ImageApiModelName,
  manjuNanoBanana2ImageModelName,
  manjuVeo31Fast1080pVideoModelName,
  isManjuGeminiOmniFlashVideoModel,
} from "@/lib/model-options"

const MANJU_BASE_URL = process.env.MANJU_BASE_URL ?? "https://manjuapi.com"
const manjuRequestTimeoutMs = getPositiveEnvNumber("MANJU_REQUEST_TIMEOUT_MS", 60_000)
const manjuImageSubmitTimeoutMs = getPositiveEnvNumber("MANJU_IMAGE_SUBMIT_TIMEOUT_MS", 420_000)
const manjuImage4KSubmitTimeoutMs = getPositiveEnvNumber("MANJU_IMAGE_4K_SUBMIT_TIMEOUT_MS", 420_000)
const manjuVideoSubmitTimeoutMs = getPositiveEnvNumber("MANJU_VIDEO_SUBMIT_TIMEOUT_MS", 120_000)

interface ManjuImageRequest {
  model: string
  prompt: string
  quality: string
  ratio: string
  referenceImages?: string[]
}

interface ManjuVideoRequest {
  aspectRatio: string
  durationSeconds: number
  model: string
  prompt: string
  quality: string
  referenceImages?: string[]
}

export interface ManjuUpstreamTask {
  error?: string
  id: string
  pollUrl?: string
  resultUrls?: string[]
}

interface ManjuUpstreamTaskEnvelope {
  provider: "manju"
  tasks: ManjuUpstreamTask[]
}

interface ManjuTaskResponse {
  data?: unknown
  error?: unknown
  id?: string
  poll_url?: string
  progress?: number
  result?: unknown
  status?: string
  task_id?: string
}

export async function createManjuGeminiImageTask(request: ManjuImageRequest): Promise<GenerationResponse> {
  assertManjuConfigured()

  const payload = buildManjuChatImagePayload(request)

  logManju("image.submit.input", {
    model: request.model,
    apiModel: getManjuImageApiModel(request.model),
    promptLength: request.prompt.length,
    quality: request.quality,
    ratio: request.ratio,
    referenceImages: request.referenceImages?.length ?? 0,
  })
  logManju("image.submit.payload", summarizeManjuImagePayload(payload))

  const data = await manjuRequest("/v1/chat/completions", "POST", payload, {
    timeoutMessage: buildManjuImageSubmitTimeoutMessage(request),
    timeoutMs: getManjuImageSubmitTimeoutMs(request),
  }) as ManjuTaskResponse
  const taskId = findStringValue(data, ["task_id", "taskId", "id"])

  if (!taskId) {
    throw new Error("Manju 未返回有效任务 ID。")
  }

  const status = normalizeManjuStatus(findStringValue(data, ["status"]) || "queued")
  const imageUrls = status === "completed" ? extractManjuImageUrls(data) : []
  const pollUrl = normalizeManjuPollUrl(findStringValue(data, ["poll_url", "pollUrl"]))
  const progress = findNumberValue(data, ["progress", "percentage"]) ?? (status === "completed" || status === "failed" ? 100 : 0)
  const taskError = status === "failed" ? extractManjuError(data) || "Manju 图片生成失败。" : ""

  logManju("image.submit.output", {
    imageUrls: imageUrls.length,
    pollUrl: Boolean(pollUrl),
    progress,
    status,
    taskId,
    taskError,
  })

  return {
    imageUrls,
    ok: true,
    mode: "manju",
    pollUrl,
    progress,
    raw: data,
    taskId,
    taskError,
    status,
    type: "image",
  }
}

export async function getManjuImageTaskStatus(taskIdOrPollUrl: string): Promise<NormalizedTaskStatus> {
  const taskId = extractManjuTaskId(taskIdOrPollUrl)
  const response = await manjuRequest(getManjuTaskStatusPath(taskIdOrPollUrl), "GET") as ManjuTaskResponse
  const status = normalizeManjuStatus(findStringValue(response, ["status"]) || "processing")
  const imageUrls = status === "completed" ? extractManjuImageUrls(response) : []
  const taskError = status === "failed" ? extractManjuError(response) || "Manju 图片生成失败。" : ""
  const progress = findNumberValue(response, ["progress", "percentage"]) ?? (status === "completed" || status === "failed" ? 100 : 0)

  logManju("sync.output", {
    imageUrls: imageUrls.length,
    progress,
    status,
    taskError,
    taskId,
  })

  return {
    ok: true,
    mode: "manju",
    taskId,
    status,
    progress,
    imageUrls,
    videoUrl: "",
    taskError,
    raw: response,
  }
}

export async function createManjuVideoTask(request: ManjuVideoRequest): Promise<GenerationResponse> {
  assertManjuConfigured()

  const payload = buildManjuVideoPayload(request)
  const referenceCount = request.referenceImages?.length ?? 0

  logManju("video.submit.input", {
    aspectRatio: request.aspectRatio,
    durationSeconds: request.durationSeconds,
    apiModel: getManjuVideoApiModel(request.model),
    model: request.model,
    promptLength: request.prompt.length,
    quality: request.quality,
    referenceImages: referenceCount,
  })
  logManju("video.submit.payload", summarizeManjuVideoPayload(payload))

  const data = await manjuRequest("/v1/chat/completions", "POST", payload, {
    timeoutMessage: "Manju 视频任务提交等待超时，请稍后重试。",
    timeoutMs: manjuVideoSubmitTimeoutMs,
  }) as ManjuTaskResponse
  const taskId = findStringValue(data, ["task_id", "taskId", "id"])

  if (!taskId) {
    throw new Error("Manju 视频接口未返回有效任务 ID。")
  }

  const status = normalizeManjuStatus(findStringValue(data, ["status"]) || "queued")
  const pollUrl = normalizeManjuPollUrl(findStringValue(data, ["poll_url", "pollUrl"]))
  const progress = findNumberValue(data, ["progress", "percentage"]) ?? (status === "completed" || status === "failed" ? 100 : 0)
  const taskError = status === "failed" ? extractManjuError(data) || "Manju 视频生成失败。" : ""

  logManju("video.submit.output", {
    pollUrl: Boolean(pollUrl),
    progress,
    referenceCount: findNumberValue(data, ["reference_count", "referenceCount"]),
    status,
    taskId,
    taskError,
  })

  return {
    ok: true,
    mode: "manju",
    pollUrl,
    progress,
    raw: data,
    taskId,
    taskError,
    status,
    type: "video",
  }
}

export const createManjuGrokImagineVideoTask = createManjuVideoTask

export async function getManjuVideoTaskStatus(taskIdOrPollUrl: string): Promise<NormalizedTaskStatus> {
  const taskId = extractManjuTaskId(taskIdOrPollUrl)
  const response = await manjuRequest(getManjuVideoTaskStatusPath(taskIdOrPollUrl), "GET") as ManjuTaskResponse
  const status = normalizeManjuStatus(findStringValue(response, ["status"]) || "processing")
  const videoUrl = status === "completed" ? extractManjuVideoUrls(response)[0] ?? "" : ""
  const taskError = status === "failed" ? extractManjuError(response) || "Manju 视频生成失败。" : ""
  const progress = findNumberValue(response, ["progress", "percentage"]) ?? (status === "completed" || status === "failed" ? 100 : 0)

  logManju("video.sync.output", {
    progress,
    status,
    taskError,
    taskId,
    videoUrl: Boolean(videoUrl),
  })

  return {
    ok: true,
    mode: "manju",
    taskId,
    status,
    progress,
    imageUrls: [],
    videoUrl,
    taskError,
    raw: response,
  }
}

export function isManjuRateLimitError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("rate limit") || normalized.includes("too many requests") || normalized.includes("429")
}

export function assertManjuConfigured() {
  if (!process.env.MANJU_API_KEY) {
    throw new Error("Manju API Key 未配置，请设置 MANJU_API_KEY。")
  }
}

export function buildManjuUpstreamTaskId(tasks: ManjuUpstreamTask[]) {
  const normalizedTasks = tasks
    .map((task) => ({
      error: task.error || undefined,
      id: task.id,
      pollUrl: task.pollUrl || undefined,
      resultUrls: task.resultUrls && task.resultUrls.length > 0 ? task.resultUrls : undefined,
    }))
    .filter((task) => task.id || task.pollUrl)

  if (normalizedTasks.length === 1) return normalizedTasks[0].pollUrl || normalizedTasks[0].id

  const envelope: ManjuUpstreamTaskEnvelope = {
    provider: "manju",
    tasks: normalizedTasks,
  }
  return JSON.stringify(envelope)
}

export function parseManjuUpstreamTaskId(value: string): ManjuUpstreamTask[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value) as Partial<ManjuUpstreamTaskEnvelope>
    if (parsed?.provider === "manju" && Array.isArray(parsed.tasks)) {
      return parsed.tasks
        .map((task) => ({
          error: typeof task?.error === "string" ? task.error : undefined,
          id: typeof task?.id === "string" ? task.id : "",
          pollUrl: typeof task?.pollUrl === "string" ? task.pollUrl : undefined,
          resultUrls: Array.isArray(task?.resultUrls)
            ? task.resultUrls.filter((url): url is string => typeof url === "string" && url.length > 0)
            : undefined,
        }))
        .filter((task) => task.id || task.pollUrl)
    }
  } catch {
    return [{ id: extractManjuTaskId(value), pollUrl: normalizeManjuPollUrl(value) || undefined }]
  }

  return [{ id: extractManjuTaskId(value), pollUrl: normalizeManjuPollUrl(value) || undefined }]
}

function buildManjuChatImagePayload(request: ManjuImageRequest) {
  return {
    model: getManjuImageApiModel(request.model),
    stream: false,
    aspect_ratio: normalizeManjuImageRatio(request.ratio),
    output_resolution: normalizeManjuImageResolution(request.quality),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: request.prompt,
          },
          ...(request.referenceImages ?? []).map((url) => ({
            type: "image_url",
            image_url: {
              url,
            },
          })),
        ],
      },
    ],
  }
}

function buildManjuVideoPayload(request: ManjuVideoRequest): Record<string, unknown> {
  const referenceImages = request.referenceImages ?? []
  const common = {
    model: getManjuVideoApiModel(request.model),
    aspect_ratio: normalizeManjuVideoRatio(request.aspectRatio),
    resolution: normalizeManjuVideoResolution(request.quality),
  }

  if (isManjuGeminiOmniFlashVideoModel(request.model)) {
    return {
      ...common,
      prompt: request.prompt,
      duration: normalizeManjuOmniFlashVideoDuration(request.durationSeconds),
      input_reference: referenceImages,
    }
  }

  if (referenceImages.length === 0) {
    return {
      ...common,
      duration: normalizeManjuVideoDuration(request.durationSeconds),
      prompt: request.prompt,
    }
  }

  return {
    ...common,
    duration: normalizeManjuVideoDuration(request.durationSeconds),
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: request.prompt,
          },
          ...referenceImages.map((url) => ({
            type: "image_url",
            image_url: {
              url,
            },
          })),
        ],
      },
    ],
  }
}

function summarizeManjuImagePayload(payload: ReturnType<typeof buildManjuChatImagePayload>) {
  const content = payload.messages[0]?.content ?? []
  const imageUrlCount = content.filter((item) => item.type === "image_url").length
  const textCount = content.filter((item) => item.type === "text").length

  return {
    aspect_ratio: payload.aspect_ratio,
    contentItems: content.length,
    imageUrlCount,
    model: payload.model,
    output_resolution: payload.output_resolution,
    stream: payload.stream,
    textCount,
  }
}

function summarizeManjuVideoPayload(payload: Record<string, unknown>) {
  const inputReference = Array.isArray(payload.input_reference) ? payload.input_reference : []
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const firstMessage = messages[0] && typeof messages[0] === "object" ? messages[0] as Record<string, unknown> : {}
  const content = Array.isArray(firstMessage.content) ? firstMessage.content : []
  const imageUrlCount = content.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "image_url").length
  const textCount = content.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text").length

  return {
    aspect_ratio: payload.aspect_ratio,
    contentItems: content.length,
    duration: payload.duration,
    inputReferenceCount: inputReference.length,
    imageUrlCount,
    model: payload.model,
    promptLength: typeof payload.prompt === "string" ? payload.prompt.length : 0,
    resolution: payload.resolution,
    stream: payload.stream,
    textCount,
  }
}

function normalizeManjuImageRatio(ratio: string) {
  const value = ratio.trim()
  return value && value !== "默认" && value !== "auto" ? value : "1:1"
}

function normalizeManjuImageResolution(quality: string) {
  const normalized = quality.trim().toUpperCase()
  if (normalized === "4K") return "4K"
  return normalized === "2K" ? "2K" : "1K"
}

function normalizeManjuVideoDuration(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds)) return "6"
  return String(Math.trunc(durationSeconds) || 6)
}

function normalizeManjuOmniFlashVideoDuration(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds)) return 6

  const value = Math.trunc(durationSeconds) || 6
  return Math.min(10, Math.max(3, value))
}

function normalizeManjuVideoRatio(ratio: string) {
  const normalized = ratio.trim()
  if (normalized === "9:16" || normalized === "1:1") return normalized
  return "16:9"
}

function normalizeManjuVideoResolution(quality: string) {
  const normalized = quality.trim().toUpperCase()
  if (normalized === "480P") return "480p"
  if (normalized === "1080P") return "1080p"
  return "720p"
}

function getManjuImageApiModel(model: string) {
  if (model === manjuGeminiImageModelName) return manjuGeminiImageApiModelName
  if (model === manjuGemini4KImageModelName) return manjuGemini4KImageApiModelName
  if (model === manjuNanoBanana2ImageModelName) return manjuNanoBanana2ImageApiModelName
  if (model === manjuNanoBanana24KImageModelName) return manjuNanoBanana24KImageApiModelName
  if (model === manjuGptImage2ModelName) return manjuGptImage2ApiModelName
  if (model === manjuGrokImagineImageProModelName) return manjuGrokImagineImageProApiModelName
  return model
}

function getManjuVideoApiModel(model: string) {
  if (isManjuGeminiOmniFlashVideoModel(model)) return manjuGeminiOmniFlashVideoApiModelName
  if (model === manjuGrokImagineVideoModelName) return manjuGrokImagineVideoModelName
  if (model === manjuVeo31Fast1080pVideoModelName) return manjuVeo31Fast1080pVideoModelName
  return model
}

function getManjuTaskStatusPath(taskIdOrPollUrl: string) {
  const pollUrl = normalizeManjuPollUrl(taskIdOrPollUrl)
  if (pollUrl) return pollUrl
  return `/api/tasks/${encodeURIComponent(taskIdOrPollUrl)}`
}

function getManjuVideoTaskStatusPath(taskIdOrPollUrl: string) {
  const pollUrl = normalizeManjuPollUrl(taskIdOrPollUrl)
  if (pollUrl) return pollUrl
  return `/v1/videos/${encodeURIComponent(taskIdOrPollUrl)}`
}

function extractManjuTaskId(taskIdOrPollUrl: string) {
  const pollUrl = normalizeManjuPollUrl(taskIdOrPollUrl)
  if (!pollUrl) return taskIdOrPollUrl

  const url = new URL(pollUrl)
  const parts = url.pathname.split("/").filter(Boolean)
  return parts[parts.length - 1] || taskIdOrPollUrl
}

function normalizeManjuPollUrl(value: string) {
  if (!value) return ""

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return ""
  }

  const baseUrl = new URL(MANJU_BASE_URL)
  if (url.protocol !== baseUrl.protocol || url.host !== baseUrl.host) {
    console.warn("[Manju] ignored untrusted poll_url", {
      host: url.host,
      protocol: url.protocol,
    })
    return ""
  }

  if (!url.pathname.startsWith("/api/tasks/") && !url.pathname.startsWith("/v1/videos/")) return ""
  return url.toString()
}

async function manjuRequest(
  pathOrUrl: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  {
    timeoutMessage = "Manju 请求等待超时，请稍后重试。",
    timeoutMs = manjuRequestTimeoutMs,
  }: {
    timeoutMessage?: string
    timeoutMs?: number
  } = {}
) {
  const apiKey = process.env.MANJU_API_KEY
  const url = new URL(pathOrUrl, MANJU_BASE_URL)
  let response: Response

  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(timeoutMessage, { cause: error })
    }
    throw new Error(`无法连接 Manju：${error instanceof Error ? error.message : "网络请求失败。"}`, { cause: error })
  }

  const data = await response.json().catch(() => ({}))
  logManjuRawResponse(url.pathname, response.status, data)

  if (!response.ok) {
    throw new Error(`Manju 请求失败：HTTP ${response.status} ${extractManjuError(data) || response.statusText}`)
  }

  const code = findNumberValue(data, ["code", "status_code"])
  if (code && code !== 200) {
    throw new Error(extractManjuError(data) || `Manju 请求失败：code ${code}`)
  }

  return data
}

function getManjuImageSubmitTimeoutMs(request: ManjuImageRequest) {
  if (isManju4KImageRequest(request)) return manjuImage4KSubmitTimeoutMs
  return manjuImageSubmitTimeoutMs
}

function buildManjuImageSubmitTimeoutMessage(request: ManjuImageRequest) {
  if (isManju4KImageRequest(request)) {
    return "Manju 4K 生图提交等待超时，请稍后重试，或降低清晰度、减少参考图后再试。"
  }

  return "Manju 生图提交等待超时，请稍后重试，或减少参考图后再试。"
}

function isManju4KImageRequest(request: ManjuImageRequest) {
  return (
    request.quality.trim().toUpperCase() === "4K" ||
    request.model === manjuGemini4KImageModelName ||
    request.model === manjuNanoBanana24KImageModelName
  )
}

function getPositiveEnvNumber(key: string, fallback: number) {
  const value = Number.parseInt(process.env[key] ?? "", 10)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

function isTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("operation was aborted")
  )
}

function extractManjuError(value: unknown) {
  return findStringValue(value, ["fail_reason", "failure_reason", "message", "error_message", "error", "detail", "details"])
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

function findNumberValue(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumberValue(item, keys)
      if (found !== null) return found
    }
    return null
  }

  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key) && typeof nested === "number") return nested
    const found = findNumberValue(nested, keys)
    if (found !== null) return found
  }

  return null
}

function extractManjuImageUrls(value: unknown) {
  return uniqueUrls(
    extractMediaUrls(
      value,
      [
        "detail_url",
        "download_url",
        "file_url",
        "final_url",
        "image",
        "image_url",
        "image_urls",
        "images",
        "output",
        "output_url",
        "result",
        "result_url",
        "url",
        "urls",
        "content",
        "data",
      ],
      ["jpg", "jpeg", "png", "webp", "gif", "avif"]
    )
  )
}

function extractManjuVideoUrls(value: unknown) {
  return uniqueUrls(
    extractMediaUrls(
      value,
      [
        "download_url",
        "file_url",
        "final_url",
        "output",
        "output_url",
        "result",
        "url",
        "urls",
        "video",
        "video_url",
        "video_urls",
        "videos",
        "content",
        "data",
      ],
      ["mp4", "mov", "webm", "m3u8"]
    )
  )
}

function extractMediaUrls(value: unknown, preferredKeys: string[], extensions: string[]) {
  const keyedUrls = new Set<string>()
  collectKeyedUrls(value, keyedUrls, preferredKeys)

  const preferred = Array.from(keyedUrls).map(normalizeManjuMediaUrl).filter(isMediaUrlCandidate)
  if (preferred.length > 0) return preferred

  const urls = new Set<string>()
  collectUrls(value, urls)
  return Array.from(urls).map(normalizeManjuMediaUrl).filter((url) => hasExtension(url, extensions))
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
    if (value.startsWith("/")) {
      urls.add(value)
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

function isMediaUrlCandidate(url: string) {
  if (url.startsWith("data:image/")) return true
  return /^https?:\/\//i.test(url)
}

function normalizeManjuMediaUrl(url: string) {
  if (!url.startsWith("/")) return url

  try {
    return new URL(url, MANJU_BASE_URL).toString()
  } catch {
    return url
  }
}

function extractUrlsFromString(value: string) {
  const urls: string[] = []
  const httpUrlPattern = /https?:\/\/[^\s"'<>()[\]]+/gi

  for (const match of value.matchAll(httpUrlPattern)) {
    urls.push(match[0].replace(/[),.;]+$/g, ""))
  }

  return urls.filter(Boolean)
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.filter(Boolean)))
}

function normalizeManjuStatus(status: string): NormalizedTaskStatus["status"] {
  const normalized = status.trim().toLowerCase()
  if (!normalized) return "processing"
  if (["completed", "succeeded", "success", "done", "finished"].includes(normalized)) return "completed"
  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "failed"
  if (["queued", "pending", "submitted"].includes(normalized)) return "submitted"
  return "processing"
}

function logManjuRawResponse(path: string, status: number, data: unknown) {
  console.log("[Manju] raw response", {
    path,
    status,
    data: sanitizeForLog(data),
  })
}

function sanitizeForLog(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return `${value.slice(0, 48)}...<data-url:${value.length}>`
    if (value.length > 1000) return `${value.slice(0, 1000)}...<truncated:${value.length}>`
    return value
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeForLog)
  }

  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      const normalizedKey = key.toLowerCase()
      if (normalizedKey.includes("key") || normalizedKey.includes("token") || normalizedKey === "authorization") {
        return [key, "<redacted>"]
      }
      return [key, sanitizeForLog(nested)]
    })
  )
}

function logManju(label: string, value: unknown) {
  if (label.includes("error") || label.includes("failed")) {
    console.warn(`[Manju] ${label}`, value)
    return
  }

  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[Manju] ${label}`, value)
}
