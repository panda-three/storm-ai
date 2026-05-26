"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  CaptureUpdateAction,
  Excalidraw,
  THEME,
  convertToExcalidrawElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw"
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types"
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform"
import {
  AlertCircle,
  ArrowLeft,
  Download,
  ImageIcon,
  Loader2,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  RotateCcw,
  UploadCloud,
} from "lucide-react"
import { AuthPanel } from "@/components/auth-panel"
import { ForcedPasswordChange } from "@/components/forced-password-change"
import { GeneratedImage } from "@/components/generated-image"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAccountSession, getErrorMessage } from "@/hooks/use-account-session"
import {
  canvasLabSourceCustomDataKey,
  createCanvasLabId,
  deleteCanvasLabDocument,
  getCanvasLabProjects,
  getElementSourceData,
  getProjectDownloadUrl,
  getProjectImportFilename,
  getProjectPreviewUrl,
  getProjectSourceData,
  getProjectSourceKey,
  loadCanvasLabDocument,
  loadCanvasLabPrefs,
  sanitizeCanvasLabAppState,
  saveCanvasLabDocument,
  saveCanvasLabPrefs,
  type CanvasLabPrefs,
  type CanvasLabSourceData,
} from "@/lib/canvas-lab"
import type { ProjectItem, ProjectStatus } from "@/lib/project-history"
import { cn } from "@/lib/utils"

type StorageStatus = {
  tone: "idle" | "ok" | "error" | "busy"
  text: string
}

const emptyInitialData: ExcalidrawInitialDataState = {
  appState: {
    gridSize: 24,
    scrollX: 0,
    scrollY: 0,
    viewBackgroundColor: "#020617",
    zoom: { value: 1 as AppState["zoom"]["value"] },
  },
  elements: [],
  files: {},
}

const importableStatuses = new Set<ProjectStatus>(["已完成", "部分完成"])

function canImportProjectImage(project: ProjectItem) {
  return project.type === "生图" && importableStatuses.has(project.status) && Boolean(getProjectPreviewUrl(project))
}

export function CanvasLabShell() {
  const {
    account,
    accountStatus,
    authReady,
    refreshAccount,
    reloadAuthSession,
    signOut,
    syncError,
    user,
  } = useAccountSession()

  if (!authReady) {
    return <CanvasLabLoading text="正在加载账户..." />
  }

  if (!user) {
    return <AuthPanel onAuthed={reloadAuthSession} variant="landing" />
  }

  if (accountStatus === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900/80 p-5 text-center shadow-xl">
          <AlertCircle className="mx-auto h-6 w-6 text-rose-300" />
          <h1 className="mt-3 text-base font-semibold">账户加载失败</h1>
          <p className="mt-2 text-sm text-slate-400">{syncError || "加载 Supabase 数据失败。"}</p>
          <Button className="mt-4 bg-cyan-500 text-slate-950 hover:bg-cyan-400" onClick={refreshAccount} type="button">
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (accountStatus !== "ready" || !account || account.userId !== user.id) {
    return <CanvasLabLoading text="正在同步画布素材..." />
  }

  if (account.mustChangePassword) {
    return <ForcedPasswordChange onChanged={refreshAccount} onSignOut={signOut} />
  }

  return (
    <CanvasLabWorkspace
      email={user.email ?? "未设置邮箱"}
      projects={getCanvasLabProjects(account.projects)}
      syncError={syncError}
      onRefreshAccount={refreshAccount}
    />
  )
}

function CanvasLabLoading({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {text}
    </div>
  )
}

function CanvasLabWorkspace({
  email,
  onRefreshAccount,
  projects,
  syncError,
}: {
  email: string
  onRefreshAccount: () => void
  projects: ProjectItem[]
  syncError: string
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null)
  const [prefs, setPrefs] = useState<CanvasLabPrefs>(() => loadCanvasLabPrefs())
  const [storageStatus, setStorageStatus] = useState<StorageStatus>({
    tone: "busy",
    text: "正在加载画布...",
  })
  const [importingKey, setImportingKey] = useState("")
  const saveTimerRef = useRef<number | null>(null)
  const skipNextSaveRef = useRef(true)
  const lastSignatureRef = useRef("")
  const hydratedRef = useRef(false)

  useEffect(() => {
    let active = true

    loadCanvasLabDocument()
      .then((document) => {
        if (!active) return

        skipNextSaveRef.current = true
        hydratedRef.current = true
        setInitialData(
          document
            ? {
                appState: document.appState,
                elements: document.elements,
                files: document.files,
              }
            : emptyInitialData
        )
        setStorageStatus({
          tone: document ? "ok" : "idle",
          text: document ? `已恢复画布 · ${formatShortTime(document.updatedAt)}` : "本地新画布",
        })
      })
      .catch((error) => {
        if (!active) return

        skipNextSaveRef.current = true
        hydratedRef.current = true
        setInitialData(emptyInitialData)
        setStorageStatus({
          tone: "error",
          text: getErrorMessage(error, "画布存储读取失败，已打开空白画布。"),
        })
      })

    return () => {
      active = false
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  const updatePrefs = useCallback((nextPrefs: CanvasLabPrefs) => {
    setPrefs(nextPrefs)
    saveCanvasLabPrefs(nextPrefs)
  }, [])

  const saveCurrentScene = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    if (!hydratedRef.current) return

    const sanitizedAppState = sanitizeCanvasLabAppState(appState)
    const signature = buildSceneSignature(elements, sanitizedAppState, files)

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      lastSignatureRef.current = signature
      return
    }

    if (lastSignatureRef.current === signature) return
    lastSignatureRef.current = signature

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    setStorageStatus({ tone: "busy", text: "正在保存..." })
    saveTimerRef.current = window.setTimeout(() => {
      saveCanvasLabDocument({
        appState: sanitizedAppState,
        elements,
        files,
      })
        .then((document) => {
          setStorageStatus({ tone: "ok", text: `已保存 · ${formatShortTime(document.updatedAt)}` })
        })
        .catch((error) => {
          setStorageStatus({ tone: "error", text: getErrorMessage(error, "画布保存失败。") })
        })
    }, 700)
  }, [])

  const handleReset = useCallback(async () => {
    if (!api) return
    if (!window.confirm("清空当前本地画布？此操作不会删除历史项目。")) return

    await deleteCanvasLabDocument().catch((error) => {
      setStorageStatus({ tone: "error", text: getErrorMessage(error, "清空本地画布失败。") })
    })
    skipNextSaveRef.current = true
    lastSignatureRef.current = ""
    api.resetScene()
    api.history.clear()
    setStorageStatus({ tone: "idle", text: "本地画布已清空" })
  }, [api])

  const handleExportJson = useCallback(() => {
    if (!api) return

    const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local")
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `storm-canvas-${Date.now().toString(36)}.excalidraw`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [api])

  const handleImportProject = useCallback(
    async (project: ProjectItem) => {
      if (!api || importingKey) return

      const sourceKey = getProjectSourceKey(project)
      const existing = api.getSceneElements().find((element) => getElementSourceData(element)?.sourceKey === sourceKey)
      if (existing) {
        api.scrollToContent(existing, { animate: true, fitToViewport: true, viewportZoomFactor: 0.62 })
        setStorageStatus({ tone: "idle", text: "该项目已在画布中" })
        return
      }

      setImportingKey(sourceKey)
      setStorageStatus({ tone: "busy", text: "正在导入素材..." })

      try {
        const filePayload = canImportProjectImage(project) ? await downloadProjectFile(project) : null
        const elements = createProjectElements(project, filePayload, api.getSceneElements().length)

        if (filePayload) {
          api.addFiles([filePayload.file])
        }

        api.updateScene({
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          elements: [...api.getSceneElements(), ...elements],
        })
        window.requestAnimationFrame(() => {
          api.scrollToContent(elements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.56 })
        })
        setStorageStatus({ tone: "ok", text: "已导入画布" })
      } catch (error) {
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "导入素材失败。") })
      } finally {
        setImportingKey("")
      }
    },
    [api, importingKey]
  )

  const importableCount = useMemo(() => projects.filter(canImportProjectImage).length, [projects])

  if (!initialData) {
    return <CanvasLabLoading text="正在初始化画布..." />
  }

  return (
    <div className="canvas-lab-page flex h-screen min-h-0 flex-col bg-slate-950 text-slate-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950/95 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild className="h-9 w-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white" size="icon" variant="ghost">
            <Link aria-label="返回工作台" href="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">无限画布实验页</div>
            <div className="truncate text-[11px] text-slate-500">{email}</div>
          </div>
          <Badge className="hidden border-cyan-400/25 bg-cyan-400/10 text-cyan-200 sm:inline-flex" variant="outline">
            Excalidraw
          </Badge>
        </div>

        <div className="flex items-center gap-1.5">
          <CanvasSaveStatus status={storageStatus} />
          <Button className="hidden h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white sm:inline-flex" onClick={onRefreshAccount} type="button" variant="ghost">
            <RefreshCcw className="h-4 w-4" />
            同步历史
          </Button>
          <Button className="h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white" onClick={() => api?.scrollToContent(undefined, { animate: true, fitToViewport: true, viewportZoomFactor: 0.78 })} type="button" variant="ghost">
            <Maximize2 className="h-4 w-4" />
            <span className="hidden sm:inline">适配</span>
          </Button>
          <Button className="hidden h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white sm:inline-flex" onClick={handleExportJson} type="button" variant="ghost">
            <Download className="h-4 w-4" />
            导出
          </Button>
          <Button className="hidden h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white sm:inline-flex" onClick={handleReset} type="button" variant="ghost">
            <RotateCcw className="h-4 w-4" />
            清空
          </Button>
          <Button className="h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white" onClick={() => updatePrefs({ assetRailOpen: !prefs.assetRailOpen })} type="button" variant="ghost">
            {prefs.assetRailOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            <span className="hidden sm:inline">素材</span>
          </Button>
        </div>
      </header>

      {syncError && (
        <div className="fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 shadow-lg">
          {syncError}
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1">
          <Excalidraw
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
              },
              tools: {
                image: true,
              },
            }}
            aiEnabled={false}
            autoFocus
            excalidrawAPI={setApi}
            initialData={initialData}
            langCode="zh-CN"
            name="季风无限画布"
            onChange={saveCurrentScene}
            theme={THEME.DARK}
          />
        </section>

        {prefs.assetRailOpen && (
          <ProjectAssetRail
            importingKey={importingKey}
            importableCount={importableCount}
            projects={projects}
            onImportProject={handleImportProject}
          />
        )}
      </main>
    </div>
  )
}

function CanvasSaveStatus({ status }: { status: StorageStatus }) {
  return (
    <span
      className={cn(
        "hidden rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-flex",
        status.tone === "ok" && "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
        status.tone === "busy" && "border-cyan-400/20 bg-cyan-400/10 text-cyan-200",
        status.tone === "error" && "border-rose-400/25 bg-rose-400/10 text-rose-200",
        status.tone === "idle" && "border-slate-700 bg-slate-900 text-slate-400"
      )}
    >
      {status.text}
    </span>
  )
}

function ProjectAssetRail({
  importableCount,
  importingKey,
  onImportProject,
  projects,
}: {
  importableCount: number
  importingKey: string
  onImportProject: (project: ProjectItem) => void
  projects: ProjectItem[]
}) {
  return (
    <aside className="hidden w-[340px] shrink-0 border-l border-slate-800 bg-slate-950 xl:flex xl:flex-col">
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">历史素材</h2>
            <p className="mt-1 text-xs text-slate-500">{importableCount} 个可导入结果</p>
          </div>
          <UploadCloud className="h-4 w-4 text-cyan-300" />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-3 p-3">
          {projects.length === 0 ? (
            <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-slate-800 bg-slate-900/45 px-4 text-center text-sm text-slate-500">
              暂无历史项目
            </div>
          ) : (
            projects.map((project) => (
              <ProjectAssetCard
                importing={importingKey === getProjectSourceKey(project)}
                key={getProjectSourceKey(project)}
                project={project}
                onImport={() => onImportProject(project)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function ProjectAssetCard({
  importing,
  onImport,
  project,
}: {
  importing: boolean
  onImport: () => void
  project: ProjectItem
}) {
  const previewUrl = getProjectPreviewUrl(project)
  const canImportImage = canImportProjectImage(project)

  return (
    <article className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/55">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-slate-900">
        {previewUrl ? (
          <GeneratedImage
            alt={project.title}
            className="h-full w-full object-cover"
            fallbackClassName="h-full w-full bg-slate-900 text-slate-400"
            fallbackIconClassName="h-6 w-6"
            sizes="340px"
            src={previewUrl}
          />
        ) : (
          <ImageIcon className="h-8 w-8 text-slate-600" />
        )}
        <Badge className="absolute left-2 top-2 border-slate-700 bg-slate-950/80 text-slate-200" variant="outline">
          {project.status}
        </Badge>
      </div>

      <div className="grid gap-2 p-3">
        <div>
          <h3 className="line-clamp-1 text-sm font-semibold text-slate-100">{project.title || "未命名项目"}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{project.prompt || project.previewLabel || "无提示词记录"}</p>
        </div>
        <Button
          className="h-8 rounded-md border-slate-700 bg-slate-950 text-xs text-slate-200 hover:bg-cyan-500 hover:text-slate-950"
          disabled={importing}
          onClick={onImport}
          type="button"
          variant="outline"
        >
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
          {canImportImage ? "导入图片" : "导入状态卡"}
        </Button>
      </div>
    </article>
  )
}

function buildSceneSignature(elements: readonly OrderedExcalidrawElement[], appState: Record<string, unknown>, files: BinaryFiles) {
  return JSON.stringify({
    appState,
    elements: elements.map((element) => [element.id, element.version, element.versionNonce, element.isDeleted]),
    files: Object.keys(files)
      .sort()
      .map((id) => [id, files[id]?.version ?? 0]),
  })
}

function formatShortTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "刚刚"

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

async function downloadProjectFile(project: ProjectItem) {
  const downloadUrl = getProjectDownloadUrl(project)
  if (!downloadUrl) return null

  const response = await fetch(`/api/download?url=${encodeURIComponent(downloadUrl)}&filename=${encodeURIComponent(getProjectImportFilename(project))}`)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(getPayloadErrorMessage(payload, `图片下载失败：HTTP ${response.status}。`))
  }

  const blob = await response.blob()
  if (!blob.type.startsWith("image/")) {
    throw new Error("画布仅支持导入图片资源。")
  }

  const dataURL = await blobToDataURL(blob)
  const size = await getImageSize(blob).catch(() => ({ width: 320, height: 220 }))
  const sourceKey = getProjectSourceKey(project)
  const file: BinaryFileData = {
    created: Date.now(),
    dataURL: dataURL as BinaryFileData["dataURL"],
    id: createCanvasLabId("file", sourceKey) as BinaryFileData["id"],
    lastRetrieved: Date.now(),
    mimeType: blob.type as BinaryFileData["mimeType"],
  }

  return {
    file,
    height: size.height,
    width: size.width,
  }
}

function getPayloadErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: unknown }).error
    if (typeof error === "string" && error) return error
  }

  return getErrorMessage(payload, fallback)
}

function blobToDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败。"))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

function getImageSize(blob: Blob) {
  return new Promise<{ height: number; width: number }>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ height: image.naturalHeight || 220, width: image.naturalWidth || 320 })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("图片尺寸读取失败。"))
    }
    image.src = url
  })
}

function createProjectElements(
  project: ProjectItem,
  filePayload: Awaited<ReturnType<typeof downloadProjectFile>>,
  existingElementCount: number
) {
  const source = getProjectSourceData(project)
  const sourceKey = getProjectSourceKey(project)
  const x = 80 + (existingElementCount % 6) * 36
  const y = 80 + (existingElementCount % 5) * 32
  const cardWidth = 380
  const imageWidth = filePayload ? Math.min(330, Math.max(220, filePayload.width)) : 0
  const imageHeight = filePayload ? Math.min(260, Math.max(160, Math.round((imageWidth / filePayload.width) * filePayload.height))) : 0
  const cardHeight = filePayload ? imageHeight + 112 : 210
  const skeletons: ExcalidrawElementSkeleton[] = [
    {
      backgroundColor: "#0f172a",
      customData: buildElementCustomData(source),
      fillStyle: "solid",
      height: cardHeight,
      id: createCanvasLabId("card", sourceKey),
      roughness: 0,
      strokeColor: "#334155",
      type: "rectangle",
      width: cardWidth,
      x,
      y,
    },
  ]

  if (filePayload) {
    skeletons.push({
      customData: buildElementCustomData(source),
      fileId: filePayload.file.id,
      height: imageHeight,
      id: createCanvasLabId("image", sourceKey),
      type: "image",
      width: imageWidth,
      x: x + 24,
      y: y + 24,
    })
  }

  skeletons.push(
    {
      customData: buildElementCustomData(source),
      fontSize: 20,
      height: 28,
      id: createCanvasLabId("title", sourceKey),
      strokeColor: "#f8fafc",
      text: project.title || (project.type === "视频" ? "视频项目" : "图片项目"),
      type: "text",
      width: cardWidth - 48,
      x: x + 24,
      y: y + (filePayload ? imageHeight + 40 : 28),
    },
    {
      customData: buildElementCustomData(source),
      fontSize: 14,
      height: 48,
      id: createCanvasLabId("meta", sourceKey),
      strokeColor: "#94a3b8",
      text: buildProjectCardDescription(project),
      type: "text",
      width: cardWidth - 48,
      x: x + 24,
      y: y + (filePayload ? imageHeight + 74 : 68),
    }
  )

  return convertToExcalidrawElements(skeletons, { regenerateIds: false }) as OrderedExcalidrawElement[]
}

function buildElementCustomData(source: CanvasLabSourceData) {
  return {
    [canvasLabSourceCustomDataKey]: source,
  }
}

function buildProjectCardDescription(project: ProjectItem) {
  const parts = [
    project.status,
    project.model,
    project.ratio,
    project.quality,
    project.prompt,
  ].filter(Boolean)

  return parts.join(" · ").slice(0, 220) || "无项目详情"
}
