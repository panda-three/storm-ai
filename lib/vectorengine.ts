import { vectorEngineGeminiImageApiModelName } from "@/lib/model-options"

const VECTORENGINE_BASE_URL = process.env.VECTORENGINE_BASE_URL ?? "https://api.vectorengine.cn"
const vectorEngineDefaultTimeoutMs = 60_000
const vectorEngineGeminiImageTimeoutMs = 360_000

export interface VectorEngineReferenceImage {
  buffer: Buffer
  mimeType: string
}

export interface VectorEngineGeminiImageRequest {
  model: string
  prompt: string
  quality: string
  ratio: string
  referenceImages: VectorEngineReferenceImage[]
}

export interface VectorEngineGeneratedImage {
  buffer: Buffer
  mimeType: string
}

interface GeminiInlineData {
  data?: unknown
  mime_type?: unknown
  mimeType?: unknown
}

export function assertVectorEngineConfigured() {
  getVectorEngineApiKey()
}

export async function createVectorEngineGeminiImage(
  request: VectorEngineGeminiImageRequest
): Promise<VectorEngineGeneratedImage> {
  const apiKey = getVectorEngineApiKey()
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
  const url = new URL(`/v1beta/models/${vectorEngineGeminiImageApiModelName}:generateContent`, VECTORENGINE_BASE_URL)
  url.searchParams.set("key", apiKey)

  logVectorEngine("gemini image input", {
    model: request.model,
    apiModel: vectorEngineGeminiImageApiModelName,
    promptLength: request.prompt.length,
    quality: request.quality,
    ratio: request.ratio,
    referenceImageCount: request.referenceImages.length,
  })

  const data = await vectorEngineJsonRequest(
    url,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: vectorEngineGeminiImageTimeoutMs,
      timeoutMessage: "VectorEngine 图片生成等待超时，请稍后重试，或减少参考图后再试。",
    }
  )
  const image = extractFirstGeneratedImage(data)

  logVectorEngine("gemini image output", {
    byteLength: image.buffer.byteLength,
    mimeType: image.mimeType,
  })

  return image
}

async function vectorEngineJsonRequest(
  pathOrUrl: string | URL,
  init: RequestInit,
  {
    timeoutMessage = "VectorEngine 请求等待超时，请稍后重试。",
    timeoutMs = vectorEngineDefaultTimeoutMs,
  }: {
    timeoutMessage?: string
    timeoutMs?: number
  } = {}
) {
  const apiKey = getVectorEngineApiKey()
  const url = typeof pathOrUrl === "string" ? new URL(pathOrUrl, VECTORENGINE_BASE_URL) : pathOrUrl
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
    throw new Error(describeVectorEngineError(response.status, data))
  }

  return data
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

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
}

function getVectorEngineApiKey() {
  const apiKey = process.env.VECTORENGINE_API_KEY
  if (!apiKey) {
    throw new Error("缺少 VectorEngine API Key，请配置 VECTORENGINE_API_KEY。")
  }
  return apiKey
}

function extractFirstGeneratedImage(value: unknown): VectorEngineGeneratedImage {
  const inlineData = findInlineData(value)
  const data = typeof inlineData?.data === "string" ? inlineData.data : ""
  const mimeType =
    typeof inlineData?.mime_type === "string"
      ? inlineData.mime_type
      : typeof inlineData?.mimeType === "string"
        ? inlineData.mimeType
        : "image/png"

  if (!data) {
    throw new Error("VectorEngine Gemini 已返回响应，但未包含可用图片数据。")
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

  if ("inline_data" in value) {
    const inlineData = (value as { inline_data?: unknown }).inline_data
    if (inlineData && typeof inlineData === "object") return inlineData as GeminiInlineData
  }

  if ("inlineData" in value) {
    const inlineData = (value as { inlineData?: unknown }).inlineData
    if (inlineData && typeof inlineData === "object") return inlineData as GeminiInlineData
  }

  for (const nested of Object.values(value)) {
    const found = findInlineData(nested)
    if (found) return found
  }

  return null
}

function describeVectorEngineError(status: number, data: unknown) {
  const message = extractErrorMessage(data)
  return `VectorEngine 请求失败（${status}）${message ? `：${message}` : ""}`
}

function extractErrorMessage(value: unknown): string {
  if (!value || typeof value !== "object") return ""

  const direct = findStringValue(value, ["message", "error", "detail", "msg"])
  if (direct) return direct

  if ("error" in value) {
    const error = (value as { error?: unknown }).error
    if (typeof error === "string") return error
    if (error && typeof error === "object") {
      return findStringValue(error, ["message", "detail", "code"]) || ""
    }
  }

  return ""
}

function findStringValue(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return ""

  for (const key of keys) {
    const item = (value as Record<string, unknown>)[key]
    if (typeof item === "string" && item.trim()) return item.trim()
  }

  return ""
}

function logVectorEngine(label: string, value: unknown) {
  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[VectorEngine] ${label}`, value)
}
