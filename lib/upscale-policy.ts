export const maxUpscaleInputBytes = 10 * 1024 * 1024
export const maxUpscaleOutputEdge = 8192
export const supportedUpscaleMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])

export type UpscaleScale = 2 | 4

export interface UpscaleFileLike {
  name: string
  size: number
  type: string
}

export interface UpscaleDimensions {
  height: number
  width: number
}

export function validateUpscaleFile(file: UpscaleFileLike) {
  if (!supportedUpscaleMimeTypes.has(file.type)) {
    return {
      ok: false as const,
      error: "仅支持 JPG、PNG、WebP 格式。",
    }
  }

  if (file.size > maxUpscaleInputBytes) {
    return {
      ok: false as const,
      error: "单张图片不能超过 10MB。",
    }
  }

  return { ok: true as const }
}

export function normalizeUpscaleScale(value: unknown): UpscaleScale {
  const scale = typeof value === "number" ? value : Number.parseInt(String(value), 10)
  if (scale !== 2 && scale !== 4) {
    throw new Error("请选择 2x 或 4x。")
  }

  return scale
}

export function resolveUpscaleScale({
  height,
  requestedScale,
  width,
}: UpscaleDimensions & {
  requestedScale: unknown
}) {
  const scale = normalizeUpscaleScale(requestedScale)
  const longestEdge = Math.max(width, height)
  const outputEdge = longestEdge * scale

  if (outputEdge <= maxUpscaleOutputEdge) {
    return {
      actualScale: scale,
      ok: true as const,
      warning: "",
    }
  }

  if (scale === 4 && longestEdge * 2 <= maxUpscaleOutputEdge) {
    return {
      actualScale: 2 as const,
      ok: true as const,
      warning: `4x 会超过 ${maxUpscaleOutputEdge}px 输出限制，已自动降级为 2x。`,
    }
  }

  return {
    actualScale: 2 as const,
    ok: false as const,
    error: `这张图 2x 后仍会超过 ${maxUpscaleOutputEdge}px 输出限制，请换一张更小的图片。`,
  }
}
