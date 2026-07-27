export interface GenerationLimitsSettings {
  enabled: boolean
  maxActiveImageTasks: number
  maxDailyImageTasks: number
}

export type GenerationLimitCode = "ACTIVE_IMAGE_TASK_LIMIT" | "DAILY_IMAGE_TASK_LIMIT"

export interface GenerationLimitResult {
  current: number
  limit: number
  limitCode: GenerationLimitCode
  resetAt?: string
}

export class GenerationLimitError extends Error {
  constructor(readonly result: GenerationLimitResult) {
    super(getGenerationLimitErrorPayload(result).error)
    this.name = "GenerationLimitError"
  }
}

export const defaultGenerationLimitsSettings: GenerationLimitsSettings = {
  enabled: true,
  maxActiveImageTasks: 3,
  maxDailyImageTasks: 50,
}

export function normalizeGenerationLimitsSettings(value: unknown): GenerationLimitsSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultGenerationLimitsSettings }
  }

  const settings = value as Record<string, unknown>

  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : defaultGenerationLimitsSettings.enabled,
    maxActiveImageTasks: isPositiveInteger(settings.maxActiveImageTasks)
      ? settings.maxActiveImageTasks
      : defaultGenerationLimitsSettings.maxActiveImageTasks,
    maxDailyImageTasks: isPositiveInteger(settings.maxDailyImageTasks)
      ? settings.maxDailyImageTasks
      : defaultGenerationLimitsSettings.maxDailyImageTasks,
  }
}

export function validateGenerationLimitsSettings(settings: GenerationLimitsSettings) {
  if (
    settings.enabled &&
    (!isPositiveInteger(settings.maxActiveImageTasks) || !isPositiveInteger(settings.maxDailyImageTasks))
  ) {
    throw new Error("启用生成限制时，两项额度都必须是正整数。")
  }

  return settings
}

export function parseGenerationLimitResult(value: unknown): GenerationLimitResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const result = value as Record<string, unknown>
  const limitCode = result.limit_code
  if (limitCode !== "ACTIVE_IMAGE_TASK_LIMIT" && limitCode !== "DAILY_IMAGE_TASK_LIMIT") return null
  if (!isNonNegativeInteger(result.current) || !isPositiveInteger(result.limit)) return null
  if (limitCode === "DAILY_IMAGE_TASK_LIMIT" && typeof result.reset_at !== "string") return null

  return {
    current: result.current,
    limit: result.limit,
    limitCode,
    ...(limitCode === "DAILY_IMAGE_TASK_LIMIT" ? { resetAt: result.reset_at as string } : {}),
  }
}

export function getGenerationLimitErrorPayload(result: GenerationLimitResult) {
  const error = result.limitCode === "ACTIVE_IMAGE_TASK_LIMIT"
    ? `当前已有 ${result.current} 个图片任务正在生成，请等待任一任务完成后再试。`
    : `今日已创建 ${result.current} 个图片任务，请于下一个北京时间自然日再试。`

  return {
    ok: false as const,
    code: result.limitCode,
    error,
    current: result.current,
    limit: result.limit,
    ...(result.resetAt ? { resetAt: result.resetAt } : {}),
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}
