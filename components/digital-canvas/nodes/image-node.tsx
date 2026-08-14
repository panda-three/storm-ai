"use client"

import { memo, useCallback, useRef } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import { ImageIcon, UploadCloud } from "lucide-react"
import { NodeDeleteButton } from "@/components/digital-canvas/nodes/node-delete-button"
import type { DigitalCanvasImageNodeData } from "@/lib/digital-canvas/types"

function ImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as DigitalCanvasImageNodeData
  const { setNodes } = useReactFlow()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const setImage = useCallback(
    (url: string, width?: number, height?: number) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, image: { url, width, height } } }
            : node
        )
      )
    },
    [id, setNodes]
  )

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result)
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => setImage(url, img.naturalWidth, img.naturalHeight)
        img.onerror = () => setImage(url)
        img.src = url
      }
      reader.readAsDataURL(file)
    },
    [setImage]
  )

  return (
    <div
      className={`group relative w-64 rounded-2xl border bg-white shadow-sm transition ${
        selected ? "border-cyan-400 ring-2 ring-cyan-100" : "border-slate-200"
      }`}
    >
      <NodeDeleteButton id={id} label="删除图片节点" />
      <div className="flex items-center gap-2 rounded-t-2xl border-b border-slate-100 bg-slate-50 px-3 py-2">
        <ImageIcon className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-medium text-slate-600">图片</span>
      </div>
      <div className="p-3">
        {nodeData.image?.url ? (
          <button
            type="button"
            className="nodrag block w-full overflow-hidden rounded-lg border border-slate-200"
            onClick={() => inputRef.current?.click()}
            title="点击替换图片"
          >
            <img alt="画布图片" className="h-auto w-full" src={nodeData.image.url} />
          </button>
        ) : (
          <button
            type="button"
            className="nodrag flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-500 transition hover:border-cyan-300 hover:text-cyan-600"
            onClick={() => inputRef.current?.click()}
          >
            <UploadCloud className="h-5 w-5" />
            <span className="text-xs">点击上传图片</span>
          </button>
        )}
        <input
          ref={inputRef}
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) handleFile(file)
            event.target.value = ""
          }}
          type="file"
        />
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-cyan-500"
      />
    </div>
  )
}

export const ImageNode = memo(ImageNodeComponent)
