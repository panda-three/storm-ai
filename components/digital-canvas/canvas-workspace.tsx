"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  ArrowLeft,
  Check,
  ImageIcon,
  Loader2,
  Save,
  Type,
  Wand2,
} from "lucide-react"
import { imageModelOptions, imageModelSettings } from "@/lib/model-options"
import {
  createDigitalCanvasDocument,
  getDigitalCanvasDocument,
  listDigitalCanvasDocuments,
  saveDigitalCanvasDocument,
} from "@/lib/digital-canvas/api"
import { createEmptyGraph, type DigitalCanvasNodeKind } from "@/lib/digital-canvas/types"
import { AiImageNode } from "@/components/digital-canvas/nodes/ai-image-node"
import { ImageNode } from "@/components/digital-canvas/nodes/image-node"
import { TextNode } from "@/components/digital-canvas/nodes/text-node"

const nodeTypes = {
  "ai-image": AiImageNode,
  image: ImageNode,
  text: TextNode,
}

let nodeSeq = 0
function nextNodeId() {
  nodeSeq += 1
  return `node_${Date.now()}_${nodeSeq}`
}

function createNodeData(kind: DigitalCanvasNodeKind) {
  if (kind === "text") {
    return { kind: "text", text: "" }
  }
  if (kind === "image") {
    return { image: null, kind: "image" }
  }
  const defaultModel = imageModelOptions[0]
  const settings = imageModelSettings[defaultModel]
  return {
    error: undefined,
    imageCount: 1,
    kind: "ai-image",
    model: defaultModel,
    outputs: [],
    progress: 0,
    prompt: "",
    quality: settings?.qualities?.[0] ?? "1K",
    ratio: settings?.ratios?.[0] ?? "默认",
    status: "idle",
  }
}

interface CanvasInnerProps {
  email: string
}

function CanvasInner({ email }: CanvasInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [title, setTitle] = useState("未命名数字画布")
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "saved" | "error">("loading")
  const [message, setMessage] = useState("")
  const rfInstance = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const { screenToFlowPosition } = useReactFlow()

  // 初始化：加载最近的画布，或创建一个新画布。
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const docs = await listDigitalCanvasDocuments()
        const target = docs[0] ? await getDigitalCanvasDocument(docs[0].id) : await createDigitalCanvasDocument()
        if (!active) return

        setDocumentId(target.id)
        setTitle(target.title)
        const graph = target.graph ?? createEmptyGraph()
        setNodes(graph.nodes as unknown as Node[])
        setEdges(graph.edges as unknown as Edge[])
        setStatus("ready")
      } catch (error) {
        if (!active) return
        setStatus("error")
        setMessage(error instanceof Error ? error.message : "加载数字画布失败。")
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge(connection, current)),
    [setEdges]
  )

  const addNode = useCallback(
    (kind: DigitalCanvasNodeKind) => {
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
      const node: Node = {
        data: createNodeData(kind) as unknown as Record<string, unknown>,
        id: nextNodeId(),
        position: {
          x: position.x - 120 + Math.random() * 60,
          y: position.y - 80 + Math.random() * 60,
        },
        type: kind,
      }
      setNodes((current) => current.concat(node))
    },
    [screenToFlowPosition, setNodes]
  )

  const handleSave = useCallback(async () => {
    if (!documentId) return
    setStatus("saving")
    setMessage("")
    try {
      const viewport = rfInstance.current?.getViewport()
      await saveDigitalCanvasDocument(documentId, {
        graph: {
          edges: edges as never,
          nodes: nodes as never,
          viewport: viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : undefined,
        },
        title,
      })
      setStatus("saved")
      window.setTimeout(() => setStatus("ready"), 1500)
    } catch (error) {
      setStatus("error")
      setMessage(error instanceof Error ? error.message : "保存失败。")
    }
  }, [documentId, edges, nodes, title])

  // 自动保存（节点/连线变化后 debounce 保存）。
  useEffect(() => {
    if (status !== "ready" || !documentId) return
    const timer = window.setTimeout(() => {
      handleSave()
    }, 4000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, title])

  const saveLabel = useMemo(() => {
    if (status === "saving") return "保存中..."
    if (status === "saved") return "已保存"
    return "保存"
  }, [status])

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <Link
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          href="/"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-cyan-600" />
          <input
            className="w-48 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-slate-900 outline-none transition hover:border-slate-200 focus:border-cyan-300"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </div>

        <div className="ml-4 flex items-center gap-2">
          <ToolbarButton icon={Type} label="文字" onClick={() => addNode("text")} />
          <ToolbarButton icon={ImageIcon} label="图片" onClick={() => addNode("image")} />
          <ToolbarButton icon={Wand2} label="AI 绘图" onClick={() => addNode("ai-image")} primary />
        </div>

        <div className="ml-auto flex items-center gap-3">
          {message ? (
            <span className="max-w-64 truncate rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700" title={message}>
              {message}
            </span>
          ) : null}
          <button
            className="flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            disabled={status === "saving" || status === "loading"}
            onClick={handleSave}
            type="button"
          >
            {status === "saving" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : status === "saved" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saveLabel}
          </button>
          <span className="hidden text-xs text-slate-400 sm:inline">{email}</span>
        </div>
      </header>

      <div className="relative flex-1">
        {status === "loading" ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载数字画布...
          </div>
        ) : (
          <ReactFlow
            edges={edges}
            fitView
            nodes={nodes}
            nodeTypes={nodeTypes}
            onConnect={onConnect}
            onEdgesChange={onEdgesChange}
            onInit={(instance) => {
              rfInstance.current = instance
            }}
            onNodesChange={onNodesChange}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#cbd5e1" gap={20} />
            <Controls />
            <MiniMap pannable zoomable className="!bg-white" />
          </ReactFlow>
        )}
      </div>
    </div>
  )
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  primary,
}: {
  icon: typeof Type
  label: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition ${
        primary
          ? "border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

export function DigitalCanvasWorkspace({ email }: { email: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner email={email} />
    </ReactFlowProvider>
  )
}
