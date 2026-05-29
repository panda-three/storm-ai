import { manjuGeminiImageApiModelName } from "@/lib/model-options"

const MANJU_BASE_URL = process.env.MANJU_BASE_URL ?? "https://manjuapi.com"
const manjuImageTimeoutMs = 360_000

interface ManjuImageRequest {
  prompt: string
  quality: string
  ratio: string
  referenceImages?: string[]
}

export async function createManjuGeminiImage(request: ManjuImageRequest) {
  assertManjuConfigured()

  const payload = request.referenceImages?.length
    ? buildManjuChatImagePayload(request)
    : buildManjuTextImagePayload(request)

  logManju("image.submit.input", {
    promptLength: request.prompt.length,
    quality: request.quality,
    ratio: request.ratio,
    referenceImages: request.referenceImages?.length ?? 0,
  })

  const data = await manjuRequest(
    request.referenceImages?.length ? "/v1/chat/completions" : "/v1/images/generations",
    "POST",
    payload
  )
  const imageUrls = uniqueUrls(
    extractMediaUrls(data, ["url", "image_url", "image_urls", "content", "data", "poll_url", "result_url", "download_url"], [
      "jpg",
      "jpeg",
      "png",
      "webp",
      "gif",
      "avif",
    ])
  )

  if (imageUrls.length === 0) {
    throw new Error("Manju 图片接口已返回，但未找到可用图片地址。")
  }

  logManju("image.submit.output", {
    imageUrls: imageUrls.length,
  })

  return imageUrls[0]
}

export function assertManjuConfigured() {
  if (!process.env.MANJU_API_KEY) {
    throw new Error("Manju API Key 未配置，请设置 MANJU_API_KEY。")
  }
}

function buildManjuChatImagePayload(request: ManjuImageRequest) {
  return {
    model: manjuGeminiImageApiModelName,
    stream: false,
    aspect_ratio: request.ratio,
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

function buildManjuTextImagePayload(request: ManjuImageRequest) {
  return {
    model: manjuGeminiImageApiModelName,
    prompt: request.prompt,
    aspect_ratio: request.ratio,
    output_resolution: normalizeManjuImageResolution(request.quality),
  }
}

function normalizeManjuImageResolution(quality: string) {
  return quality.trim().toUpperCase() === "2K" ? "2K" : "1K"
}

async function manjuRequest(path: string, method: "POST", body: Record<string, unknown>) {
  const apiKey = process.env.MANJU_API_KEY
  const url = new URL(path, MANJU_BASE_URL)
  let response: Response

  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(manjuImageTimeoutMs),
    })
  } catch (error) {
    throw new Error(`无法连接 Manju：${error instanceof Error ? error.message : "网络请求失败。"}`, { cause: error })
  }

  const data = await response.json().catch(() => ({}))
  logManjuRawResponse(path, response.status, data)

  if (!response.ok) {
    throw new Error(`Manju 请求失败：HTTP ${response.status} ${extractManjuError(data) || response.statusText}`)
  }

  const code = findNumberValue(data, ["code", "status_code"])
  if (code && code !== 200) {
    throw new Error(extractManjuError(data) || `Manju 请求失败：code ${code}`)
  }

  return data
}

function extractManjuError(value: unknown) {
  return findStringValue(value, ["message", "error_message", "error", "detail", "details"])
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
  const httpUrlPattern = /https?:\/\/[^\s"'<>()[\]]+/gi

  for (const match of value.matchAll(httpUrlPattern)) {
    urls.push(match[0].replace(/[),.;]+$/g, ""))
  }

  return urls.filter(Boolean)
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.filter(Boolean)))
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
