// 数字画布（Digital Canvas）核心数据模型
// 节点工作流形态：节点带类型化端口，通过连线传递数据。

export type DigitalCanvasNodeKind = "text" | "image" | "ai-image" | "note"

// 便签颜色档（P1）
export type DigitalCanvasNoteColor = "amber" | "rose" | "sky" | "emerald" | "violet"

export interface DigitalCanvasImagePayload {
  url: string
  width?: number | null
  height?: number | null
}

// 各类型节点的 data（存入 React Flow node.data）
export interface DigitalCanvasTextNodeData {
  kind: "text"
  text: string
}

export interface DigitalCanvasImageNodeData {
  kind: "image"
  image: DigitalCanvasImagePayload | null
  title?: string
}

export interface DigitalCanvasAiImageNodeData {
  kind: "ai-image"
  prompt: string
  model: string
  ratio: string
  quality: string
  imageCount: number
  // 生成状态
  status: "idle" | "running" | "done" | "error"
  progress: number
  error?: string
  // 生成结果（可能多张，展示第一张为主）
  outputs: DigitalCanvasImagePayload[]
  // 最近一次任务标识（用于恢复/调试）
  taskId?: string
}

export interface DigitalCanvasNoteNodeData {
  kind: "note"
  text: string
  color: DigitalCanvasNoteColor
}

export type DigitalCanvasNodeData =
  | DigitalCanvasTextNodeData
  | DigitalCanvasImageNodeData
  | DigitalCanvasAiImageNodeData
  | DigitalCanvasNoteNodeData

export interface DigitalCanvasNode {
  id: string
  type: DigitalCanvasNodeKind
  position: { x: number; y: number }
  width?: number | null
  height?: number | null
  data: DigitalCanvasNodeData
}

export interface DigitalCanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface DigitalCanvasViewport {
  x: number
  y: number
  zoom: number
}

// 完整的画布图（持久化在 digital_canvas_documents.graph）
export interface DigitalCanvasGraph {
  nodes: DigitalCanvasNode[]
  edges: DigitalCanvasEdge[]
  viewport?: DigitalCanvasViewport
}

export interface DigitalCanvasDocumentListItem {
  id: string
  title: string
  thumbnailUrl: string | null
  updatedAt: string
}

export interface DigitalCanvasDocument extends DigitalCanvasDocumentListItem {
  graph: DigitalCanvasGraph
}

export function createEmptyGraph(): DigitalCanvasGraph {
  return { nodes: [], edges: [] }
}
