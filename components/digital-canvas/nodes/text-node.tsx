"use client"

import { memo, useCallback } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import { Type } from "lucide-react"
import type { DigitalCanvasTextNodeData } from "@/lib/digital-canvas/types"

function TextNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as DigitalCanvasTextNodeData
  const { setNodes } = useReactFlow()

  const handleChange = useCallback(
    (value: string) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, text: value } } : node
        )
      )
    },
    [id, setNodes]
  )

  return (
    <div
      className={`w-64 rounded-2xl border bg-white shadow-sm transition ${
        selected ? "border-cyan-400 ring-2 ring-cyan-100" : "border-slate-200"
      }`}
    >
      <div className="flex items-center gap-2 rounded-t-2xl border-b border-slate-100 bg-slate-50 px-3 py-2">
        <Type className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-medium text-slate-600">文字 / 提示词</span>
      </div>
      <div className="p-3">
        <textarea
          className="nodrag h-28 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-sm leading-relaxed text-slate-900 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
          onChange={(event) => handleChange(event.target.value)}
          placeholder="输入文字，可连线到 AI 绘图节点作为提示词..."
          value={nodeData.text}
        />
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-cyan-500"
      />
    </div>
  )
}

export const TextNode = memo(TextNodeComponent)
