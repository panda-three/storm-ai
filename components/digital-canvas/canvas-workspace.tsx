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
import {
  ArrowLeft,
  Check,
  History,
  ImageIcon,
  Loader2,
  Save,
  StickyNote,
  Type,
  Wand2,
} from "lucide-react"
import { imageModelOptions, imageModelSettings } from "@/lib/model-options"
import {
  createDigitalCanvasDocument,
  createImageGenerationTask,
  getDigitalCanvasDocument,
  listDigitalCanvasDocuments,
  pollImageTask,
  saveDigitalCanvasDocument,
  uploadReferenceImageFile,
} from "@/lib/digital-canvas/api"
import { createEmptyGraph, type DigitalCanvasNodeKind } from "@/lib/digital-canvas/types"
import { AiImageNode } from "@/components/digital-canvas/nodes/ai-image-node"
import { ImageNode } from "@/components/digital-canvas/nodes/image-node"
import { NoteNode } from "@/components/digital-canvas/nodes/note-node"
import { TextNode } from "@/components/digital-canvas/nodes/text-node"
import { GenerationHistoryPanel } from "@/components/digital-canvas/panels/generation-history-panel"
import {
  QuickRenderPanel,
  type QuickRenderSubmit,
} from "@/components/digital-canvas/panels/quick-render-panel"

const nodeTypes = {
  "ai-image": AiImageNode,
  image: ImageNode,
  note: NoteNode,
  text: TextNode,
}

const fitViewOptions = { maxZoom: 1, minZoom: 0.4, padding: 0.35 }

// 严格模式下初始化 effect 会执行两次，这里共享同一个请求，避免重复创建空白画布。
let initialCanvasPromise: ReturnType<typeof loadInitialCanvas> | null = null

async function loadInitialCanvas() {
  const docs = await listDigitalCanvasDocuments()
  return docs[0] ? getDigitalCanvasDocument(docs[0].id) : createDigitalCanvasDocument()
}

function resolveInitialCanvas() {
  if (!initialCanvasPromise) {
    initialCanvasPromise = loadInitialCanvas()
    initialCanvasPromise.catch(() => {
      initialCanvasPromise = null
    })
  }
  return initialCanvasPromise
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
  if (kind === "note") {
    return { color: "amber", kind: "note", text: "" }
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

  // P1 面板状态
  const [renderPanelOpen, setRenderPanelOpen] = useState(true)
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false)
  const [rendering, setRendering] = useState(false)

  // 初始化：加载最近的画布，或创建一个新画布。
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const target = await resolveInitialCanvas()
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
      setNodes((current) => {
        // 放到已有节点右侧，避免新节点相互重叠。
        const rightMost = current.reduce(
          (max, item) => Math.max(max, item.position.x + (item.measured?.width ?? 280)),
          Number.NEGATIVE_INFINITY
        )
        const origin = Number.isFinite(rightMost)
          ? { x: rightMost + 80, y: current[current.length - 1]?.position.y ?? position.y }
          : { x: position.x - 140, y: position.y - 100 }

        const node: Node = {
          data: createNodeData(kind) as unknown as Record<string, unknown>,
          id: nextNodeId(),
          position: origin,
          type: kind,
          ...(kind === "note" ? { height: 180, width: 220 } : {}),
        }
        return current.concat(node)
      })
    },
    [screenToFlowPosition, setNodes]
  )

  // 在画布可视区域中央附近找一个空位放新节点
  const nextSpot = useCallback(
    (offsetY = 0) => {
      const current = rfInstance.current
      const center = current
        ? current.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
        : { x: 0, y: 0 }
      return { x: center.x - 140, y: center.y - 120 + offsetY }
    },
    []
  )

  // 把一张图片放到画布上（生成历史插入 / 渲染结果落地）
  const insertImageNode = useCallback(
    (url: string, position?: { x: number; y: number }) => {
      const node: Node = {
        data: { image: { url }, kind: "image" } as unknown as Record<string, unknown>,
        id: nextNodeId(),
        position: position ?? nextSpot(Math.random() * 60),
        type: "image",
      }
      setNodes((current) => current.concat(node))
      return node.id
    },
    [nextSpot, setNodes]
  )

  // 快捷渲染面板提交：上传参考图 → 建 AI 节点占位 → 轮询 → 回填结果
  const handleQuickRender = useCallback(
    async (input: QuickRenderSubmit) => {
      setRendering(true)
      setMessage("")

      const placeholderId = nextNodeId()
      const position = nextSpot()

      // 先放一个运行中的 AI 节点，让用户看到进度
      setNodes((current) =>
        current.concat({
          data: {
            imageCount: 1,
            kind: "ai-image",
            model: input.model,
            outputs: [],
            progress: 0,
            prompt: input.prompt,
            quality: input.quality,
            ratio: input.ratio,
            status: "running",
          } as unknown as Record<string, unknown>,
          id: placeholderId,
          position,
          type: "ai-image",
        })
      )

      const patchPlaceholder = (partial: Record<string, unknown>) => {
        setNodes((current) =>
          current.map((node) =>
            node.id === placeholderId ? { ...node, data: { ...node.data, ...partial } } : node
          )
        )
      }

      try {
        // 底图与风格参考图一并作为参考图上传
        const references = []
        if (input.baseFile) references.push(await uploadReferenceImageFile(input.baseFile))
        if (input.styleFile) references.push(await uploadReferenceImageFile(input.styleFile))

        const task = await createImageGenerationTask({
          imageCount: 1,
          model: input.model,
          prompt: input.prompt,
          quality: input.quality,
          ratio: input.ratio,
          referenceImages: references.length > 0 ? references : undefined,
        })

        const result = await pollImageTask(task.taskId, {
          initialImageUrls: task.imageUrls ?? [],
          onProgress: (progress) => patchPlaceholder({ progress }),
        })

        const outputs = result.imageUrls.map((url) => ({ url }))
        patchPlaceholder({ outputs, progress: 100, status: "done", taskId: task.taskId })

        // 结果同时落一个图片节点，方便继续接入下一轮
        if (result.imageUrls[0]) {
          insertImageNode(result.imageUrls[0], { x: position.x + 360, y: position.y })
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : "生成失败。"
        patchPlaceholder({ error: text, status: "error" })
        setMessage(text)
      } finally {
        setRendering(false)
      }
    },
    [insertImageNode, nextSpot, setNodes]
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
          <ToolbarButton
            icon={Wand2}
            label="快捷渲染"
            onClick={() => setRenderPanelOpen((previous) => !previous)}
            primary
          />
          <ToolbarButton icon={Type} label="文字" onClick={() => addNode("text")} />
          <ToolbarButton icon={ImageIcon} label="图片" onClick={() => addNode("image")} />
          <ToolbarButton icon={StickyNote} label="便签" onClick={() => addNode("note")} />
          <ToolbarButton
            icon={History}
            label="历史"
            onClick={() => setHistoryPanelOpen((previous) => !previous)}
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          {message ? <span className="text-xs text-rose-500">{message}</span> : null}
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
            fitViewOptions={fitViewOptions}
            minZoom={0.2}
            maxZoom={2}
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

        {status !== "loading" ? (
          <>
            <QuickRenderPanel
              busy={rendering}
              onClose={() => setRenderPanelOpen(false)}
              onSubmit={handleQuickRender}
              open={renderPanelOpen}
            />
            <GenerationHistoryPanel
              onClose={() => setHistoryPanelOpen(false)}
              onInsert={(url) => insertImageNode(url)}
              open={historyPanelOpen}
            />
          </>
        ) : null}
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
