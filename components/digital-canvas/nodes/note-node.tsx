"use client"

import { memo, useCallback } from "react"
import { useReactFlow, type NodeProps } from "@xyflow/react"

import { NodeDeleteButton } from "@/components/digital-canvas/nodes/node-delete-button"
import type { DigitalCanvasNoteColor, DigitalCanvasNoteNodeData } from "@/lib/digital-canvas/types"

const colorStyles: Record<DigitalCanvasNoteColor, string> = {
  amber: "bg-amber-100 border-amber-300 text-amber-950",
  emerald: "bg-emerald-100 border-emerald-300 text-emerald-950",
  rose: "bg-rose-100 border-rose-300 text-rose-950",
  sky: "bg-sky-100 border-sky-300 text-sky-950",
  violet: "bg-violet-100 border-violet-300 text-violet-950",
}

const swatchStyles: Record<DigitalCanvasNoteColor, string> = {
  amber: "bg-amber-400",
  emerald: "bg-emerald-400",
  rose: "bg-rose-400",
  sky: "bg-sky-400",
  violet: "bg-violet-400",
}

const colorOrder: DigitalCanvasNoteColor[] = ["amber", "rose", "sky", "emerald", "violet"]

function NoteNodeComponent({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as DigitalCanvasNoteNodeData
  const { setNodes } = useReactFlow()

  const patch = useCallback(
    (partial: Partial<DigitalCanvasNoteNodeData>) => {
      setNodes((nodes) =>
        nodes.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...partial } } : node))
      )
    },
    [id, setNodes]
  )

  const color = nodeData.color ?? "amber"

  return (
    <div
      className={`group relative flex h-full w-full flex-col gap-1.5 rounded-xl border p-2.5 shadow-sm transition ${
        colorStyles[color]
      } ${selected ? "ring-2 ring-cyan-400" : ""}`}
    >
      <NodeDeleteButton id={id} label="删除便签节点" />
      <div className="flex shrink-0 items-center gap-1">
        {colorOrder.map((option) => (
          <button
            aria-label={`便签配色 ${option}`}
            className={`h-3 w-3 rounded-full transition ${swatchStyles[option]} ${
              option === color ? "ring-2 ring-slate-600/40" : "opacity-60 hover:opacity-100"
            }`}
            key={option}
            onClick={() => patch({ color: option })}
            type="button"
          />
        ))}
      </div>

      <textarea
        className="nodrag min-h-0 flex-1 resize-none bg-transparent text-xs leading-relaxed outline-none placeholder:opacity-50"
        onChange={(event) => patch({ text: event.target.value })}
        placeholder="记下想法、甲方要求、待改项..."
        value={nodeData.text ?? ""}
      />
    </div>
  )
}

export const NoteNode = memo(NoteNodeComponent)
