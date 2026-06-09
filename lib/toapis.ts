import type { GenerationResponse, NormalizedTaskStatus } from "@/lib/generation-types"
import { toapisGptImage2ApiModelName } from "@/lib/model-options"

const TOAPIS_BASE_URL = process.env.TOAPIS_BASE_URL ?? "https://toapis.com"

interface ToapisImageGenerationRequest {
  imageCount: number
  prompt: string
  quality: string
  ratio: string
  referenceImages?: string[]
}

interface ToapisTaskStatusResponse {
  data?: unknown
  error?: unknown
  id?: string
  result?: unknown
  status?: string
  task_id?: string
}

export async function createToapisGptImageTask(request: ToapisImageGenerationRequest): Promise<GenerationResponse> {
  const payload = {
    model: toapisGptImage2ApiModelName,
    prompt: request.prompt,
    n: request.imageCount,
    size: request.ratio,
    resolution: request.quality,
    response_format: "url",
    ...(request.referenceImages?.length ? { reference_images: request.referenceImages } : {}),
  }

  logToapis("submit.input", {
    imageCount: request.imageCount,
    promptLength: request.prompt.length,
    quality: request.quality,
    ratio: request.ratio,
    referenceImages: request.referenceImages?.length ?? 0,
  })

  const response = await toapisRequest("/v1/images/generations", "POST", payload) as ToapisTaskStatusResponse
  const taskId = findStringValue(response, ["task_id", "taskId", "id"])

  if (!taskId) {
    throw new Error("ToAPIs 未返回有效任务 ID。")
  }

  const status = normalizeToapisStatus(findStringValue(response, ["status"]) || "queued")
  logToapis("submit.output", {
    status,
    taskId,
  })

  return {
    ok: true,
    mode: "toapis",
    taskId,
    status,
    type: "image",
  }
}

export async function getToapisImageTaskStatus(taskId: string): Promise<NormalizedTaskStatus> {
  const response = await toapisRequest(`/v1/images/generations/${encodeURIComponent(taskId)}`, "GET") as ToapisTaskStatusResponse
  const status = normalizeToapisStatus(findStringValue(response, ["status"]) || "processing")
  const resultPayload = findUnknownValue(response, ["result", "output"])
  const imageUrls =
    status === "completed" && resultPayload
      ? extractMediaUrls(resultPayload, ["url", "image_url", "image_urls", "data"], [
          "jpg",
          "jpeg",
          "png",
          "webp",
          "gif",
          "avif",
        ])
      : []
  const taskError = status === "failed" ? extractToapisError(response) || "ToAPIs 图片生成失败。" : ""

  logToapis("sync.output", {
    imageUrls: imageUrls.length,
    status,
    taskError,
    taskId,
  })

  return {
    ok: true,
    mode: "toapis",
    taskId,
    status,
    progress: status === "completed" || status === "failed" ? 100 : 0,
    imageUrls,
    videoUrl: "",
    taskError,
    raw: response,
  }
}

export function isToapisRateLimitError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("rate limit") || normalized.includes("too many requests") || normalized.includes("429")
}

export function assertToapisConfigured() {
  getToapisApiKey()
}

async function toapisRequest(path: string, method: "GET" | "POST", body?: Record<string, unknown>) {
  const apiKey = getToapisApiKey()
  const url = new URL(path, TOAPIS_BASE_URL)
  let response: Response

  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    })
  } catch (error) {
    throw new Error(`无法连接 ToAPIs：${error instanceof Error ? error.message : "网络请求失败。"}`, { cause: error })
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(`ToAPIs 请求失败：HTTP ${response.status} ${extractToapisError(data) || response.statusText}`)
  }

  return data
}

function getToapisApiKey() {
  const apiKey = process.env.TOAPIS_API_KEY
  if (!apiKey) {
    throw new Error("ToAPIs API Key 未配置，请设置 TOAPIS_API_KEY。")
  }
  return apiKey
}

function normalizeToapisStatus(status: string): NormalizedTaskStatus["status"] {
  const normalized = status.trim().toLowerCase()
  if (normalized === "completed" || normalized === "succeeded" || normalized === "success") return "completed"
  if (normalized === "failed" || normalized === "error" || normalized === "cancelled" || normalized === "canceled") return "failed"
  if (normalized === "queued" || normalized === "pending" || normalized === "submitted") return "submitted"
  return "processing"
}

function extractToapisError(value: unknown): string {
  const message = findStringValue(value, ["message", "error_message", "error", "detail", "details"])
  return message
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

function findUnknownValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object") return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUnknownValue(item, keys)
      if (found) return found
    }
    return null
  }

  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key)) return nested
    const found = findUnknownValue(nested, keys)
    if (found) return found
  }

  return null
}

function extractMediaUrls(value: unknown, preferredKeys: string[], extensions: string[]) {
  const keyedUrls = new Set<string>()
  collectKeyedUrls(value, keyedUrls, preferredKeys)

  const preferred = Array.from(keyedUrls).filter(isPreferredMediaUrl)
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

function isPreferredMediaUrl(url: string) {
  if (url.startsWith("data:image/")) return true
  return /^https?:\/\//i.test(url)
}

function extractUrlsFromString(value: string) {
  const urls: string[] = []
  const httpUrlPattern = /https?:\/\/[^\s"'<>()[\]]+/gi

  for (const match of value.matchAll(httpUrlPattern)) {
    urls.push(match[0].replace(/[),.;]+$/g, ""))
  }

  return urls.filter(Boolean)
}

function logToapis(label: string, value: unknown) {
  if (label.includes("error") || label.includes("failed")) {
    console.warn(`[ToAPIs] ${label}`, value)
    return
  }

  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[ToAPIs] ${label}`, value)
}
