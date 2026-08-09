// 把「场景 + 参数选择 + 用户描述」组装成最终提示词。
import {
  AUTO_VALUE,
  groupsForScene,
  type RenderParamValues,
  type RenderSceneKind,
} from "./render-params"

export type RenderMode = "text-to-image" | "redraw" | "inpaint"

const sceneLead: Record<RenderSceneKind, string> = {
  architecture: "architectural exterior visualization",
  general: "professional visualization",
  interior: "interior design visualization",
  landscape: "landscape design visualization",
  product: "product still-life visualization",
}

// 冠词按首字母元音选择，避免出现 "a interior"
function article(word: string) {
  return /^[aeiou]/i.test(word) ? "an" : "a"
}

export interface ComposePromptInput {
  scene: RenderSceneKind
  values: RenderParamValues
  /** 用户自由描述 */
  description?: string
  mode: RenderMode
  /** 局部精修时对涂选区域的要求 */
  maskInstruction?: string
}

/** 组装提示词；返回最终字符串与命中的参数短语，便于界面预览 */
export function composePrompt(input: ComposePromptInput): { prompt: string; phrases: string[] } {
  const { description, maskInstruction, mode, scene, values } = input

  const phrases: string[] = []
  for (const group of groupsForScene(scene)) {
    const value = values[group.key]
    if (!value || value === AUTO_VALUE) continue
    const option = group.options.find((item) => item.value === value)
    if (option?.prompt) phrases.push(option.prompt)
  }

  const lead = sceneLead[scene]
  const segments: string[] = [
    mode === "text-to-image"
      ? `Generate ${article(lead)} ${lead}`
      : mode === "redraw"
        ? `Redraw the reference image as ${article(lead)} ${lead}, preserving its layout, structure and camera`
        : `Refine only the masked region of the reference image as ${article(lead)} ${lead}, keep everything outside the mask pixel-identical`,
  ]

  const trimmedDescription = description?.trim()
  if (trimmedDescription) segments.push(trimmedDescription)

  if (mode === "inpaint") {
    const instruction = maskInstruction?.trim()
    segments.push(instruction ? `Masked region: ${instruction}` : "Masked region: refine naturally to match context")
  }

  if (phrases.length > 0) segments.push(phrases.join(", "))

  return { phrases, prompt: `${segments.join(". ")}.` }
}
