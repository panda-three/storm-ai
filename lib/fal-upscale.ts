import type { UpscaleScale } from "@/lib/upscale-policy"

export interface FalUpscaleInput {
  imageBuffer: Buffer
  mimeType: string
  scale: UpscaleScale
}

export interface FalUpscaleResult {
  contentType: string
  fileName: string
  height: number | null
  imageUrl: string
  width: number | null
}

interface FalImageResult {
  content_type?: unknown
  file_name?: unknown
  height?: unknown
  url?: unknown
  width?: unknown
}

interface FalRunResponse {
  image?: FalImageResult
}

export async function upscaleImageWithFal({ imageBuffer, mimeType, scale }: FalUpscaleInput): Promise<FalUpscaleResult> {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY
  if (!key) {
    throw new Error("fal.ai API key 未配置。")
  }

  const response = await fetch("https://fal.run/fal-ai/esrgan", {
    body: JSON.stringify({
      image_url: `data:${mimeType};base64,${imageBuffer.toString("base64")}`,
      model: scale === 2 ? "RealESRGAN_x2plus" : "RealESRGAN_x4plus",
      output_format: "png",
      scale,
    }),
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  })

  const data = await response.json().catch(() => null) as FalRunResponse | { error?: string; detail?: string } | null
  if (!response.ok) {
    const message = data && "error" in data && typeof data.error === "string"
      ? data.error
      : data && "detail" in data && typeof data.detail === "string"
        ? data.detail
        : `HTTP ${response.status}`
    throw new Error(`fal.ai ESRGAN 调用失败：${message}`)
  }

  const image = data && "image" in data ? data.image : null
  if (!image || typeof image.url !== "string" || !image.url) {
    throw new Error("fal.ai ESRGAN 没有返回可下载图片。")
  }

  return {
    contentType: typeof image.content_type === "string" ? image.content_type : "image/png",
    fileName: typeof image.file_name === "string" ? image.file_name : "upscaled.png",
    height: typeof image.height === "number" ? image.height : null,
    imageUrl: image.url,
    width: typeof image.width === "number" ? image.width : null,
  }
}
