"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import Link from "next/link"
import {
  CaptureUpdateAction,
  Excalidraw,
  THEME,
  serializeAsJSON,
} from "@excalidraw/excalidraw"
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types"
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Download,
  FilePlus2,
  History,
  ImageIcon,
  Loader2,
  Maximize2,
  PencilLine,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react"
import { AuthPanel } from "@/components/auth-panel"
import { ForcedPasswordChange } from "@/components/forced-password-change"
import { GeneratedImage } from "@/components/generated-image"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAccountSession, getErrorMessage } from "@/hooks/use-account-session"
import {
  createCanvasLabCloudDocument,
  createCanvasLabAssetUpload,
  createCanvasBinaryImageFile,
  createCanvasImageGenerationTask,
  createCanvasLabAssetBinding,
  createCanvasTaskPlaceholderElements,
  createCanvasUploadElements,
  createCanvasLabVersion,
  buildSceneSignature,
  createProjectElements,
  deleteCanvasLabDocument,
  deleteCanvasLabCloudDocument,
  downloadCanvasImageUrl,
  downloadProjectImage,
  getCanvasGenerationTaskStatus,
  getCanvasLabProjects,
  getCanvasLabCloudDocument,
  getCanvasLabSourceData,
  getCanvasLabTaskSourceData,
  getElementSourceData,
  getProjectImageUrls,
  getProjectPreviewUrl,
  getProjectSourceKey,
  listCanvasLabCloudDocuments,
  listCanvasLabVersions,
  loadCanvasLabDocument,
  loadCanvasLabPrefs,
  sanitizeCanvasLabAppState,
  saveCanvasLabCloudDocument,
  saveCanvasLabDocument,
  saveCanvasLabPrefs,
  restoreCanvasLabVersion,
  uploadCanvasLabAssetFile,
  type CanvasLabCloudDocument,
  type CanvasLabPrefs,
} from "@/lib/canvas-lab"
import type { ProjectItem, ProjectStatus } from "@/lib/project-history"
import { cn } from "@/lib/utils"

type StorageStatus = {
  tone: "idle" | "ok" | "error" | "busy"
  text: string
}

type ActiveCanvasDocument = {
  id: string
  source: "cloud" | "local"
  title: string
  updatedAt: string
}

type CanvasDocumentSummary = {
  assetCount: number
  id: string
  thumbnailUrl: string | null
  title: string
  updatedAt: string
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
  return project.type === "生图" && importableStatuses.has(project.status) && getProjectImageUrls(project).length > 0
}

function canImportProjectVideo(project: ProjectItem) {
  return project.type === "视频" && Boolean(getProjectPreviewUrl(project))
}

function getProjectImportMode(project: ProjectItem) {
  if (canImportProjectImage(project)) {
    return getProjectImageUrls(project).length > 1 ? "bulk-image" : "single-image"
  }

  if (canImportProjectVideo(project)) {
    return "video"
  }

  return "status"
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
  const [activeDocument, setActiveDocument] = useState<ActiveCanvasDocument | null>(null)
  const [canvasDocuments, setCanvasDocuments] = useState<CanvasDocumentSummary[]>([])
  const [canvasSearch, setCanvasSearch] = useState("")
  const [assetSearch, setAssetSearch] = useState("")
  const [assetTypeFilter, setAssetTypeFilter] = useState<"all" | "image" | "video" | "status">("all")
  const [importingKey, setImportingKey] = useState("")
  const saveTimerRef = useRef<number | null>(null)
  const skipNextSaveRef = useRef(true)
  const lastSignatureRef = useRef("")
  const hydratedRef = useRef(false)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let active = true

    loadInitialCanvasDocument()
      .then((result) => {
        if (!active) return

        const document = result.document
        skipNextSaveRef.current = true
        hydratedRef.current = true
        setActiveDocument(result.activeDocument)
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
          tone: "ok",
          text: `${result.activeDocument.source === "cloud" ? "已同步云端" : "已恢复本地缓存"} · ${formatShortTime(document.updatedAt)}`,
        })
        listCanvasLabCloudDocuments()
          .then((documents) => {
            if (!active) return
            setCanvasDocuments(
              documents.map((document) => ({
                id: document.id,
                assetCount: document.assetCount,
                thumbnailUrl: document.thumbnailUrl,
                title: document.title,
                updatedAt: document.updatedAt,
              }))
            )
          })
          .catch(() => undefined)
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

  const refreshCanvasDocuments = useCallback(async () => {
    try {
      const documents = await listCanvasLabCloudDocuments()
      setCanvasDocuments(
        documents.map((document) => ({
          id: document.id,
          assetCount: document.assetCount,
          thumbnailUrl: document.thumbnailUrl,
          title: document.title,
          updatedAt: document.updatedAt,
        }))
      )
    } catch {
      setCanvasDocuments([])
    }
  }, [])

  const hydrateCanvasDocument = useCallback(
    async (documentId: string) => {
      const document = await getCanvasLabCloudDocument(documentId)

      await saveCanvasLabDocument(
        {
          appState: document.appState,
          elements: document.elements,
          files: document.files,
          title: document.title,
        },
        document.id
      ).catch(() => undefined)

      return {
        activeDocument: {
          id: document.id,
          source: "cloud" as const,
          title: document.title,
          updatedAt: document.updatedAt,
        },
        document,
      }
    },
    []
  )

  const openCanvasDocument = useCallback(
    async (documentId: string) => {
      setStorageStatus({ tone: "busy", text: "正在切换画布..." })
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      skipNextSaveRef.current = true
      lastSignatureRef.current = ""

      try {
        const result = await hydrateCanvasDocument(documentId)
        setActiveDocument(result.activeDocument)
        setInitialData({
          appState: result.document.appState,
          elements: result.document.elements,
          files: result.document.files,
        })
        setStorageStatus({
          tone: "ok",
          text: `已打开画布 · ${formatShortTime(result.document.updatedAt)}`,
        })
      } catch (error) {
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "打开画布失败。") })
      }
    },
    [hydrateCanvasDocument]
  )

  const createCanvasDocument = useCallback(async () => {
    setStorageStatus({ tone: "busy", text: "正在创建画布..." })

    try {
      const document = await createCanvasLabCloudDocument("未命名画布")
      await refreshCanvasDocuments()
      await openCanvasDocument(document.id)
    } catch (error) {
      setStorageStatus({ tone: "error", text: getErrorMessage(error, "创建画布失败。") })
    }
  }, [openCanvasDocument, refreshCanvasDocuments])

  const renameCanvasDocument = useCallback(
    async (documentId: string) => {
      const current = canvasDocuments.find((document) => document.id === documentId)
      const nextTitle = window.prompt("输入画布名称", current?.title ?? activeDocument?.title ?? "未命名画布")?.trim()
      if (!nextTitle) return

      try {
        const document = await saveCanvasLabCloudDocument(documentId, {
          title: nextTitle,
        })
        setCanvasDocuments((currentDocuments) =>
          currentDocuments.map((item) => (item.id === documentId ? { ...item, title: document.title, updatedAt: document.updatedAt } : item))
        )
        if (activeDocument?.id === documentId) {
          setActiveDocument({
            id: document.id,
            source: "cloud",
            title: document.title,
            updatedAt: document.updatedAt,
          })
        }
        setStorageStatus({ tone: "ok", text: "画布已重命名" })
      } catch (error) {
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "重命名画布失败。") })
      }
    },
    [activeDocument, canvasDocuments]
  )

  const deleteCanvasDocument = useCallback(
    async (documentId: string) => {
      if (!window.confirm("删除这个画布？历史生成项目不会被删除。")) return

      try {
        await deleteCanvasLabCloudDocument(documentId)
        await refreshCanvasDocuments()

        const remaining = canvasDocuments.filter((document) => document.id !== documentId)
        if (remaining.length > 0) {
          await openCanvasDocument(remaining[0].id)
        } else {
          await createCanvasDocument()
        }
        setStorageStatus({ tone: "ok", text: "画布已删除" })
      } catch (error) {
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "删除画布失败。") })
      }
    },
    [canvasDocuments, createCanvasDocument, openCanvasDocument, refreshCanvasDocuments]
  )

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
      const localPayload = {
        appState: sanitizedAppState,
        elements,
        files,
        title: activeDocument?.title,
      }

      const saveOperation = activeDocument?.source === "cloud"
        ? saveCanvasLabCloudDocument(activeDocument.id, localPayload)
            .then((document) =>
              saveCanvasLabDocument(
                {
                  appState: document.appState,
                  elements: document.elements,
                  files: document.files,
                  title: document.title,
                },
                document.id
              ).then(() => document)
            )
        : saveCanvasLabDocument(localPayload)

      saveOperation
        .then((document) => {
          if (activeDocument?.source === "cloud") {
            setActiveDocument({
              id: document.id,
              source: "cloud",
              title: document.title ?? activeDocument.title,
              updatedAt: document.updatedAt,
            })
          }
          setStorageStatus({ tone: "ok", text: `已保存 · ${formatShortTime(document.updatedAt)}` })
        })
        .catch((error) => {
          saveCanvasLabDocument(localPayload, activeDocument?.id).catch(() => undefined)
          setStorageStatus({ tone: "error", text: getErrorMessage(error, "云端保存失败，已保留本地缓存。") })
        })
    }, 700)
  }, [activeDocument])

  const handleReset = useCallback(async () => {
    if (!api) return
    if (!window.confirm("清空当前本地画布？此操作不会删除历史项目。")) return

    const documentId = activeDocument?.id
    const title = activeDocument?.title

    await deleteCanvasLabDocument(documentId).catch((error) => {
      setStorageStatus({ tone: "error", text: getErrorMessage(error, "清空本地缓存失败。") })
    })
    if (activeDocument?.source === "cloud") {
      await saveCanvasLabCloudDocument(activeDocument.id, {
        appState: {},
        elements: [],
        files: {},
        title,
      }).catch((error) => {
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "清空云端画布失败。") })
      })
    }
    skipNextSaveRef.current = true
    lastSignatureRef.current = ""
    api.resetScene()
    api.history.clear()
    setStorageStatus({ tone: "idle", text: activeDocument?.source === "cloud" ? "云端画布已清空" : "本地画布已清空" })
  }, [activeDocument, api])

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

  const handleCanvasVersions = useCallback(async () => {
    if (activeDocument?.source !== "cloud") {
      setStorageStatus({ tone: "error", text: "本地画布暂不支持版本恢复。" })
      return
    }

    try {
      const versions = await listCanvasLabVersions(activeDocument.id)
      if (versions.length === 0) {
        await createCanvasLabVersion(activeDocument.id, "manual")
        setStorageStatus({ tone: "ok", text: "已保存当前版本" })
        return
      }

      const message = [
        "输入要恢复的版本序号；留空则保存当前版本。",
        ...versions.slice(0, 8).map((version, index) => `${index + 1}. ${formatShortTime(version.createdAt)} · ${version.reason}`),
      ].join("\n")
      const choice = window.prompt(message)?.trim()

      if (!choice) {
        await createCanvasLabVersion(activeDocument.id, "manual")
        setStorageStatus({ tone: "ok", text: "已保存当前版本" })
        return
      }

      const selectedVersion = versions[Number.parseInt(choice, 10) - 1]
      if (!selectedVersion) {
        setStorageStatus({ tone: "error", text: "未找到对应版本。" })
        return
      }

      if (!window.confirm("恢复该版本？恢复前会自动保存当前画布版本。")) return

      const document = await restoreCanvasLabVersion(activeDocument.id, selectedVersion.id)
      await saveCanvasLabDocument(
        {
          appState: document.appState,
          elements: document.elements,
          files: document.files,
          title: document.title,
        },
        document.id
      ).catch(() => undefined)
      skipNextSaveRef.current = true
      lastSignatureRef.current = ""
      setActiveDocument({
        id: document.id,
        source: "cloud",
        title: document.title,
        updatedAt: document.updatedAt,
      })
      setInitialData({
        appState: document.appState,
        elements: document.elements,
        files: document.files,
      })
      setStorageStatus({ tone: "ok", text: "已恢复历史版本" })
    } catch (error) {
      setStorageStatus({ tone: "error", text: getErrorMessage(error, "处理画布版本失败。") })
    }
  }, [activeDocument])

  const handleUploadFile = useCallback(
    async (file: File) => {
      if (!api) return
      if (activeDocument?.source !== "cloud") {
        setStorageStatus({ tone: "error", text: "请先打开云端画布后再上传素材。" })
        return
      }

      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        setStorageStatus({ tone: "error", text: "画布只支持上传 PNG、JPG、WEBP 图片。" })
        return
      }

      if (file.size > 12 * 1024 * 1024) {
        setStorageStatus({ tone: "error", text: "图片大小不能超过 12MB。" })
        return
      }

      setStorageStatus({ tone: "busy", text: "正在上传素材..." })

      try {
        const filePayload = await createCanvasBinaryImageFile(file, `upload:${file.name}:${file.lastModified}`)
        const upload = await createCanvasLabAssetUpload({
          canvasId: activeDocument.id,
          file,
          height: filePayload.height,
          width: filePayload.width,
        })

        await uploadCanvasLabAssetFile(upload, file)

        const elements = createCanvasUploadElements({
          assetId: upload.asset.id,
          existingElementCount: api.getSceneElements().length,
          filePayload,
          storageUrl: upload.publicUrl,
          title: file.name,
        })
        api.addFiles([filePayload.file])
        api.updateScene({
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          elements: [...api.getSceneElements(), ...elements],
        })
        window.requestAnimationFrame(() => {
          api.scrollToContent(elements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.56 })
        })
        setStorageStatus({ tone: "ok", text: "素材已上传并导入画布" })
      } catch (error) {
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "上传素材失败。") })
      }
    },
    [activeDocument, api]
  )

  const handleUploadInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ""
      for (const file of files) {
        await handleUploadFile(file)
      }
    },
    [handleUploadFile]
  )

  const handleCanvasDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      const files = Array.from(event.dataTransfer.files ?? []).filter((file) => file.type.startsWith("image/"))
      if (files.length === 0) return

      event.preventDefault()
      for (const file of files) {
        await handleUploadFile(file)
      }
    },
    [handleUploadFile]
  )

  const handleGenerateFromCanvas = useCallback(async () => {
    if (!api) return

    const selectedElementIds = api.getAppState().selectedElementIds ?? {}
    const selectedElements = api.getSceneElements().filter((element) => selectedElementIds[element.id])
    const selectedPrompt = selectedElements
      .filter((element) => element.type === "text")
      .map((element) => ("text" in element ? String(element.text ?? "") : ""))
      .filter(Boolean)
      .join("\n")
    const prompt = window.prompt("输入生图提示词", selectedPrompt)?.trim()
    if (!prompt) return

    setStorageStatus({ tone: "busy", text: "正在创建生成任务..." })

    try {
      const formData = new FormData()
      const clientRequestId = `canvas-${activeDocument?.id ?? "local"}-${Date.now()}`
      formData.set("prompt", prompt)
      formData.set("imageCount", "1")
      formData.set("clientRequestId", clientRequestId)
      formData.set("sourceCanvasId", activeDocument?.id ?? "")
      formData.set("sourceElementIds", JSON.stringify(selectedElements.map((element) => element.id)))

      const files = api.getFiles()
      const selectedImageElements = selectedElements
        .filter((element) => element.type === "image" && "fileId" in element && element.fileId)
        .slice(0, 4)

      selectedImageElements.forEach((element, index) => {
        const fileId = "fileId" in element ? element.fileId : null
        const fileData = fileId ? files[fileId] : null
        if (!fileData?.dataURL) return

        const file = dataUrlToFile(String(fileData.dataURL), `canvas-reference-${index + 1}.png`, String(fileData.mimeType || "image/png"))
        formData.append("referenceImages", file)
      })

      const result = await createCanvasImageGenerationTask(formData)
      const elements = createCanvasTaskPlaceholderElements({
        canvasId: activeDocument?.id ?? "local",
        existingElementCount: api.getSceneElements().length,
        prompt,
        taskId: result.taskId,
      })

      api.updateScene({
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        elements: [...api.getSceneElements(), ...elements],
      })
      window.requestAnimationFrame(() => {
        api.scrollToContent(elements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.62 })
      })
      setStorageStatus({ tone: "ok", text: "生成任务已创建" })
    } catch (error) {
      setStorageStatus({ tone: "error", text: getErrorMessage(error, "从画布创建生成任务失败。") })
    }
  }, [activeDocument, api])

  const syncCanvasTasks = useCallback(async (silent = false) => {
    if (!api) return

    const currentElements = api.getSceneElements()
    const taskIds = Array.from(
      new Set(currentElements.map((element) => getCanvasLabTaskSourceData(element)?.taskId).filter((taskId): taskId is string => Boolean(taskId)))
    )
    if (taskIds.length === 0) return

    if (!silent) {
      setStorageStatus({ tone: "busy", text: "正在刷新任务状态..." })
    }

    try {
      let sceneElements: readonly OrderedExcalidrawElement[] = currentElements
      const appendedElements: OrderedExcalidrawElement[] = []
      const appendedFiles: Parameters<NonNullable<typeof api>["addFiles"]>[0] = []

      for (const taskId of taskIds) {
        const status = await getCanvasGenerationTaskStatus(taskId)
        const statusText = status.status === "failed" ? "生成失败" : status.status === "completed" || status.status === "partial_completed" ? "已完成" : "生成中"

        sceneElements = sceneElements.map((element) => {
          const source = getCanvasLabTaskSourceData(element)
          if (source?.taskId !== taskId || element.type !== "text" || !("text" in element) || element.text === statusText) {
            return element
          }

          return {
            ...element,
            text: statusText,
          }
        }) as readonly OrderedExcalidrawElement[]

        if (status.status !== "completed" && status.status !== "partial_completed") continue

        for (const [index, imageUrl] of status.imageUrls.entries()) {
          const resultSourceKey = `upload:result:${taskId}:${index}`
          const alreadyInserted = [...sceneElements, ...appendedElements].some(
            (element) => getCanvasLabSourceData(element)?.sourceKey === resultSourceKey
          )
          if (alreadyInserted) continue

          const filePayload = await downloadCanvasImageUrl(imageUrl, `result:${taskId}:${index}`, `canvas-result-${index + 1}.png`)
          if (activeDocument?.source === "cloud") {
            await createCanvasLabAssetBinding(activeDocument.id, {
              externalUrl: imageUrl,
              height: filePayload.height,
              mimeType: filePayload.file.mimeType,
              sourceKey: `result:${taskId}:${index}`,
              sourceTaskId: taskId,
              sourceType: "generation-result",
              storageUrl: imageUrl,
              width: filePayload.width,
            }).catch(() => undefined)
          }
          const elements = createCanvasUploadElements({
            assetId: `result:${taskId}:${index}`,
            existingElementCount: sceneElements.length + appendedElements.length,
            filePayload,
            storageUrl: imageUrl,
            title: `生成结果 ${index + 1}`,
          })
          appendedFiles.push(filePayload.file)
          appendedElements.push(...elements)
        }
      }

      if (appendedFiles.length > 0) {
        api.addFiles(appendedFiles)
      }

      api.updateScene({
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        elements: [...sceneElements, ...appendedElements],
      })

      if (appendedElements.length > 0) {
        window.requestAnimationFrame(() => {
          api.scrollToContent(appendedElements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.58 })
        })
      }

      if (!silent || appendedElements.length > 0) {
        setStorageStatus({ tone: "ok", text: appendedElements.length > 0 ? "生成结果已回填画布" : "任务状态已刷新" })
      }
    } catch (error) {
      if (!silent) {
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "刷新任务状态失败。") })
      }
    }
  }, [activeDocument, api])

  useEffect(() => {
    if (!api) return

    const timer = window.setInterval(() => {
      syncCanvasTasks(true).catch(() => undefined)
    }, 15000)

    return () => window.clearInterval(timer)
  }, [api, syncCanvasTasks])

  const handleImportProject = useCallback(
    async (project: ProjectItem, imageIndex?: number) => {
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
        if (canImportProjectImage(project)) {
          const imageUrls = typeof imageIndex === "number" ? [getProjectImageUrls(project)[imageIndex]].filter(Boolean) : getProjectImageUrls(project)
          const filePayloads = await Promise.all(
            imageUrls.map((imageUrl, index) => downloadProjectImage(project, imageUrl, index))
          )
          if (activeDocument?.source === "cloud") {
            await Promise.allSettled(
              imageUrls.map((imageUrl, index) =>
                createCanvasLabAssetBinding(activeDocument.id, {
                  externalUrl: imageUrl,
                  height: filePayloads[index]?.height,
                  mimeType: filePayloads[index]?.file.mimeType,
                  sourceKey: `project:${getProjectSourceKey(project)}:${index}`,
                  sourceProjectId: project.id,
                  sourceTaskId: project.taskId,
                  sourceType: "project",
                  storageUrl: imageUrl,
                  width: filePayloads[index]?.width,
                })
              )
            )
          }
          const nextElements = filePayloads.flatMap((payload, index) =>
            createProjectElements(project, payload, api.getSceneElements().length + index * 4, String(index))
          )

          api.addFiles(filePayloads.map((payload) => payload.file))
          api.updateScene({
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            elements: [...api.getSceneElements(), ...nextElements],
          })
          window.requestAnimationFrame(() => {
            api.scrollToContent(nextElements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.56 })
          })
          setStorageStatus({ tone: "ok", text: imageUrls.length > 1 ? "已批量导入画布" : "已导入画布" })
        } else if (canImportProjectVideo(project)) {
          if (activeDocument?.source === "cloud") {
            await createCanvasLabAssetBinding(activeDocument.id, {
              externalUrl: getProjectPreviewUrl(project),
              sourceKey: `video:${getProjectSourceKey(project)}`,
              sourceProjectId: project.id,
              sourceTaskId: project.taskId,
              sourceType: "video",
              storageUrl: getProjectPreviewUrl(project),
            }).catch(() => undefined)
          }
          const elements = createProjectElements(project, null, api.getSceneElements().length, "video")
          api.updateScene({
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            elements: [...api.getSceneElements(), ...elements],
          })
          window.requestAnimationFrame(() => {
            api.scrollToContent(elements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.56 })
          })
          setStorageStatus({ tone: "ok", text: "已导入视频状态卡" })
        } else {
          if (activeDocument?.source === "cloud") {
            await createCanvasLabAssetBinding(activeDocument.id, {
              sourceKey: `status:${getProjectSourceKey(project)}`,
              sourceProjectId: project.id,
              sourceTaskId: project.taskId,
              sourceType: "status",
            }).catch(() => undefined)
          }
          const elements = createProjectElements(project, null, api.getSceneElements().length, "status")
          api.updateScene({
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            elements: [...api.getSceneElements(), ...elements],
          })
          window.requestAnimationFrame(() => {
            api.scrollToContent(elements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.56 })
          })
          setStorageStatus({ tone: "ok", text: "已导入状态卡" })
        }
      } catch (error) {
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "导入素材失败。") })
      } finally {
        setImportingKey("")
      }
    },
    [activeDocument, api, importingKey]
  )

  const importableCount = useMemo(() => projects.filter(canImportProjectImage).length, [projects])
  const visibleProjects = useMemo(() => {
    const keyword = canvasSearch.trim().toLowerCase()
    return projects.filter((project) => {
      const haystack = [project.title, project.prompt, project.previewLabel, project.status, project.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return !keyword || haystack.includes(keyword)
    })
  }, [canvasSearch, projects])

  const filteredProjects = useMemo(() => {
    const keyword = assetSearch.trim().toLowerCase()
    return visibleProjects.filter((project) => {
      if (assetTypeFilter === "image" && !canImportProjectImage(project)) return false
      if (assetTypeFilter === "video" && !canImportProjectVideo(project)) return false
      if (assetTypeFilter === "status" && canImportProjectImage(project)) return false

      const haystack = [project.title, project.prompt, project.previewLabel, project.status, project.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return !keyword || haystack.includes(keyword)
    })
  }, [assetSearch, assetTypeFilter, visibleProjects])

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-slate-900" type="button">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{activeDocument?.title ?? "无限画布"}</div>
                  <div className="truncate text-[11px] text-slate-500">{email}</div>
                </div>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 border-slate-800 bg-slate-950 text-slate-100">
              <DropdownMenuLabel>画布列表</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-800" />
              <div className="px-2 pb-2">
                <Input
                  className="h-8 border-slate-800 bg-slate-900 text-xs text-slate-100 placeholder:text-slate-500"
                  onChange={(event) => setCanvasSearch(event.target.value)}
                  placeholder="搜索画布"
                  value={canvasSearch}
                />
              </div>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuItem onClick={createCanvasDocument}>
                <FilePlus2 className="mr-2 h-4 w-4" />
                新建画布
              </DropdownMenuItem>
              {canvasDocuments
                .filter((document) => {
                  const keyword = canvasSearch.trim().toLowerCase()
                  if (!keyword) return true
                  return `${document.title} ${document.updatedAt}`.toLowerCase().includes(keyword)
                })
                .slice(0, 8)
                .map((document) => (
                  <DropdownMenuItem key={document.id} onClick={() => openCanvasDocument(document.id)}>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="flex h-8 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-800 bg-slate-900">
                        {document.thumbnailUrl ? (
                          <img alt="" className="h-full w-full object-cover" src={document.thumbnailUrl} />
                        ) : (
                          <span className="text-[10px] text-slate-500">{document.assetCount}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{document.title}</div>
                        <div className="text-[11px] text-slate-500">{formatShortTime(document.updatedAt)} · {document.assetCount} 素材</div>
                      </div>
                    </div>
                    <div className="ml-2 flex items-center gap-1">
                      <button className="rounded p-1 hover:bg-slate-800" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void renameCanvasDocument(document.id) }} type="button">
                        <PencilLine className="h-3.5 w-3.5" />
                      </button>
                      <button className="rounded p-1 hover:bg-slate-800" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void deleteCanvasDocument(document.id) }} type="button">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Badge className="hidden border-cyan-400/25 bg-cyan-400/10 text-cyan-200 sm:inline-flex" variant="outline">
            Excalidraw
          </Badge>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            multiple
            onChange={handleUploadInputChange}
            ref={uploadInputRef}
            type="file"
          />
          <CanvasSaveStatus status={storageStatus} />
          <Button className="h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white" onClick={() => uploadInputRef.current?.click()} type="button" variant="ghost">
            <UploadCloud className="h-4 w-4" />
            <span className="hidden sm:inline">上传</span>
          </Button>
          <Button className="h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white" onClick={handleGenerateFromCanvas} type="button" variant="ghost">
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">生成</span>
          </Button>
          <Button className="hidden h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white sm:inline-flex" onClick={() => syncCanvasTasks(false)} type="button" variant="ghost">
            <RefreshCcw className="h-4 w-4" />
            刷新任务
          </Button>
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
          <Button className="hidden h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white sm:inline-flex" onClick={handleCanvasVersions} type="button" variant="ghost">
            <History className="h-4 w-4" />
            版本
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
        <section className="min-w-0 flex-1" onDragOver={(event) => event.preventDefault()} onDrop={handleCanvasDrop}>
          <Excalidraw
            key={activeDocument?.id ?? "canvas-local"}
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
            assetSearch={assetSearch}
            assetTypeFilter={assetTypeFilter}
            importingKey={importingKey}
            importableCount={importableCount}
            projects={filteredProjects}
            onAssetSearchChange={setAssetSearch}
            onAssetTypeFilterChange={setAssetTypeFilter}
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
  assetSearch,
  assetTypeFilter,
  importableCount,
  importingKey,
  onImportProject,
  onAssetSearchChange,
  onAssetTypeFilterChange,
  projects,
}: {
  assetSearch: string
  assetTypeFilter: "all" | "image" | "video" | "status"
  importableCount: number
  importingKey: string
  onAssetSearchChange: (value: string) => void
  onAssetTypeFilterChange: (value: "all" | "image" | "video" | "status") => void
  onImportProject: (project: ProjectItem, imageIndex?: number) => void
  projects: ProjectItem[]
}) {
  return (
    <aside className="fixed bottom-0 right-0 top-14 z-30 flex w-[min(92vw,340px)] shrink-0 flex-col border-l border-slate-800 bg-slate-950 shadow-2xl xl:static xl:w-[340px] xl:shadow-none">
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">历史素材</h2>
            <p className="mt-1 text-xs text-slate-500">{importableCount} 个可导入结果</p>
          </div>
          <UploadCloud className="h-4 w-4 text-cyan-300" />
        </div>
        <div className="mt-3 grid gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <Input
              className="h-8 border-slate-800 bg-slate-900 pl-8 text-xs text-slate-100 placeholder:text-slate-500"
              onChange={(event) => onAssetSearchChange(event.target.value)}
              placeholder="搜索项目或提示词"
              value={assetSearch}
            />
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[
              ["all", "全部"],
              ["image", "图片"],
              ["video", "视频"],
              ["status", "状态"],
            ].map(([value, label]) => (
              <Button
                className={cn(
                  "h-7 rounded-md border-slate-800 px-2 text-[11px]",
                  assetTypeFilter === value ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400" : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                )}
                key={value}
                onClick={() => onAssetTypeFilterChange(value as "all" | "image" | "video" | "status")}
                type="button"
                variant="outline"
              >
                {label}
              </Button>
            ))}
          </div>
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
                onImport={(imageIndex) => onImportProject(project, imageIndex)}
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
  onImport: (imageIndex?: number) => void
  project: ProjectItem
}) {
  const previewUrl = getProjectPreviewUrl(project)
  const imageUrls = getProjectImageUrls(project)
  const importMode = getProjectImportMode(project)

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
        {importMode === "single-image" ? (
          <Button
            className="h-8 rounded-md border-slate-700 bg-slate-950 text-xs text-slate-200 hover:bg-cyan-500 hover:text-slate-950"
            disabled={importing}
            onClick={() => onImport()}
            type="button"
            variant="outline"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
            导入图片
          </Button>
        ) : importMode === "bulk-image" ? (
          <div className="grid gap-2">
            <Button
              className="h-8 rounded-md border-slate-700 bg-slate-950 text-xs text-slate-200 hover:bg-cyan-500 hover:text-slate-950"
              disabled={importing}
              onClick={() => onImport()}
              type="button"
              variant="outline"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
              导入全部
            </Button>
            <div className="grid grid-cols-2 gap-1">
              {imageUrls.slice(0, 4).map((url, index) => (
              <Button
                className="h-7 rounded-md border-slate-800 bg-slate-950 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                disabled={importing}
                key={`${project.id}-${index}`}
                onClick={() => onImport(index)}
                type="button"
                variant="outline"
              >
                图 {index + 1}
                </Button>
              ))}
            </div>
          </div>
        ) : importMode === "video" ? (
          <Button
            className="h-8 rounded-md border-slate-700 bg-slate-950 text-xs text-slate-200 hover:bg-cyan-500 hover:text-slate-950"
            disabled={importing}
            onClick={() => onImport()}
            type="button"
            variant="outline"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
            导入视频状态卡
          </Button>
        ) : (
          <Button
            className="h-8 rounded-md border-slate-700 bg-slate-950 text-xs text-slate-200 hover:bg-cyan-500 hover:text-slate-950"
            disabled={importing}
            onClick={() => onImport()}
            type="button"
            variant="outline"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
            导入状态卡
          </Button>
        )}
      </div>
    </article>
  )
}

function formatShortTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "刚刚"

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function dataUrlToFile(dataUrl: string, filename: string, mimeType: string) {
  const [header, content] = dataUrl.split(",")
  const isBase64 = header?.includes(";base64")
  const byteString = isBase64 ? window.atob(content ?? "") : decodeURIComponent(content ?? "")
  const bytes = new Uint8Array(byteString.length)

  for (let index = 0; index < byteString.length; index += 1) {
    bytes[index] = byteString.charCodeAt(index)
  }

  return new File([bytes], filename, { type: mimeType || "image/png" })
}

async function loadInitialCanvasDocument(): Promise<{
  activeDocument: ActiveCanvasDocument
  document: Pick<CanvasLabCloudDocument, "appState" | "elements" | "files" | "id" | "title" | "updatedAt">
}> {
  try {
    const documents = await listCanvasLabCloudDocuments()
    const cloudDocument = documents[0]
      ? await getCanvasLabCloudDocument(documents[0].id)
      : await createCanvasLabCloudDocument("未命名画布")

    await saveCanvasLabDocument(
      {
        appState: cloudDocument.appState,
        elements: cloudDocument.elements,
        files: cloudDocument.files,
        title: cloudDocument.title,
      },
      cloudDocument.id
    ).catch(() => undefined)

    return {
      activeDocument: {
        id: cloudDocument.id,
        source: "cloud",
        title: cloudDocument.title,
        updatedAt: cloudDocument.updatedAt,
      },
      document: cloudDocument,
    }
  } catch {
    const localDocument = await loadCanvasLabDocument()
    if (localDocument) {
      return {
        activeDocument: {
          id: localDocument.id,
          source: "local",
          title: localDocument.title || "本地画布",
          updatedAt: localDocument.updatedAt,
        },
        document: {
          appState: localDocument.appState,
          elements: localDocument.elements,
          files: localDocument.files,
          id: localDocument.id,
          title: localDocument.title || "本地画布",
          updatedAt: localDocument.updatedAt,
        },
      }
    }

    const updatedAt = new Date().toISOString()
    return {
      activeDocument: {
        id: "main",
        source: "local",
        title: "本地新画布",
        updatedAt,
      },
      document: {
        appState: emptyInitialData.appState ?? {},
        elements: [],
        files: {},
        id: "main",
        title: "本地新画布",
        updatedAt,
      },
    }
  }
}
