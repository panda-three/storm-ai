export const gptImage2ModelName = "GPT-Image-2"
export const gptImage2ApiModelName = "gpt-image-2"
export const gptImage2AllModelName = "gpt-image-2-all"
export const gptImage2OfficialApiModelName = "gpt-image-2-official"
export const gptImage2Supported4KRatios = ["16:9", "9:16", "2:1", "1:2", "21:9", "9:21"]
export const apimartGptImage2ModelName = "image2-M通道"
export const apimartGptImage2ApiModelName = "gpt-image-2"
export const apimartImageProviderName = "apimart"
export const apimartImageRatios = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21"]
export const toaGptImage2ModelName = "image2-Toa通道"
export const toapisGptImage2ApiModelName = "gpt-image-2"
export const toapisImageProviderName = "toapis"
export const toapisImage1KRatios = ["1:1", "3:2", "2:3"]
export const toapisImage2KRatios = ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21"]
export const toapisImage4KRatios = ["16:9", "9:16", "2:1", "1:2", "21:9", "9:21"]
export const grsaiNanoBanana2ImageModelName = "nano-banana-2-grsai"
export const grsaiNanoBanana2ImageApiModelName = "nano-banana-2"
export const grsaiImageProviderName = "grsai"
export const grsaiNanoBanana2ImageRatios = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1"]
export const mengfactoryGeminiImageModelName = "Gemini 3.1 Flash Image Preview"
export const yunwuGeminiImageModelName = "gemini-3.1-flash-image-preview"
export const vectorEngineGeminiImageModelName = "gemini-3.1-flash-image-preview-ve"
export const vectorEngineGeminiImageApiModelName = yunwuGeminiImageModelName
export const vectorEngineImageProviderName = "vectorengine"
export const manjuGeminiImageModelName = "gemini-3.0-pro-image-manju"
export const manjuGeminiImageApiModelName = "gemini-3.0-pro-image"
export const manjuGemini4KImageModelName = "gemini-3.0-pro-image-4k-manju"
export const manjuGemini4KImageApiModelName = "gemini-3.0-pro-image 4K"
export const manjuNanoBanana2ImageModelName = "nano-banana-2-manju"
export const manjuNanoBanana2ImageApiModelName = "Nano Banana 2"
export const manjuNanoBanana24KImageModelName = "nano-banana-2-4k-manju"
export const manjuNanoBanana24KImageApiModelName = "Nano Banana 2 4K"
export const manjuGptImage2ModelName = "gpt-image-2-manju"
export const manjuGptImage2ApiModelName = "gpt-image-2"
export const manjuGrokImagineImageProModelName = "grok-imagine-image-pro"
export const manjuGrokImagineImageProApiModelName = "grok-imagine-image-pro"
export const manjuImageProviderName = "manju"
export const manjuGeminiImageRatios = ["默认", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"]
export const grokImagineImageModelName = "grok-imagine-image"
export const yunwuSeedream5ImageModelName = "doubao-seedream-5-0-260128"
export const yunwuSeedream5ImageRatios = ["默认", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"]
export const grokImagineImageRatios = ["auto", "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1"]
export const mengfactoryGeminiImageApiModelName = yunwuGeminiImageModelName
export const mengfactoryVeoVideoModelName = "VEO 3.1 FAST"
export const yunwuVeo31FastVideoModelName = "veo_3_1-fast"
export const apimartVeo31FastVideoModelName = yunwuVeo31FastVideoModelName
export const legacyApimartVeoVideoModelName = "Gemini Veo 3.1 Fast"
export const grokImagineVideoModelName = "Grok Imagine Video"
export const manjuGrokImagineVideoModelName = "grok-imagine-video"
export const manjuVeo31Fast1080pVideoModelName = "Veo 3.1 Fast 1080p"
export const grokVideo3ModelName = "grok-video-3"
export const grokVideo310sModelName = "grok-video-3-10s"
export const yunwuSeedance15ProVideoModelName = "doubao-seedance-1-5-pro-251215"

export const imageModelOptions = [
  yunwuGeminiImageModelName,
  vectorEngineGeminiImageModelName,
  manjuGeminiImageModelName,
  manjuNanoBanana2ImageModelName,
  manjuGemini4KImageModelName,
  manjuNanoBanana24KImageModelName,
  manjuGptImage2ModelName,
  manjuGrokImagineImageProModelName,
  gptImage2AllModelName,
  apimartGptImage2ModelName,
  toaGptImage2ModelName,
  grsaiNanoBanana2ImageModelName,
  yunwuSeedream5ImageModelName,
  grokImagineImageModelName,
]

export const imageModelSettings: Record<
  string,
  {
    qualities: string[]
    ratios: string[]
  }
> = {
  "Gemini Nano Banana Pro": {
    qualities: ["1K", "2K", "4K"],
    ratios: ["默认", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1"],
  },
  [mengfactoryGeminiImageModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["默认", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"],
  },
  [yunwuGeminiImageModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["默认", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"],
  },
  [vectorEngineGeminiImageModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["默认", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"],
  },
  [manjuGeminiImageModelName]: {
    qualities: ["1K", "2K"],
    ratios: manjuGeminiImageRatios,
  },
  [manjuNanoBanana2ImageModelName]: {
    qualities: ["1K", "2K"],
    ratios: manjuGeminiImageRatios,
  },
  [manjuGemini4KImageModelName]: {
    qualities: ["4K"],
    ratios: manjuGeminiImageRatios,
  },
  [manjuNanoBanana24KImageModelName]: {
    qualities: ["4K"],
    ratios: manjuGeminiImageRatios,
  },
  [manjuGptImage2ModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: manjuGeminiImageRatios,
  },
  [manjuGrokImagineImageProModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: manjuGeminiImageRatios,
  },
  [yunwuSeedream5ImageModelName]: {
    qualities: ["2K", "3K"],
    ratios: yunwuSeedream5ImageRatios,
  },
  [grokImagineImageModelName]: {
    qualities: ["1K", "2K"],
    ratios: grokImagineImageRatios,
  },
  [gptImage2ModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21"],
  },
  [gptImage2AllModelName]: {
    qualities: ["2K"],
    ratios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21"],
  },
  [apimartGptImage2ModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: apimartImageRatios,
  },
  [toaGptImage2ModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: toapisImage2KRatios,
  },
  [grsaiNanoBanana2ImageModelName]: {
    qualities: ["1K", "2K", "4K"],
    ratios: grsaiNanoBanana2ImageRatios,
  },
}

export function isGptImage2Model(model: string) {
  return model === gptImage2ModelName || model === gptImage2ApiModelName || model === gptImage2AllModelName
}

export function isMengfactoryGeminiImageModel(model: string) {
  return model === mengfactoryGeminiImageModelName
}

export function isYunwuGeminiImageModel(model: string) {
  return model === yunwuGeminiImageModelName
}

export function isVectorEngineGeminiImageModel(model: string) {
  return model === vectorEngineGeminiImageModelName
}

export function isManjuGeminiImageModel(model: string) {
  return model === manjuGeminiImageModelName || model === manjuGemini4KImageModelName
}

export function isManjuNanoBanana2ImageModel(model: string) {
  return model === manjuNanoBanana2ImageModelName || model === manjuNanoBanana24KImageModelName
}

export function isManjuGptImage2Model(model: string) {
  return model === manjuGptImage2ModelName
}

export function isManjuGrokImagineImageProModel(model: string) {
  return model === manjuGrokImagineImageProModelName
}

export function isYunwuGptImageModel(model: string) {
  return model === gptImage2AllModelName
}

export function isYunwuSeedream5ImageModel(model: string) {
  return model === yunwuSeedream5ImageModelName
}

export function isGrokImagineImageModel(model: string) {
  return model === grokImagineImageModelName
}

export function isYunwuImageModel(model: string) {
  return isYunwuGeminiImageModel(model) || isYunwuGptImageModel(model) || isYunwuSeedream5ImageModel(model) || isGrokImagineImageModel(model)
}

export function isToapisImageModel(model: string) {
  return model === toaGptImage2ModelName
}

export function isGrsaiImageModel(model: string) {
  return model === grsaiNanoBanana2ImageModelName
}

export function isApimartImageModel(model: string) {
  return model === apimartGptImage2ModelName
}

export function isVectorEngineImageModel(model: string) {
  return isVectorEngineGeminiImageModel(model)
}

export function isManjuImageModel(model: string) {
  return (
    isManjuGeminiImageModel(model) ||
    isManjuNanoBanana2ImageModel(model) ||
    isManjuGptImage2Model(model) ||
    isManjuGrokImagineImageProModel(model)
  )
}

export function isGptImage2Restricted4K(quality: string, model: string) {
  return isGptImage2Model(model) && quality.trim().toUpperCase() === "4K"
}

export function getImageRatiosForSelection(model: string, quality: string) {
  if (isApimartImageModel(model)) return apimartImageRatios
  if (isToapisImageModel(model)) return getToapisImageRatiosForQuality(quality)
  if (isGrsaiImageModel(model)) return grsaiNanoBanana2ImageRatios
  return isGptImage2Restricted4K(quality, model) ? gptImage2Supported4KRatios : imageModelSettings[model].ratios
}

export function isValidImageRatioForQuality(model: string, quality: string, ratio: string) {
  if (isApimartImageModel(model)) return apimartImageRatios.includes(ratio)
  if (isToapisImageModel(model)) return getToapisImageRatiosForQuality(quality).includes(ratio)
  if (isGrsaiImageModel(model)) return grsaiNanoBanana2ImageRatios.includes(ratio)
  return !isGptImage2Restricted4K(quality, model) || gptImage2Supported4KRatios.includes(ratio)
}

export function getToapisImageRatiosForQuality(quality: string) {
  const normalized = quality.trim().toUpperCase()
  if (normalized === "1K") return toapisImage1KRatios
  if (normalized === "4K") return toapisImage4KRatios
  return toapisImage2KRatios
}

export const videoModelOptions = [
  yunwuVeo31FastVideoModelName,
  manjuGrokImagineVideoModelName,
  manjuVeo31Fast1080pVideoModelName,
  grokVideo3ModelName,
  grokVideo310sModelName,
  yunwuSeedance15ProVideoModelName,
]
export const adminVideoModelOptions = videoModelOptions

export const videoModelSettings: Record<
  string,
  {
    aspectRatios: string[]
    durations: string[]
    qualities: string[]
  }
> = {
  [mengfactoryVeoVideoModelName]: {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["720P", "1080P", "4K"],
  },
  [legacyApimartVeoVideoModelName]: {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["720P", "1080P", "4K"],
  },
  [yunwuVeo31FastVideoModelName]: {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["720P", "1080P", "4K"],
  },
  [manjuGrokImagineVideoModelName]: {
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: ["6 秒", "10 秒", "12 秒", "16 秒", "20 秒"],
    qualities: ["720P", "480P", "1080P"],
  },
  [manjuVeo31Fast1080pVideoModelName]: {
    aspectRatios: ["16:9", "9:16"],
    durations: ["8 秒"],
    qualities: ["1080P"],
  },
  [grokVideo3ModelName]: {
    aspectRatios: ["1:1", "2:3", "3:2"],
    durations: ["6 秒"],
    qualities: ["720P"],
  },
  [grokVideo310sModelName]: {
    aspectRatios: ["1:1", "2:3", "3:2"],
    durations: ["10 秒"],
    qualities: ["720P"],
  },
  [yunwuSeedance15ProVideoModelName]: {
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    durations: ["5 秒", "4 秒", "6 秒", "7 秒", "8 秒", "9 秒", "10 秒", "11 秒", "12 秒"],
    qualities: ["720P", "480P", "1080P"],
  },
}

export function isMengfactoryVeoVideoModel(model: string) {
  return model === mengfactoryVeoVideoModelName
}

export function isYunwuVideoModel(model: string) {
  return (
    model === yunwuVeo31FastVideoModelName ||
    model === grokVideo3ModelName ||
    model === grokVideo310sModelName ||
    model === yunwuSeedance15ProVideoModelName
  )
}

export function isManjuVideoModel(model: string) {
  return model === manjuGrokImagineVideoModelName || model === manjuVeo31Fast1080pVideoModelName
}

export function isSelectableImageModel(model: string) {
  return imageModelOptions.includes(model)
}

export function isSelectableVideoModel(model: string) {
  return videoModelOptions.includes(model)
}

export function isSelectableModelPricing(item: { model: string; type: string }) {
  if (item.type === "image") return isSelectableImageModel(item.model)
  if (item.type === "video") return isSelectableVideoModel(item.model)
  return false
}

export function getMengfactoryVeoVideoApiModel(quality: string) {
  return quality.trim().toUpperCase() === "4K" ? "veo3.1-4k" : "veo3.1-fast"
}
