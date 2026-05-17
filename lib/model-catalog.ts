import {
  apimartGptImage2ApiModelName,
  apimartGptImage2ModelName,
  grokVideo3ModelName,
  imageModelOptions,
  toaGptImage2ModelName,
  toapisGptImage2ApiModelName,
  videoModelOptions,
  yunwuGeminiImageModelName,
  yunwuVeo31FastVideoModelName,
} from "@/lib/model-options"

export type ModelKind = "image" | "video"
export type ModelProvider = "apimart" | "toapis" | "yunwu"

export interface ModelCatalogEntry {
  apiModel: string
  defaultDisplayName: string
  model: string
  provider: ModelProvider
  type: ModelKind
}

export const modelCatalog: ModelCatalogEntry[] = [
  {
    apiModel: yunwuGeminiImageModelName,
    defaultDisplayName: "nano banana pro（y通道)",
    model: yunwuGeminiImageModelName,
    provider: "yunwu",
    type: "image",
  },
  {
    apiModel: "gpt-image-2",
    defaultDisplayName: "GPT Image 2",
    model: imageModelOptions[1],
    provider: "yunwu",
    type: "image",
  },
  {
    apiModel: apimartGptImage2ApiModelName,
    defaultDisplayName: "GPT Image 2 · M通道",
    model: apimartGptImage2ModelName,
    provider: "apimart",
    type: "image",
  },
  {
    apiModel: toapisGptImage2ApiModelName,
    defaultDisplayName: "GPT Image 2 · ToA通道",
    model: toaGptImage2ModelName,
    provider: "toapis",
    type: "image",
  },
  {
    apiModel: yunwuVeo31FastVideoModelName,
    defaultDisplayName: "VEO 3.1 Fast",
    model: yunwuVeo31FastVideoModelName,
    provider: "yunwu",
    type: "video",
  },
  {
    apiModel: grokVideo3ModelName,
    defaultDisplayName: "Grok Video 3",
    model: grokVideo3ModelName,
    provider: "yunwu",
    type: "video",
  },
]

export function getCatalogEntry(type: ModelKind, model: string) {
  return modelCatalog.find((entry) => entry.type === type && entry.model === model) ?? null
}

export function getCatalogModels(type: ModelKind) {
  return type === "image" ? imageModelOptions : videoModelOptions
}
