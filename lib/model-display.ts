import { yunwuGeminiImageModelName } from "@/lib/model-options"

export function formatModelNameForDisplay(model: string) {
  if (model === yunwuGeminiImageModelName) return "nano banana pro（y通道)"
  return model
}
