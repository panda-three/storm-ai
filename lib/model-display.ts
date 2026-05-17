import { getCatalogEntry, type ModelKind } from "@/lib/model-catalog"

export function formatModelNameForDisplay(model: string, type?: ModelKind, displayNames?: Record<string, string>) {
  if (displayNames?.[model]) return displayNames[model]
  if (type) return getCatalogEntry(type, model)?.defaultDisplayName ?? model
  return getCatalogEntry("image", model)?.defaultDisplayName ?? getCatalogEntry("video", model)?.defaultDisplayName ?? model
}
