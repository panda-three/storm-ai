"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  addEdge,
  Background,
  BackgroundVariant,
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
  Download,
  Grid3x3,
  History,
  ImageIcon,
  LayoutGrid,
  Loader2,
  Maximize,
  Redo2,
  Save,
  StickyNote,
  Type,
  Undo2,
  Wand2,
} from "lucide-react"
import { imageModelOptions, imageModelSettings } from "@/lib/model-options"
import {
  createDigitalCanvasDocument,
  getDigitalCanvasDocument,
  listDigitalCanvasDocuments,
  saveDigitalCanvasDocument,
} from "@/lib/digital-canvas/api"
import {
  createEmptyGraph,
  type DigitalCanvasAiImageNodeData,
  type DigitalCanvasImageNodeData,
  type DigitalCanvasNodeKind,
} from "@/lib/digital-canvas/types"
import { AiImageNode } from "@/components/digital-canvas/nodes/ai-image-node"
import { ImageNode } from "@/components/digital-canvas/nodes/image-node"
import { NoteNode } from "@/components/digital-canvas/nodes/note-node"
import { TextNode } from "@/components/digital-canvas/nodes/text-node"
import { GenerationHistoryPanel } from "@/components/digital-canvas/panels/generation-history-panel"
import { QuickRenderPanel } from "@/components/digital-canvas/panels/quick-render-panel"

const nodeTypes = {
  "ai-image": AiImageNode,
  image: ImageNode,
  note: NoteNode,
  text: TextNode,
}

type PanelKind = "quick-render" | "history" | null

interface GraphSnapshot {
  nodes: Node[]
  edges: Edge[]
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
  const [panel, setPanel] = useState<PanelKind>(null)
  const [showGrid, setShowGrid] = useState(true)
  const [addMenu, setAddMenu] = useState<{ flowX: number; flowY: number; x: number; y: number } | null>(null)

  const rfInstance = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const nodesRef = useRef<Node[]>([])
  const edgesRef = useRef<Edge[]>([])
  const historyRef = useRef<{ future: GraphSnapshot[]; past: GraphSnapshot[] }>({ future: [], past: [] })

  const { fitView, screenToFlowPosition } = useReactFlow()

  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [edges, nodes])

  // ---------- 撤销 / 重做 ----------

  // 在每次结构性修改前记录快照。
  const commit = useCallback(() => {
    historyRef.current.past.push({ edges: edgesRef.current, nodes: nodesRef.current })
    if (historyRef.current.past.length > 50) historyRef.current.past.shift()
    historyRef.current.future = []
  }, [])

  const undo = useCallback(() => {
    const snapshot = historyRef.current.past.pop()
    if (!snapshot) return
    historyRef.current.future.push({ edges: edgesRef.current, nodes: nodesRef.current })
    setNodes(snapshot.nodes)
    setEdges(snapshot.edges)
  }, [setEdges, setNodes])

  const redo = useCallback(() => {
    const snapshot = historyRef.current.future.pop()
    if (!snapshot) return
    historyRef.current.past.push({ edges: edgesRef.current, nodes: nodesRef.current })
    setNodes(snapshot.nodes)
    setEdges(snapshot.edges)
  }, [setEdges, setNodes])

  // ---------- 加载 ----------

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

  // ---------- 保存 ----------

  const handleSave = useCallback(async () => {
    if (!documentId) return
    setStatus("saving")
    setMessage("")
    try {
      const viewport = rfInstance.current?.getViewport()
      await saveDigitalCanvasDocument(documentId, {
        graph: {
          edges: edgesRef.current as never,
          nodes: nodesRef.current as never,
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
  }, [documentId, title])

  useEffect(() => {
    if (status !== "ready" || !documentId) return
    const timer = window.setTimeout(() => {
      void handleSave()
    }, 4000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, title])

  // ---------- 节点操作 ----------

  const onConnect = useCallback(
    (connection: Connection) => {
      commit()
      setEdges((current) => addEdge(connection, current))
    },
    [commit, setEdges]
  )

  const addNodeAt = useCallback(
    (kind: DigitalCanvasNodeKind, position: { x: number; y: number }) => {
      commit()
      const node: Node = {
        data: createNodeData(kind) as unknown as Record<string, unknown>,
        id: nextNodeId(),
        position,
        type: kind,
      }
      setNodes((current) => current.concat(node))
    },
    [commit, setNodes]
  )

  const addNode = useCallback(
    (kind: DigitalCanvasNodeKind) => {
      const position = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      addNodeAt(kind, {
        x: position.x - 120 + Math.random() * 60,
        y: position.y - 80 + Math.random() * 60,
      })
    },
    [addNodeAt, screenToFlowPosition]
  )

  // 面板生成结果 / 历史图片 → 派生图片节点。
  const insertImageNodes = useCallback(
    (urls: string[]) => {
      const valid = urls.filter(Boolean)
      if (valid.length === 0) return
      commit()

      const origin = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const created = valid.map((url, index) => ({
        data: { image: { url }, kind: "image" } as unknown as Record<string, unknown>,
        id: nextNodeId(),
        position: { x: origin.x + index * 300, y: origin.y },
        type: "image",
      })) satisfies Node[]

      setNodes((current) => current.concat(created))
      window.setTimeout(() => void fitView({ duration: 300, padding: 0.2 }), 50)
    },
    [commit, fitView, screenToFlowPosition, setNodes]
  )

  // 快捷渲染面板「取选中节点」：读取当前选中的图片类节点。
  const pickSelectedCanvasImage = useCallback(() => {
    const selected = nodesRef.current.filter((node) => node.selected)
    for (const node of selected) {
      if (node.type === "image") {
        const url = (node.data as unknown as DigitalCanvasImageNodeData).image?.url
        if (url) return url
      }
      if (node.type === "ai-image") {
        const url = (node.data as unknown as DigitalCanvasAiImageNodeData).outputs?.[0]?.url
        if (url) return url
      }
    }
    return null
  }, [])

  // 自动整理：按网格重排所有节点。
  const autoArrange = useCallback(() => {
    commit()
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodesRef.current.length)))
    setNodes((current) =>
      current.map((node, index) => ({
        ...node,
        position: { x: (index % columns) * 340, y: Math.floor(index / columns) * 360 },
      }))
    )
    window.setTimeout(() => void fitView({ duration: 300, padding: 0.2 }), 50)
  }, [commit, fitView, setNodes])

  const exportGraph = useCallback(() => {
    const payload = JSON.stringify(
      { edges: edgesRef.current, nodes: nodesRef.current, title },
      null,
      2
    )
    const blob = new Blob([payload], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.download = `${title || "digital-canvas"}.json`
    link.href = url
    link.click()
    URL.revokeObjectURL(url)
  }, [title])

  // ---------- 快捷键 ----------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable
      if (!(event.metaKey || event.ctrlKey)) return

      const key = event.key.toLowerCase()
      if (key === "s") {
        event.preventDefault()
        void handleSave()
        return
      }
      if (editing) return
      if (key === "z" && !event.shiftKey) {
        event.preventDefault()
        undo()
        return
      }
      if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleSave, redo, undo])

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
            className="w-40 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-slate-900 outline-none transition hover:border-slate-200 focus:border-cyan-300"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </div>

        <div className="ml-2 flex items-center gap-1.5">
          <ToolbarButton icon={Type} label="文字" onClick={() => addNode("text")} />
          <ToolbarButton icon={ImageIcon} label="图片" onClick={() => addNode("image")} />
          <ToolbarButton icon={StickyNote} label="便签" onClick={() => addNode("note")} />
          <ToolbarButton icon={Wand2} label="AI 绘图" onClick={() => addNode("ai-image")} primary />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <IconButton icon={Undo2} label="撤销" onClick={undo} />
          <IconButton icon={Redo2} label="重做" onClick={redo} />
          <IconButton
            active={showGrid}
            icon={Grid3x3}
            label="网格"
            onClick={() => setShowGrid((value) => !value)}
          />
          <IconButton icon={LayoutGrid} label="自动整理" onClick={autoArrange} />
          <IconButton
            icon={Maximize}
            label="找回全部节点"
            onClick={() => void fitView({ duration: 400, padding: 0.2 })}
          />
          <IconButton icon={Download} label="导出工程" onClick={exportGraph} />

          {message ? (
            <span className="max-w-48 truncate rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700" title={message}>
              {message}
            </span>
          ) : null}
          <button
            className="ml-1 flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            disabled={status === "saving" || status === "loading"}
            onClick={() => void handleSave()}
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
          <span className="hidden text-xs text-slate-400 xl:inline">{email}</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧 Dock */}
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-3">
          <DockButton
            active={panel === "quick-render"}
            icon={Wand2}
            label="快捷渲染"
            onClick={() => setPanel((current) => (current === "quick-render" ? null : "quick-render"))}
          />
          <DockButton
            active={panel === "history"}
            icon={History}
            label="生成历史"
            onClick={() => setPanel((current) => (current === "history" ? null : "history"))}
          />
          <DockButton icon={StickyNote} label="便签" onClick={() => addNode("note")} />
          <div className="mt-auto flex flex-col items-center gap-1">
            <DockButton icon={Save} label="保存" onClick={() => void handleSave()} />
            <DockButton icon={Download} label="导出" onClick={exportGraph} />
          </div>
        </nav>

        {panel === "quick-render" ? (
          <QuickRenderPanel
            onClose={() => setPanel(null)}
            onResults={insertImageNodes}
            pickSelectedCanvasImage={pickSelectedCanvasImage}
          />
        ) : null}
        {panel === "history" ? (
          <GenerationHistoryPanel onClose={() => setPanel(null)} onInsert={insertImageNodes} />
        ) : null}

        <div className="relative min-w-0 flex-1">
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
              onBeforeDelete={async () => {
                commit()
                return true
              }}
              onConnect={onConnect}
              onDoubleClick={(event) => {
                // 双击空白处打开添加节点菜单
                const targetIsPane = (event.target as HTMLElement).classList.contains("react-flow__pane")
                if (!targetIsPane) return
                const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
                setAddMenu({ flowX: flow.x, flowY: flow.y, x: event.clientX, y: event.clientY })
              }}
              onEdgesChange={onEdgesChange}
              onInit={(instance) => {
                rfInstance.current = instance
              }}
              onNodeDragStart={commit}
              onNodesChange={onNodesChange}
              onPaneClick={() => setAddMenu(null)}
              panOnScroll={false}
              proOptions={{ hideAttribution: true }}
              selectionOnDrag
            >
              <Background
                color="#cbd5e1"
                gap={20}
                variant={showGrid ? BackgroundVariant.Dots : BackgroundVariant.Lines}
                style={showGrid ? undefined : { opacity: 0 }}
              />
              <Controls />
              <MiniMap pannable zoomable className="!bg-white" />
            </ReactFlow>
          )}

          {addMenu ? (
            <div
              className="fixed z-40 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
              style={{ left: addMenu.x, top: addMenu.y }}
            >
              {(
                [
                  { icon: Type, kind: "text", label: "文字" },
                  { icon: ImageIcon, kind: "image", label: "图片" },
                  { icon: StickyNote, kind: "note", label: "便签" },
                  { icon: Wand2, kind: "ai-image", label: "AI 绘图" },
                ] as { icon: typeof Type; kind: DigitalCanvasNodeKind; label: string }[]
              ).map((item) => (
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 transition hover:bg-slate-50"
                  key={item.kind}
                  onClick={() => {
                    addNodeAt(item.kind, { x: addMenu.flowX, y: addMenu.flowY })
                    setAddMenu(null)
                  }}
                  type="button"
                >
                  <item.icon className="h-3.5 w-3.5 text-slate-400" />
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-slate-200 bg-white px-4 text-[11px] text-slate-400">
        <span>双击空白添加节点</span>
        <span>Ctrl+Z 撤销</span>
        <span>Ctrl+Shift+Z 重做</span>
        <span>Ctrl+S 保存</span>
        <span>Delete 删除</span>
        <span>滚轮缩放</span>
        <span>拖拽空白框选</span>
      </footer>
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
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm transition ${
        primary
          ? "border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  )
}

function IconButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: typeof Type
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className={`rounded-lg p-1.5 transition ${
        active ? "bg-cyan-50 text-cyan-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

function DockButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: typeof Type
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`flex w-full flex-col items-center gap-0.5 px-1 py-2 text-[10px] transition ${
        active ? "text-cyan-700" : "text-slate-500 hover:text-slate-900"
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
          active ? "bg-cyan-50" : "hover:bg-slate-100"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
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
