"use client"

import { memo, useCallback } from "react"
import { useReactFlow, type NodeProps } from "@xyflow/react"
import { StickyNote } from "lucide-react"
import type {
  DigitalCanvasNoteColor,
  DigitalCanvasNoteNodeData,
} from "@/lib/digital-canvas/types"

const noteColors: Record<DigitalCanvasNoteColor, { body: string; header: string; swatch: string }> = {
  amber: { body: "bg-amber-50 text-amber-950", header: "bg-amber-100", swatch: "bg-amber-300" },
  emerald: { body: "bg-emerald-50 text-emerald-950", header: "bg-emerald-100", swatch: "bg-emerald-300" },
  rose: { body: "bg-rose-50 text-rose-950", header: "bg-rose-100", swatch: "bg-rose-300" },
  sky: { body: "bg-sky-50 text-sky-950", header: "bg-sky-100", swatch: "bg-sky-300" },
  violet: { body: "bg-violet-50 text-violet-950", header: "bg-violet-100", swatch: "bg-violet-300" },
}

const colorOrder: DigitalCanvasNoteColor[] = ["amber", "rose", "sky", "emerald", "violet"]

function NoteNodeComponent({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as DigitalCanvasNoteNodeData
  const { setNodes } = useReactFlow()
  const theme = noteColors[nodeData.color] ?? noteColors.amber

  const patch = useCallback(
    (partial: Partial<DigitalCanvasNoteNodeData>) => {
      setNodes((nodes) =>
        nodes.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...partial } } : node))
      )
    },
    [id, setNodes]
  )

  return (
    <div
      className={`w-56 overflow-hidden rounded-xl shadow-md transition ${theme.body} ${
        selected ? "ring-2 ring-cyan-300" : ""
      }`}
    >
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 ${theme.header}`}>
        <StickyNote className="h-3 w-3 opacity-60" />
        <span className="text-[11px] font-medium opacity-70">便签</span>
        <div className="nodrag ml-auto flex gap-1">
          {colorOrder.map((color) => (
            <button
              aria-label={`便签颜色 ${color}`}
              className={`h-3 w-3 rounded-full transition ${noteColors[color].swatch} ${
                nodeData.color === color ? "ring-2 ring-slate-900/30" : "opacity-70 hover:opacity-100"
              }`}
              key={color}
              onClick={() => patch({ color })}
              type="button"
            />
          ))}
        </div>
      </div>

      <textarea
        className="nodrag h-28 w-full resize-none bg-transparent p-2.5 text-xs leading-relaxed outline-none placeholder:opacity-40"
        onChange={(event) => patch({ text: event.target.value })}
        placeholder="记录方案思路、修改意见..."
        value={nodeData.text}
      />
    </div>
  )
}

export const NoteNode = memo(NoteNodeComponent)
