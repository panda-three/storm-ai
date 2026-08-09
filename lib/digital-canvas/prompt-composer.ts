// 提示词组装（PRD §4.1）
// 把「图槽状态 + 操作模式 + 参数选择」组装成一段中文提示词。
// 组装结果写入面板提示词框，用户可继续手动编辑。

import {
  getSelectedPrompts,
  getVisibleCategories,
  renderDisciplineOptions,
  type RenderDiscipline,
  type RenderParamSelection,
} from "@/lib/digital-canvas/render-params"

export type RenderMode = "full" | "inpaint"

export interface ComposePromptInput {
  discipline: RenderDiscipline
  // 图1（底图）/ 图2（参考图）是否已就位
  hasBaseImage: boolean
  hasReferenceImage: boolean
  mode: RenderMode
  selection: RenderParamSelection
  // 用户附加的自定义描述
  extra?: string
}

// 收尾的质量约束，保证出图可用性。
const qualitySuffix = "画面干净整洁，透视正确、比例准确，材质与光影真实自然，输出高清写实效果图。"

function buildOpening(input: ComposePromptInput) {
  const { hasBaseImage, hasReferenceImage, mode } = input

  if (mode === "inpaint") {
    if (!hasBaseImage) {
      return "只重绘我标注的局部区域，其余部分保持完全不变"
    }
    return hasReferenceImage
      ? "只重绘我在图1中标注的区域，参考图2的材质与光影进行替换，其余部分保持完全不变"
      : "只重绘我在图1中标注的区域，其余部分保持完全不变"
  }

  if (hasBaseImage && hasReferenceImage) {
    // PRD §4.1 默认模板
    return "把我图1的白膜，保持空间内容不变，采用我图2的光影材质渲染成写实效果图"
  }

  if (hasBaseImage) {
    return "把我图1渲染成写实效果图，保持原有空间结构与构图不变"
  }

  return "生成一张写实效果图"
}

export function composeRenderPrompt(input: ComposePromptInput) {
  const segments: string[] = [buildOpening(input)]

  const discipline = renderDisciplineOptions.find((option) => option.value === input.discipline)
  if (discipline?.prompt) {
    segments.push(discipline.prompt)
  }

  // 按分类顺序追加已选参数（自动档不写入）。
  for (const category of getVisibleCategories(input.discipline)) {
    segments.push(...getSelectedPrompts(category, input.selection))
  }

  const extra = input.extra?.trim()
  if (extra) {
    segments.push(extra)
  }

  return `${segments.filter(Boolean).join("，")}。${qualitySuffix}`
}
