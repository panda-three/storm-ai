import type { ModelConfig, PublicModelPricing } from "@/lib/supabase"
import {
  imageModelOptions,
  imageModelSettings,
  videoModelOptions,
  videoModelSettings,
} from "@/lib/model-options"

export type StudioModelType = "image" | "video"

export function parseDurationSeconds(duration?: string) {
  if (!duration) return null
  const parsed = Number.parseInt(duration, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function findModelPricing(
  pricing: PublicModelPricing[],
  params: {
    aspectRatio?: string
    duration?: string
    model: string
    quality: string
    type: StudioModelType
  }
) {
  const durationSeconds = parseDurationSeconds(params.duration)

  return pricing.find((item) => {
    if (!item.enabled || item.type !== params.type) return false
    if (item.model !== params.model) return false
    if ((item.quality ?? "") !== params.quality) return false
    if (params.type === "video" && item.duration_seconds !== durationSeconds) return false

    return true
  })
}

export function getAvailableModelConfigs(
  type: StudioModelType,
  configs: ModelConfig[],
  pricing: PublicModelPricing[]
) {
  return configs
    .filter((config) => config.type === type && config.frontend_enabled)
    .filter((config) => pricing.some((item) => item.type === type && item.model === config.model && item.enabled))
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function getDefaultModel(type: StudioModelType, configs: ModelConfig[]) {
  const selected = configs.find((config) => config.initial_selected)
  if (selected) return selected.model
  if (configs[0]) return configs[0].model
  return type === "image" ? imageModelOptions[0] : videoModelOptions[0]
}

export function getAvailableQualities(pricing: PublicModelPricing[], type: StudioModelType, model: string) {
  return Array.from(
    new Set(
      pricing
        .filter((item) => item.enabled && item.type === type && item.model === model && item.quality)
        .map((item) => item.quality as string)
    )
  )
}

export function getPreferredImageQuality(model: string, availableQualities: string[]) {
  const preferred = imageModelSettings[model]?.qualities[1] ?? imageModelSettings[model]?.qualities[0] ?? ""
  return availableQualities.includes(preferred) ? preferred : availableQualities[0] ?? preferred
}

export function getAvailableVideoVariants(pricing: PublicModelPricing[], model: string) {
  const items = pricing.filter((item) => item.enabled && item.type === "video" && item.model === model)
  return {
    durations: Array.from(new Set(items.map((item) => `${item.duration_seconds ?? 0} 秒`))),
    qualities: Array.from(new Set(items.map((item) => item.quality).filter((item): item is string => Boolean(item)))),
  }
}

export function getPreferredVideoDuration(
  model: string,
  variants: {
    durations: string[]
    qualities: string[]
  }
) {
  const preferred = videoModelSettings[model]?.durations[0] ?? ""
  return variants.durations.includes(preferred) ? preferred : variants.durations[0] ?? preferred
}

export function getPreferredVideoQuality(
  model: string,
  variants: {
    durations: string[]
    qualities: string[]
  }
) {
  const preferred = videoModelSettings[model]?.qualities[0] ?? ""
  return variants.qualities.includes(preferred) ? preferred : variants.qualities[0] ?? preferred
}
