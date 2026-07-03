import {
  apimartGptImage2ApiModelName,
  apimartGptImage2ModelName,
  gptImage2AllModelName,
  grsaiNanoBanana2ImageApiModelName,
  grsaiNanoBanana2ImageModelName,
  grokImagineImageModelName,
  grokVideo310sModelName,
  grokVideo3ModelName,
  imageModelOptions,
  manjuGemini4KImageApiModelName,
  manjuGemini4KImageModelName,
  manjuGrokImagineVideoModelName,
  manjuGeminiImageApiModelName,
  manjuGeminiImageModelName,
  manjuGrokImagineImageProApiModelName,
  manjuGrokImagineImageProModelName,
  manjuGptImage2ApiModelName,
  manjuGptImage2ModelName,
  manjuNanoBanana24KImageApiModelName,
  manjuNanoBanana24KImageModelName,
  manjuNanoBanana2ImageApiModelName,
  manjuNanoBanana2ImageModelName,
  manjuVeo31Fast1080pVideoModelName,
  toaGptImage2ModelName,
  toapisGptImage2ApiModelName,
  vectorEngineGeminiImageApiModelName,
  vectorEngineGeminiImageModelName,
  videoModelOptions,
  yunwuGeminiImageModelName,
  yunwuSeedream5ImageModelName,
  yunwuVeo31FastVideoModelName,
  yunwuSeedance15ProVideoModelName,
} from "@/lib/model-options"

export type ModelKind = "image" | "video"
export type ModelProvider = "apimart" | "grsai" | "manju" | "toapis" | "vectorengine" | "yunwu"

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
    apiModel: vectorEngineGeminiImageApiModelName,
    defaultDisplayName: "nano banana pro（VE通道)",
    model: vectorEngineGeminiImageModelName,
    provider: "vectorengine",
    type: "image",
  },
  {
    apiModel: manjuGeminiImageApiModelName,
    defaultDisplayName: "Gemini 3.0 Pro Image · Manju",
    model: manjuGeminiImageModelName,
    provider: "manju",
    type: "image",
  },
  {
    apiModel: manjuNanoBanana2ImageApiModelName,
    defaultDisplayName: "Nano Banana 2 · Manju",
    model: manjuNanoBanana2ImageModelName,
    provider: "manju",
    type: "image",
  },
  {
    apiModel: manjuGemini4KImageApiModelName,
    defaultDisplayName: "Gemini 3.0 Pro Image 4K · Manju",
    model: manjuGemini4KImageModelName,
    provider: "manju",
    type: "image",
  },
  {
    apiModel: manjuNanoBanana24KImageApiModelName,
    defaultDisplayName: "Nano Banana 2 4K · Manju",
    model: manjuNanoBanana24KImageModelName,
    provider: "manju",
    type: "image",
  },
  {
    apiModel: manjuGptImage2ApiModelName,
    defaultDisplayName: "GPT Image 2 · Manju",
    model: manjuGptImage2ModelName,
    provider: "manju",
    type: "image",
  },
  {
    apiModel: manjuGrokImagineImageProApiModelName,
    defaultDisplayName: "Grok Imagine Image Pro · Manju",
    model: manjuGrokImagineImageProModelName,
    provider: "manju",
    type: "image",
  },
  {
    apiModel: "gpt-image-2",
    defaultDisplayName: "GPT Image 2",
    model: gptImage2AllModelName,
    provider: "yunwu",
    type: "image",
  },
  {
    apiModel: yunwuSeedream5ImageModelName,
    defaultDisplayName: "Seedream 5.0",
    model: yunwuSeedream5ImageModelName,
    provider: "yunwu",
    type: "image",
  },
  {
    apiModel: grokImagineImageModelName,
    defaultDisplayName: "Grok Imagine Image",
    model: grokImagineImageModelName,
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
    apiModel: grsaiNanoBanana2ImageApiModelName,
    defaultDisplayName: "Nano Banana 2 · GrsAi",
    model: grsaiNanoBanana2ImageModelName,
    provider: "grsai",
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
    apiModel: manjuGrokImagineVideoModelName,
    defaultDisplayName: "Grok Imagine Video · Manju",
    model: manjuGrokImagineVideoModelName,
    provider: "manju",
    type: "video",
  },
  {
    apiModel: manjuVeo31Fast1080pVideoModelName,
    defaultDisplayName: "Veo 3.1 Fast 1080p · Manju",
    model: manjuVeo31Fast1080pVideoModelName,
    provider: "manju",
    type: "video",
  },
  {
    apiModel: grokVideo3ModelName,
    defaultDisplayName: "Grok Video 3",
    model: grokVideo3ModelName,
    provider: "yunwu",
    type: "video",
  },
  {
    apiModel: grokVideo310sModelName,
    defaultDisplayName: "Grok Video 3 10s",
    model: grokVideo310sModelName,
    provider: "yunwu",
    type: "video",
  },
  {
    apiModel: yunwuSeedance15ProVideoModelName,
    defaultDisplayName: "Seedance 1.5 Pro",
    model: yunwuSeedance15ProVideoModelName,
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
