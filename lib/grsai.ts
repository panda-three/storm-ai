import type { GenerationResponse, NormalizedTaskStatus } from "@/lib/generation-types"
import { grsaiNanoBanana2ImageApiModelName } from "@/lib/model-options"

const GRSAI_BASE_URL = process.env.GRSAI_BASE_URL ?? "https://grsaiapi.com"
const grsaiResponseMetaKey = "_grsaiResponseMeta"

export interface GrsaiUpstreamTask {
  error?: string
  id: string
  resultUrls?: string[]
}

interface GrsaiUpstreamTaskEnvelope {
  provider: "grsai"
  tasks: GrsaiUpstreamTask[]
}

interface GrsaiImageGenerationRequest {
  prompt: string
  quality: string
  ratio: string
  referenceImages?: string[]
}

export async function createGrsaiNanoBanana2ImageTask(request: GrsaiImageGenerationRequest): Promise<GenerationResponse> {
  const payload = {
    model: grsaiNanoBanana2ImageApiModelName,
    prompt: request.prompt,
    imageSize: request.quality,
    aspectRatio: request.ratio,
    replyType: "async",
    ...(request.referenceImages?.length ? { images: request.referenceImages } : {}),
  }

  logGrsai("submit.input", {
    promptLength: request.prompt.length,
    quality: request.quality,
    ratio: request.ratio,
    referenceImages: request.referenceImages?.length ?? 0,
  })

  const response = await grsaiRequest("/v1/api/generate", "POST", payload)
  const taskId = extractGrsaiTaskId(response)

  if (!taskId) {
    const summary = summarizeGrsaiResponse(response)
    logGrsai("submit.invalid_response", summary)
    throw new Error(`GrsAi 未返回有效任务 ID。响应摘要：${JSON.stringify(summary)}`)
  }

  const status = normalizeGrsaiStatus(findStringValue(response, ["status", "state"]) || "submitted")
  logGrsai("submit.output", {
    status,
    taskId: maskId(taskId),
  })

  return {
    ok: true,
    mode: "grsai",
    taskId,
    status,
    type: "image",
  }
}

export async function getGrsaiImageTaskStatus(taskId: string): Promise<NormalizedTaskStatus> {
  const response = await grsaiRequest(`/v1/api/result?id=${encodeURIComponent(taskId)}`, "GET")
  return normalizeGrsaiTaskStatus(taskId, response)
}

export function normalizeGrsaiTaskStatus(taskId: string, response: unknown): NormalizedTaskStatus {
  const status = normalizeGrsaiStatus(findStringValue(response, ["status", "state"]) || "processing")
  const imageUrls = status === "completed" ? extractGrsaiImageUrls(response) : []
  const taskError =
    status === "completed" && imageUrls.length === 0
      ? "GrsAi 任务已完成，但接口没有返回图片地址。"
      : status === "failed"
        ? extractGrsaiError(response) || "GrsAi 图片生成失败。"
        : ""

  logGrsai("sync.output", {
    imageUrls: imageUrls.length,
    status,
    taskError,
    taskId: maskId(taskId),
  })

  return {
    ok: true,
    mode: "grsai",
    taskId,
    status,
    progress: status === "completed" || status === "failed" ? 100 : 0,
    imageUrls,
    videoUrl: "",
    taskError,
    raw: response,
  }
}

export function normalizeGrsaiStatus(status: string): NormalizedTaskStatus["status"] {
  const normalized = status.trim().toLowerCase()
  if (normalized === "succeeded" || normalized === "success" || normalized === "completed" || normalized === "complete") return "completed"
  if (normalized === "failed" || normalized === "failure" || normalized === "error" || normalized === "violation" || normalized === "violated") return "failed"
  if (normalized === "queued" || normalized === "pending" || normalized === "submitted" || normalized === "created") return "submitted"
  return "processing"
}

export function isGrsaiRateLimitError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("rate limit") || normalized.includes("too many requests") || normalized.includes("429")
}

export function assertGrsaiConfigured() {
  getGrsaiApiKey()
}

export function buildGrsaiUpstreamTaskId(tasks: GrsaiUpstreamTask[]) {
  const normalizedTasks = tasks
    .map((task) => ({
      error: task.error || undefined,
      id: task.id,
      resultUrls: task.resultUrls && task.resultUrls.length > 0 ? task.resultUrls : undefined,
    }))
    .filter((task) => task.id)

  if (normalizedTasks.length === 1) return normalizedTasks[0].id

  const envelope: GrsaiUpstreamTaskEnvelope = {
    provider: "grsai",
    tasks: normalizedTasks,
  }
  return JSON.stringify(envelope)
}

export function parseGrsaiUpstreamTaskId(value: string): GrsaiUpstreamTask[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value) as Partial<GrsaiUpstreamTaskEnvelope>
    if (parsed?.provider === "grsai" && Array.isArray(parsed.tasks)) {
      return parsed.tasks
        .map((task) => ({
          error: typeof task?.error === "string" ? task.error : undefined,
          id: typeof task?.id === "string" ? task.id : "",
          resultUrls: Array.isArray(task?.resultUrls)
            ? task.resultUrls.filter((url): url is string => typeof url === "string" && url.length > 0)
            : undefined,
        }))
        .filter((task) => task.id)
    }
  } catch {
    return [{ id: value }]
  }

  return [{ id: value }]
}

async function grsaiRequest(path: string, method: "GET" | "POST", body?: Record<string, unknown>) {
  const apiKey = getGrsaiApiKey()
  const url = new URL(path, GRSAI_BASE_URL)
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
    throw new Error(`无法连接 GrsAi：${error instanceof Error ? error.message : "网络请求失败。"}`, { cause: error })
  }

  const bodyText = await response.text().catch(() => "")
  const data = parseGrsaiResponseBody(bodyText)
  const responseData = attachGrsaiResponseMeta(data, {
    bodyPreview: truncateString(bodyText.trim(), 300),
    contentType: response.headers.get("content-type") ?? "",
    httpStatus: response.status,
  })

  if (!response.ok) {
    throw new Error(`GrsAi 请求失败：HTTP ${response.status} ${extractGrsaiError(responseData) || response.statusText}`)
  }

  return responseData
}

function getGrsaiApiKey() {
  const apiKey = process.env.GRSAI_API_KEY
  if (!apiKey) {
    throw new Error("GrsAi API Key 未配置，请设置 GRSAI_API_KEY。")
  }
  return apiKey
}

function extractGrsaiTaskId(value: unknown) {
  return findStringValue(value, ["id", "task_id", "taskId"])
}

function extractGrsaiImageUrls(value: unknown) {
  const resultPayload = findUnknownValue(value, ["results", "result", "output", "data"]) ?? value
  return uniqueUrls(collectImageUrls(resultPayload))
}

function extractGrsaiError(value: unknown): string {
  return findStringValue(value, ["message", "error_message", "error", "detail", "details", "reason"])
}

function parseGrsaiResponseBody(value: string): unknown {
  const text = value.trim()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    const eventData = parseServerSentEventJson(text)
    return eventData ?? {}
  }
}

function parseServerSentEventJson(value: string): unknown {
  const dataLines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]")

  for (const line of dataLines) {
    try {
      return JSON.parse(line)
    } catch {
      continue
    }
  }

  return null
}

function attachGrsaiResponseMeta(value: unknown, meta: Record<string, unknown>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      value,
      [grsaiResponseMetaKey]: meta,
    }
  }

  return {
    ...(value as Record<string, unknown>),
    [grsaiResponseMetaKey]: meta,
  }
}

function summarizeGrsaiResponse(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      type: typeof value,
    }
  }

  const record = value as Record<string, unknown>
  const meta = record[grsaiResponseMetaKey] && typeof record[grsaiResponseMetaKey] === "object"
    ? record[grsaiResponseMetaKey] as Record<string, unknown>
    : {}

  return {
    bodyPreview: typeof meta.bodyPreview === "string" ? meta.bodyPreview : "",
    contentType: typeof meta.contentType === "string" ? meta.contentType : "",
    error: truncateString(extractGrsaiError(record), 300),
    httpStatus: typeof meta.httpStatus === "number" ? meta.httpStatus : null,
    keys: Object.keys(record).filter((key) => key !== grsaiResponseMetaKey).slice(0, 20),
    status: truncateString(findStringValue(record, ["status", "state"]), 80),
  }
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

function collectImageUrls(value: unknown): string[] {
  if (!value) return []

  if (typeof value === "string") {
    return extractUrlsFromString(value).filter(isImageUrl)
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectImageUrls)
  }

  if (typeof value !== "object") return []

  const urls: string[] = []
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey === "url" || normalizedKey === "image_url" || normalizedKey === "imageurl") {
      urls.push(...collectUrls(nested).filter(isImageUrl))
      continue
    }
    urls.push(...collectImageUrls(nested))
  }
  return urls
}

function collectUrls(value: unknown): string[] {
  if (!value) return []
  if (typeof value === "string") return extractUrlsFromString(value)
  if (Array.isArray(value)) return value.flatMap(collectUrls)
  if (typeof value === "object") return Object.values(value).flatMap(collectUrls)
  return []
}

function extractUrlsFromString(value: string) {
  const urls: string[] = []
  const httpUrlPattern = /https?:\/\/[^\s"'<>]+/gi
  let match: RegExpExecArray | null
  while ((match = httpUrlPattern.exec(value))) {
    urls.push(match[0].replace(/[),.;]+$/, ""))
  }
  return urls
}

function isImageUrl(url: string) {
  if (url.startsWith("data:image/")) return true
  const normalized = url.split("?")[0].toLowerCase()
  return /^https?:\/\//i.test(url) && ["jpg", "jpeg", "png", "webp", "gif", "avif"].some((extension) => normalized.endsWith(`.${extension}`))
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.filter(Boolean)))
}

function truncateString(value: string, maxLength: number) {
  if (!value || value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function logGrsai(label: string, value: unknown) {
  if (label.includes("error") || label.includes("failed") || label.includes("invalid")) {
    console.warn(`[GrsAi] ${label}`, value)
    return
  }

  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[GrsAi] ${label}`, value)
}

function maskId(value: string) {
  if (!value) return ""
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}
