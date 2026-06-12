"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import Link from "next/link"
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  THEME,
  exportToBlob,
  serializeAsJSON,
} from "@excalidraw/excalidraw"
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types"
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import {
  AlertCircle,
  ArrowLeft,
  Box,
  ChevronDown,
  Download,
  Film,
  FilePlus2,
  History,
  ImageIcon,
  Loader2,
  Maximize2,
  MessageSquare,
  PencilLine,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCcw,
  RectangleHorizontal,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
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
  getImageRatiosForSelection,
  imageModelSettings,
  isApimartImageModel,
  videoModelSettings,
  yunwuGeminiImageModelName,
  yunwuVeo31FastVideoModelName,
} from "@/lib/model-options"
import {
  findModelPricing,
  getAvailableModelConfigs,
  getAvailableQualities,
  getAvailableVideoVariants,
  getDefaultModel,
  getPreferredImageQuality,
  getPreferredVideoDuration,
  getPreferredVideoQuality,
} from "@/lib/studio-options"
import {
  createCanvasLabCloudDocument,
  createCanvasLabAssetUpload,
  createCanvasBinaryImageFile,
  createCanvasImageGenerationTask,
  createCanvasLabAssetBinding,
  createCanvasLabThumbnailUpload,
  createCanvasTaskPlaceholderElements,
  createCanvasVideoGenerationTask,
  createCanvasUploadElements,
  createCanvasLabVersion,
  buildSceneSignature,
  canvasLabSourceCustomDataKey,
  createProjectElements,
  deleteCanvasLabDocument,
  deleteCanvasLabCloudDocument,
  downloadCanvasLabImageAsDataUrl,
  downloadCanvasImageUrl,
  downloadProjectImage,
  getCanvasGenerationTaskStatus,
  getCanvasLabProjects,
  getCanvasLabCloudDocument,
  getCanvasLabSourceData,
  getCanvasLabTaskSourceData,
  getElementSourceData,
  getProjectImageSourceKey,
  getProjectImageUrls,
  getProjectPreviewUrl,
  getProjectStatusSourceKey,
  getProjectSourceKey,
  getProjectVideoSourceKey,
  listCanvasLabCloudDocuments,
  listCanvasLabVersions,
  loadCanvasLabDocument,
  loadCanvasLabPrefs,
  sanitizeCanvasLabAppState,
  sanitizeCanvasLabElements,
  saveCanvasLabCloudDocument,
  saveCanvasLabDocument,
  saveCanvasLabPrefs,
  shouldSuppressCanvasLabLink,
  restoreCanvasLabVersion,
  stripCanvasLabFileData,
  uploadCanvasLabAssetFile,
  uploadCanvasLabThumbnail,
  type CanvasLabCloudDocument,
  type CanvasLabPrefs,
  type CanvasLabSourceData,
} from "@/lib/canvas-lab"
import type { ProjectItem, ProjectStatus } from "@/lib/project-history"
import {
  loadPublicModelConfigs,
  loadPublicModelPricing,
  type ModelConfig,
  type PublicModelPricing,
} from "@/lib/supabase"
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

type CanvasStudioReference = {
  elementId: string
  id: string
  file: File
  previewUrl: string
}

type CanvasStudioGenerationOptions = {
  duration: string
  imageCount: string
  mode: "image" | "video"
  model: string
  prompt: string
  quality: string
  ratio: string
  references: CanvasStudioReference[]
  referenceElementIds: string[]
}

type PersistedNativeImage = {
  assetId: string
  elementId: string
  storageUrl: string
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
  const [studioOpen, setStudioOpen] = useState(false)
  const [studioPrompt, setStudioPrompt] = useState("")
  const [studioReferences, setStudioReferences] = useState<CanvasStudioReference[]>([])
  const [studioError, setStudioError] = useState("")
  const [studioStatus, setStudioStatus] = useState("")
  const [studioGenerating, setStudioGenerating] = useState(false)
  const [renderingReferences, setRenderingReferences] = useState(false)
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([])
  const [modelPricing, setModelPricing] = useState<PublicModelPricing[]>([])
  const [modelOptionsReady, setModelOptionsReady] = useState(false)
  const [selectedReferenceCount, setSelectedReferenceCount] = useState(0)
  const [pendingCanvasTaskIds, setPendingCanvasTaskIds] = useState<string[]>([])
  const saveTimerRef = useRef<number | null>(null)
  const skipNextSaveRef = useRef(true)
  const lastSignatureRef = useRef("")
  const hydratedRef = useRef(false)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const lastVersionSnapshotRef = useRef(0)
  const lastThumbnailSnapshotRef = useRef(0)
  const nativeImageUploadKeysRef = useRef(new Set<string>())

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
                elements: sanitizeCanvasLabElements(document.elements),
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

  useEffect(() => {
    let active = true

    setModelOptionsReady(false)
    Promise.all([loadPublicModelConfigs(), loadPublicModelPricing()])
      .then(([configs, pricing]) => {
        if (!active) return
        setModelConfigs(configs)
        setModelPricing(pricing)
        setModelOptionsReady(true)
      })
      .catch((error) => {
        if (!active) return
        setModelConfigs([])
        setModelPricing([])
        setModelOptionsReady(true)
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "加载创作台模型配置失败。") })
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    return () => {
      studioReferences.forEach((reference) => revokeCanvasReferencePreviewUrl(reference.previewUrl))
    }
  }, [studioReferences])

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
      const elements = sanitizeCanvasLabElements(document.elements)
      const files = await hydrateCanvasLabFiles(elements, document.files)

      await saveCanvasLabDocument(
        {
          appState: document.appState,
          elements,
          files,
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
        document: {
          ...document,
          elements,
          files,
        },
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
          elements: sanitizeCanvasLabElements(result.document.elements),
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

  const maybeCreateAutomaticVersion = useCallback((documentId: string) => {
    const now = Date.now()
    if (now - lastVersionSnapshotRef.current < 5 * 60 * 1000) return
    lastVersionSnapshotRef.current = now
    createCanvasLabVersion(documentId, "autosave").catch(() => undefined)
  }, [])

  const maybeUpdateCanvasThumbnail = useCallback((
    documentId: string,
    elements: readonly OrderedExcalidrawElement[],
    appState: CanvasLabCloudDocument["appState"],
    files: BinaryFiles
  ) => {
    const now = Date.now()
    if (elements.length === 0 || now - lastThumbnailSnapshotRef.current < 60 * 1000) return
    lastThumbnailSnapshotRef.current = now

    createCanvasThumbnailBlob(elements, appState, files)
      .then(async (thumbnail) => {
        if (!thumbnail) return
        const upload = await createCanvasLabThumbnailUpload({
          canvasId: documentId,
          thumbnail,
        })
        await uploadCanvasLabThumbnail(upload, thumbnail)
        const document = await saveCanvasLabCloudDocument(documentId, {
          thumbnailUrl: upload.publicUrl,
        })
        setCanvasDocuments((currentDocuments) =>
          currentDocuments.map((item) =>
            item.id === documentId
              ? {
                  ...item,
                  thumbnailUrl: document.thumbnailUrl,
                  updatedAt: document.updatedAt,
                }
              : item
          )
        )
      })
      .catch(() => undefined)
  }, [])

  const persistNativeImageUploads = useCallback((
    elements: readonly OrderedExcalidrawElement[],
    files: BinaryFiles
  ) => {
    if (!api || activeDocument?.source !== "cloud") return false

    const candidates = elements.filter((element) => {
      if (element.type !== "image" || !("fileId" in element) || !element.fileId) return false
      if (getCanvasLabSourceData(element)?.storageUrl) return false

      const file = files[element.fileId]
      return Boolean(file?.dataURL)
    })

    const pendingCandidates = candidates.filter((element) => {
      const fileId = "fileId" in element ? element.fileId : null
      if (!fileId) return false

      const uploadKey = `${activeDocument.id}:${element.id}:${fileId}`
      if (nativeImageUploadKeysRef.current.has(uploadKey)) return false

      nativeImageUploadKeysRef.current.add(uploadKey)
      return true
    })

    if (pendingCandidates.length === 0) return false

    setStorageStatus({ tone: "busy", text: "正在保存插入图片..." })

    Promise.allSettled(
      pendingCandidates.map(async (element) => {
        const fileId = "fileId" in element ? element.fileId : null
        const file = fileId ? files[fileId] : null
        if (!fileId || !file?.dataURL) return null

        const blob = await dataUrlToBlob(String(file.dataURL), file.mimeType || "image/png")
        const uploadFile = new File([blob], `canvas-${fileId}.${getImageFileExtension(blob.type)}`, {
          type: blob.type || "image/png",
        })
        const upload = await createCanvasLabAssetUpload({
          canvasId: activeDocument.id,
          file: uploadFile,
          height: Math.round(element.height),
          width: Math.round(element.width),
        })

        await uploadCanvasLabAssetFile(upload, uploadFile)

        return {
          assetId: upload.asset.id,
          elementId: element.id,
          storageUrl: upload.publicUrl,
        } satisfies PersistedNativeImage
      })
    ).then((results) => {
      if (!api) return

      const persisted = results
        .filter((result): result is PromiseFulfilledResult<PersistedNativeImage> => result.status === "fulfilled" && Boolean(result.value))
        .map((result) => result.value)

      if (persisted.length === 0) {
        setStorageStatus({ tone: "error", text: "插入图片保存失败，请稍后再试。" })
        return
      }

      const persistedByElementId = new Map(persisted.map((item) => [item.elementId, item]))
      const nextElements = sanitizeCanvasLabElements(api.getSceneElements().map((element) => {
        const persistedImage = persistedByElementId.get(element.id)
        if (!persistedImage || element.type !== "image") return element

        const source: CanvasLabSourceData = {
          assetId: persistedImage.assetId,
          importedAt: new Date().toISOString(),
          projectId: persistedImage.assetId,
          sourceKey: `upload:${persistedImage.assetId}`,
          storageUrl: persistedImage.storageUrl,
          type: "upload",
        }

        return {
          ...element,
          customData: {
            ...element.customData,
            [canvasLabSourceCustomDataKey]: source,
          },
          status: "saved",
        }
      }) as readonly OrderedExcalidrawElement[])

      api.updateScene({
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        elements: nextElements,
      })
      setStorageStatus({ tone: "ok", text: "插入图片已保存" })
    }).catch(() => {
      setStorageStatus({ tone: "error", text: "插入图片保存失败，请稍后再试。" })
    })

    return true
  }, [activeDocument, api])

  const saveCurrentScene = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    if (!hydratedRef.current) return

    const sanitizedElements = sanitizeCanvasLabElements(elements)
    if (sanitizedElements.some((element, index) => element !== elements[index])) {
      api?.updateScene({
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        elements: sanitizedElements,
      })
    }

    const sanitizedAppState = sanitizeCanvasLabAppState(appState)
    const selectedReferenceCount = countSelectedImageReferences(sanitizedElements, appState.selectedElementIds ?? {}, files)
    setSelectedReferenceCount((current) => current === selectedReferenceCount ? current : selectedReferenceCount)
    const signature = buildSceneSignature(sanitizedElements, sanitizedAppState, files)

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      lastSignatureRef.current = signature
      return
    }

    if (lastSignatureRef.current === signature) return
    lastSignatureRef.current = signature

    if (persistNativeImageUploads(sanitizedElements, files)) {
      return
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    setStorageStatus({ tone: "busy", text: "正在保存..." })
    saveTimerRef.current = window.setTimeout(() => {
      const localPayload = {
        appState: sanitizedAppState,
        elements: sanitizedElements,
        files,
        title: activeDocument?.title,
      }
      const cloudPayload = {
        ...localPayload,
        files: stripCanvasLabFileData(files),
      }

      const saveOperation = activeDocument?.source === "cloud"
        ? saveCanvasLabCloudDocument(activeDocument.id, cloudPayload)
            .then((document) =>
              saveCanvasLabDocument(
                localPayload,
                document.id
              ).then(() => {
                maybeCreateAutomaticVersion(document.id)
                maybeUpdateCanvasThumbnail(document.id, sanitizedElements, sanitizedAppState, files)
                return document
              })
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
  }, [activeDocument, api, maybeCreateAutomaticVersion, maybeUpdateCanvasThumbnail, persistNativeImageUploads])

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
      const elements = sanitizeCanvasLabElements(document.elements)
      const files = await hydrateCanvasLabFiles(elements, document.files)
      await saveCanvasLabDocument(
        {
          appState: document.appState,
          elements,
          files,
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
      api?.updateScene({
        appState: {
          ...(emptyInitialData.appState as Pick<AppState, "gridSize" | "scrollX" | "scrollY" | "viewBackgroundColor" | "zoom">),
          ...document.appState,
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        elements,
      })
      api?.addFiles(Object.values(files))
      api?.history.clear()
      setInitialData({
        appState: document.appState,
        elements,
        files,
      })
      setStorageStatus({ tone: "ok", text: "已恢复历史版本" })
    } catch (error) {
      setStorageStatus({ tone: "error", text: getErrorMessage(error, "处理画布版本失败。") })
    }
  }, [activeDocument, api])

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
        api.updateScene({
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          elements: sanitizeCanvasLabElements([...api.getSceneElements(), ...elements]),
        })
        api.addFiles([filePayload.file])
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
      event.preventDefault()
      const files = Array.from(event.dataTransfer.files ?? []).filter((file) => file.type.startsWith("image/"))
      if (files.length === 0) {
        if (event.dataTransfer.types.length > 0) {
          setStorageStatus({ tone: "idle", text: "画布仅支持拖入本地图片文件" })
        }
        return
      }

      for (const file of files) {
        await handleUploadFile(file)
      }
    },
    [handleUploadFile]
  )

  const handleCanvasLinkOpen = useCallback((element: ExcalidrawElement, event: CustomEvent) => {
    if (!shouldSuppressCanvasLabLink(element)) return

    event.preventDefault()
    setStorageStatus({ tone: "idle", text: "画布图片已选中" })
  }, [])

  const getCanvasGenerationContext = useCallback(() => {
    if (!api) {
      return {
        prompt: "",
        selectedImageElements: [] as OrderedExcalidrawElement[],
        selectedElements: [] as readonly OrderedExcalidrawElement[],
      }
    }
    const selectedElementIds = api.getAppState().selectedElementIds ?? {}
    const selectedElements = api.getSceneElements().filter((element) => selectedElementIds[element.id])
    const selectedPrompt = selectedElements
      .filter((element) => element.type === "text")
      .map((element) => ("text" in element ? String(element.text ?? "") : ""))
      .filter(Boolean)
      .join("\n")
    const selectedImageElements = getSelectedImageReferenceElements(selectedElements, api.getFiles())

    return {
      prompt: selectedPrompt,
      selectedImageElements,
      selectedElements,
    }
  }, [api])

  const openCanvasStudio = useCallback(() => {
    const context = getCanvasGenerationContext()
    setStudioPrompt((current) => current || context.prompt)
    setStudioError("")
    setStudioOpen(true)
  }, [getCanvasGenerationContext])

  const addSelectedImagesToStudio = useCallback(async () => {
    if (!api || renderingReferences) return

    const context = getCanvasGenerationContext()
    if (context.selectedImageElements.length === 0) {
      setStudioStatus("当前没有选中可添加的图片")
      return
    }

    setRenderingReferences(true)
    setStudioError("")
    setStudioStatus("正在渲染选区参考图...")
    setStorageStatus({ tone: "busy", text: "正在渲染选区参考图..." })

    try {
      const references = await renderReferencesFromCanvasSelection({
        files: api.getFiles(),
        sceneElements: api.getSceneElements(),
        selectedImageElements: context.selectedImageElements,
      })
      if (references.length === 0) {
        setStudioStatus("当前没有选中可添加的图片")
        setStorageStatus({ tone: "idle", text: "当前没有选中可添加的图片" })
        return
      }

      setStudioReferences(references)
      if (context.prompt) setStudioPrompt(context.prompt)
      setStudioStatus(`已添加 ${references.length} 张参考图`)
      setStorageStatus({ tone: "ok", text: `已添加 ${references.length} 张参考图` })
      setStudioOpen(true)
    } catch (error) {
      const message = getErrorMessage(error, "选区参考图渲染失败。")
      setStudioError(message)
      setStudioStatus("")
      setStorageStatus({ tone: "error", text: message })
    } finally {
      setRenderingReferences(false)
    }
  }, [api, getCanvasGenerationContext, renderingReferences])

  const handleGenerateFromCanvas = useCallback(async ({
    duration,
    imageCount,
    mode,
    model,
    prompt,
    quality,
    ratio,
    references,
    referenceElementIds,
  }: CanvasStudioGenerationOptions) => {
    if (!api) return

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      setStudioError("请先描述你想生成的图片。")
      return
    }

    setStorageStatus({ tone: "busy", text: "正在创建生成任务..." })
    setStudioError("")
    setStudioStatus("正在提交生成任务...")
    setStudioGenerating(true)

    const pendingTaskId = `canvas-${activeDocument?.id ?? "local"}-${Date.now()}`

    try {
      const clientRequestId = pendingTaskId
      const referenceFiles = references
        .filter((reference) => referenceElementIds.includes(reference.elementId))
        .slice(0, 4)

      const placeholderElements = mode === "image"
        ? createCanvasTaskPlaceholderElements({
            canvasId: activeDocument?.id ?? "local",
            existingElementCount: api.getSceneElements().length,
            expectedResultCount: Number.parseInt(imageCount, 10) || 1,
            progress: 0,
            prompt: trimmedPrompt,
            taskId: pendingTaskId,
          })
        : []

      if (placeholderElements.length > 0) {
        api.updateScene({
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          elements: sanitizeCanvasLabElements([...api.getSceneElements(), ...placeholderElements]),
        })
        window.requestAnimationFrame(() => {
          api.scrollToContent(placeholderElements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.58 })
        })
      }

      const result = mode === "image"
        ? await (async () => {
            const formData = new FormData()
            formData.set("prompt", trimmedPrompt)
            formData.set("model", model)
            formData.set("quality", quality)
            formData.set("imageCount", String(Number.parseInt(imageCount, 10) || 1))
            formData.set("ratio", ratio)
            formData.set("clientRequestId", clientRequestId)
            formData.set("sourceCanvasId", activeDocument?.id ?? "")
            formData.set("sourceElementIds", JSON.stringify(referenceElementIds))

            referenceFiles.forEach((reference) => {
              formData.append("referenceImages", reference.file)
            })

            return createCanvasImageGenerationTask(formData)
          })()
        : await (async () => {
            const formData = new FormData()
            formData.set("prompt", trimmedPrompt)
            formData.set("model", model)
            formData.set("quality", quality)
            formData.set("duration", duration)
            formData.set("aspectRatio", ratio)
            formData.set("clientRequestId", clientRequestId)
            formData.set("sourceCanvasId", activeDocument?.id ?? "")
            formData.set("sourceElementIds", JSON.stringify(referenceElementIds))

            referenceFiles.forEach((reference) => {
              formData.append("referenceImages", reference.file)
            })

            return createCanvasVideoGenerationTask(formData)
          })()
      if (mode === "image" && result.taskId !== pendingTaskId) {
        const nextElements = api.getSceneElements().map((element) => updateCanvasTaskPlaceholderSource(element, pendingTaskId, result.taskId))
        api.updateScene({
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          elements: sanitizeCanvasLabElements(nextElements),
        })
      }
      setPendingCanvasTaskIds((currentTaskIds) => Array.from(new Set([...currentTaskIds, result.taskId])))
      setStorageStatus({ tone: "ok", text: mode === "image" ? "生图任务已创建" : "视频任务已创建" })
      setStudioStatus(`任务已创建：${result.taskId}`)
      onRefreshAccount()
    } catch (error) {
      const message = getErrorMessage(error, "从画布创建生成任务失败。")
      if (mode === "image") {
        const nextElements = api.getSceneElements().map((element) => markCanvasTaskPlaceholderFailed(element, pendingTaskId, message))
        api.updateScene({
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          elements: sanitizeCanvasLabElements(nextElements),
        })
      }
      setStorageStatus({ tone: "error", text: message })
      setStudioError(message)
    } finally {
      setStudioGenerating(false)
    }
  }, [activeDocument, api, onRefreshAccount])

  const syncCanvasTasks = useCallback(async (silent = false) => {
    if (!api) return

    const currentElements = api.getSceneElements()
    const taskIds = Array.from(
      new Set([
        ...pendingCanvasTaskIds,
        ...currentElements.map((element) => getCanvasLabTaskSourceData(element)?.taskId).filter((taskId): taskId is string => Boolean(taskId)),
      ])
    )
    if (taskIds.length === 0) return

    if (!silent) {
      setStorageStatus({ tone: "busy", text: "正在刷新任务状态..." })
    }

    try {
      let sceneElements: readonly OrderedExcalidrawElement[] = currentElements
      const appendedElements: OrderedExcalidrawElement[] = []
      const appendedFiles: Parameters<NonNullable<typeof api>["addFiles"]>[0] = []
      const completedTaskIds = new Set<string>()

      for (const taskId of taskIds) {
        const status = await getCanvasGenerationTaskStatus(taskId)
        const statusText = status.status === "failed" ? "生成失败" : status.status === "completed" || status.status === "partial_completed" ? "已完成" : "生成中"
        if (status.status === "failed" || status.status === "completed" || status.status === "partial_completed") {
          completedTaskIds.add(taskId)
        }

        sceneElements = sceneElements.map((element) => {
          const source = getCanvasLabTaskSourceData(element)
          if (source?.taskId !== taskId || element.type !== "text" || !("text" in element)) {
            return element
          }

          const isTitle = element.id.includes("task-title")
          const isMeta = element.id.includes("task-meta")
          if (!isTitle && !isMeta) return element

          const errorText = status.taskError || status.error || ""
          const nextText = isTitle
            ? buildTaskProgressTitle(status.progress, statusText)
            : buildTaskMetaText({
                currentText: String(element.text ?? ""),
                error: errorText,
                progress: status.progress,
                status: status.status,
              })
          if (element.text === nextText) return element

          return {
            ...element,
            text: nextText,
          }
        }) as readonly OrderedExcalidrawElement[]

        if (status.status !== "completed" && status.status !== "partial_completed") continue

        sceneElements = sceneElements.filter((element) => getCanvasLabTaskSourceData(element)?.taskId !== taskId)

        if (status.videoUrl) {
          const videoSourceKey = getProjectVideoSourceKey({
            id: taskId,
            status: "已完成",
            title: `视频结果 ${taskId.slice(0, 8)}`,
            type: "视频",
          } as ProjectItem)
          const alreadyInserted = [...sceneElements, ...appendedElements].some(
            (element) => getCanvasLabSourceData(element)?.sourceKey === videoSourceKey
          )
          if (!alreadyInserted) {
            const elements = createProjectElements(
              {
                createdAt: "刚刚",
                id: taskId,
                previewLabel: "画布生成视频",
                previewUrl: status.videoUrl,
                prompt: "从画布创建的视频任务",
                status: "已完成",
                taskId,
                title: "视频结果",
                type: "视频",
              } as ProjectItem,
              null,
              sceneElements.length + appendedElements.length,
              "video",
              status.videoUrl
            )
            appendedElements.push(...elements)
          }
        }

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
            withFrame: false,
          })
          appendedFiles.push(filePayload.file)
          appendedElements.push(...elements)
        }
      }

      api.updateScene({
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        elements: sanitizeCanvasLabElements([...sceneElements, ...appendedElements]),
      })

      if (appendedFiles.length > 0) {
        api.addFiles(appendedFiles)
      }

      if (appendedElements.length > 0) {
        window.requestAnimationFrame(() => {
          api.scrollToContent(appendedElements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.58 })
        })
      }

      if (!silent || appendedElements.length > 0) {
        setStorageStatus({ tone: "ok", text: appendedElements.length > 0 ? "生成结果已回填画布" : "任务状态已刷新" })
      }
      setPendingCanvasTaskIds((currentTaskIds) =>
        currentTaskIds.filter((taskId) => !completedTaskIds.has(taskId))
      )
    } catch (error) {
      if (!silent) {
        setStorageStatus({ tone: "error", text: getErrorMessage(error, "刷新任务状态失败。") })
      }
    }
  }, [activeDocument, api, pendingCanvasTaskIds])

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

      const targetSourceKeys = getProjectImportSourceKeys(project, imageIndex)
      const existing = api.getSceneElements().find((element) => {
        const source = getElementSourceData(element) ?? getCanvasLabSourceData(element)
        return source?.sourceKey ? targetSourceKeys.includes(source.sourceKey) : false
      })
      if (existing) {
        api.scrollToContent(existing, { animate: true, fitToViewport: true, viewportZoomFactor: 0.62 })
        setStorageStatus({
          tone: "ok",
          text: project.type === "视频" ? "视频状态卡已在画布中，已定位到对应卡片。" : "该素材已在画布中，已定位到对应卡片。",
        })
        return
      }

      setImportingKey(targetSourceKeys[0] ?? getProjectSourceKey(project))
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
                  sourceKey: getProjectImageSourceKey(project, typeof imageIndex === "number" ? imageIndex : index),
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
            createProjectElements(project, payload, api.getSceneElements().length + index * 4, String(index), imageUrls[index])
          )

          api.updateScene({
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            elements: sanitizeCanvasLabElements([...api.getSceneElements(), ...nextElements]),
          })
          api.addFiles(filePayloads.map((payload) => payload.file))
          window.requestAnimationFrame(() => {
            api.scrollToContent(nextElements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.56 })
          })
          setStorageStatus({ tone: "ok", text: imageUrls.length > 1 ? "已批量导入画布" : "已导入画布" })
        } else if (canImportProjectVideo(project)) {
          if (activeDocument?.source === "cloud") {
            await createCanvasLabAssetBinding(activeDocument.id, {
              externalUrl: getProjectPreviewUrl(project),
              sourceKey: getProjectVideoSourceKey(project),
              sourceProjectId: project.id,
              sourceTaskId: project.taskId,
              sourceType: "video",
              storageUrl: getProjectPreviewUrl(project),
            }).catch(() => undefined)
          }
          const elements = createProjectElements(project, null, api.getSceneElements().length, "video")
          api.updateScene({
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            elements: sanitizeCanvasLabElements([...api.getSceneElements(), ...elements]),
          })
          window.requestAnimationFrame(() => {
            api.scrollToContent(elements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.56 })
          })
          setStorageStatus({ tone: "ok", text: "视频状态卡已导入画布" })
        } else {
          if (activeDocument?.source === "cloud") {
            await createCanvasLabAssetBinding(activeDocument.id, {
              sourceKey: getProjectStatusSourceKey(project),
              sourceProjectId: project.id,
              sourceTaskId: project.taskId,
              sourceType: "status",
            }).catch(() => undefined)
          }
          const elements = createProjectElements(project, null, api.getSceneElements().length, "status")
          api.updateScene({
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            elements: sanitizeCanvasLabElements([...api.getSceneElements(), ...elements]),
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
          <Button
            className={cn(
              "h-9 rounded-full text-slate-300 hover:bg-slate-900 hover:text-white",
              studioOpen && "bg-slate-900 text-white"
            )}
            onClick={openCanvasStudio}
            type="button"
            variant="ghost"
          >
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">对话</span>
          </Button>
          {selectedReferenceCount > 0 && (
            <Button
              className="h-9 rounded-full border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20 hover:text-white"
              disabled={renderingReferences}
              onClick={addSelectedImagesToStudio}
              type="button"
              variant="outline"
            >
              {renderingReferences ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              <span className="hidden sm:inline">{renderingReferences ? "渲染中" : "添加到对话"}</span>
              <Badge className="ml-0.5 border-cyan-300/30 bg-cyan-300/15 px-1.5 text-[10px] text-cyan-100" variant="outline">
                {selectedReferenceCount}
              </Badge>
            </Button>
          )}
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
                image: false,
              },
            }}
            aiEnabled={false}
            autoFocus
            excalidrawAPI={setApi}
            initialData={initialData}
            langCode="zh-CN"
            name="季风无限画布"
            onChange={saveCurrentScene}
            onLinkOpen={handleCanvasLinkOpen}
            theme={THEME.DARK}
          >
            <MainMenu>
              <MainMenu.DefaultItems.SaveToActiveFile />
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.DefaultItems.Help />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
          </Excalidraw>
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
        {studioOpen && (
          <CanvasStudioPanel
            error={studioError}
            generating={studioGenerating}
            initialPrompt={studioPrompt}
            modelConfigs={modelConfigs}
            modelOptionsReady={modelOptionsReady}
            modelPricing={modelPricing}
            references={studioReferences}
            status={studioStatus}
            onClose={() => setStudioOpen(false)}
            onGenerate={(options) => {
              setStudioPrompt(options.prompt)
              void handleGenerateFromCanvas(options)
            }}
            onRefreshSelection={() => {
              void addSelectedImagesToStudio()
            }}
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

function CanvasStudioPanel({
  error,
  generating,
  initialPrompt,
  modelConfigs,
  modelOptionsReady,
  modelPricing,
  onClose,
  onGenerate,
  onRefreshSelection,
  references,
  status,
}: {
  error: string
  generating: boolean
  initialPrompt: string
  modelConfigs: ModelConfig[]
  modelOptionsReady: boolean
  modelPricing: PublicModelPricing[]
  onClose: () => void
  onGenerate: (options: CanvasStudioGenerationOptions) => void
  onRefreshSelection: () => void
  references: CanvasStudioReference[]
  status: string
}) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [mode, setMode] = useState<"image" | "video">("image")
  const availableImageModels = getAvailableModelConfigs("image", modelConfigs, modelPricing)
  const availableVideoModels = getAvailableModelConfigs("video", modelConfigs, modelPricing)
  const activeAvailableModels = mode === "image" ? availableImageModels : availableVideoModels
  const defaultImageModel = getDefaultModel("image", availableImageModels)
  const defaultVideoModel = getDefaultModel("video", availableVideoModels)
  const [model, setModel] = useState(defaultImageModel)
  const imageSettings = imageModelSettings[model] ?? imageModelSettings[defaultImageModel] ?? imageModelSettings[yunwuGeminiImageModelName]
  const videoSettings = videoModelSettings[model] ?? videoModelSettings[defaultVideoModel] ?? videoModelSettings[yunwuVeo31FastVideoModelName]
  const availableImageQualities = getAvailableQualities(modelPricing, "image", model)
  const availableVideoVariants = getAvailableVideoVariants(modelPricing, model)
  const [quality, setQuality] = useState(getPreferredImageQuality(defaultImageModel, getAvailableQualities(modelPricing, "image", defaultImageModel)))
  const [ratio, setRatio] = useState(imageSettings.ratios[0])
  const [duration, setDuration] = useState(getPreferredVideoDuration(defaultVideoModel, getAvailableVideoVariants(modelPricing, defaultVideoModel)))
  const [imageCount, setImageCount] = useState("3")
  const qualityOptions = mode === "image" ? availableImageQualities : availableVideoVariants.qualities
  const isApimartImage = mode === "image" && isApimartImageModel(model)
  const imageRatioOptions = mode === "image" ? getImageRatiosForSelection(model, quality) : imageSettings.ratios
  const effectiveImageCount = isApimartImage ? "1" : imageCount
  const currentPricing = findModelPricing(modelPricing, {
    duration,
    model,
    quality,
    type: mode,
  })
  const canGenerate = modelOptionsReady && activeAvailableModels.length > 0 && Boolean(currentPricing)
  const referenceElementIds = references.map((reference) => reference.elementId)

  useEffect(() => {
    setPrompt(initialPrompt)
  }, [initialPrompt])

  useEffect(() => {
    const availableModels = mode === "image" ? availableImageModels : availableVideoModels
    const defaultModel = mode === "image" ? defaultImageModel : defaultVideoModel
    if (!availableModels.some((item) => item.model === model)) {
      setModel(defaultModel)
    }
  }, [availableImageModels, availableVideoModels, defaultImageModel, defaultVideoModel, mode, model])

  useEffect(() => {
    const nextQuality = mode === "image"
      ? getPreferredImageQuality(model, availableImageQualities)
      : getPreferredVideoQuality(model, availableVideoVariants)
    if (!qualityOptions.includes(quality)) {
      setQuality(nextQuality)
    }
    if (mode === "image" && !imageRatioOptions.includes(ratio)) {
      setRatio(imageRatioOptions[0])
    }
    if (mode === "video" && !videoSettings.aspectRatios.includes(ratio)) {
      setRatio(videoSettings.aspectRatios[0])
    }
    if (mode === "video" && !availableVideoVariants.durations.includes(duration)) {
      setDuration(getPreferredVideoDuration(model, availableVideoVariants))
    }
    if (isApimartImage && imageCount !== "1") {
      setImageCount("1")
    }
  }, [availableImageQualities, availableVideoVariants, duration, imageCount, imageRatioOptions, isApimartImage, mode, model, quality, qualityOptions, ratio, videoSettings.aspectRatios])

  const handleModeChange = (nextMode: "image" | "video") => {
    setMode(nextMode)
    if (nextMode === "image") {
      const nextModel = defaultImageModel
      const nextSettings = imageModelSettings[nextModel] ?? imageModelSettings[yunwuGeminiImageModelName]
      const nextQuality = getPreferredImageQuality(nextModel, getAvailableQualities(modelPricing, "image", nextModel))
      setModel(nextModel)
      setQuality(nextQuality)
      setRatio(nextSettings.ratios[0])
      return
    }

    const nextModel = defaultVideoModel
    const nextSettings = videoModelSettings[nextModel] ?? videoModelSettings[yunwuVeo31FastVideoModelName]
    const nextVariants = getAvailableVideoVariants(modelPricing, nextModel)
    setModel(nextModel)
    setQuality(getPreferredVideoQuality(nextModel, nextVariants))
    setRatio(nextSettings.aspectRatios[0])
    setDuration(getPreferredVideoDuration(nextModel, nextVariants))
  }

  const handleModelChange = (value: string) => {
    setModel(value)
    if (mode === "image") {
      const nextQuality = getPreferredImageQuality(value, getAvailableQualities(modelPricing, "image", value))
      setQuality(nextQuality)
      setRatio(getImageRatiosForSelection(value, nextQuality)[0])
      if (isApimartImageModel(value)) {
        setImageCount("1")
      }
      return
    }

    const nextSettings = videoModelSettings[value] ?? videoModelSettings[yunwuVeo31FastVideoModelName]
    const nextVariants = getAvailableVideoVariants(modelPricing, value)
    setQuality(getPreferredVideoQuality(value, nextVariants))
    setRatio(nextSettings.aspectRatios[0])
    setDuration(getPreferredVideoDuration(value, nextVariants))
  }

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-white text-slate-950 shadow-2xl lg:bottom-5 lg:left-auto lg:right-5 lg:top-20 lg:w-[520px] lg:rounded-lg lg:border lg:border-slate-200">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 px-5">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">创作台</h2>
          <p className="text-xs text-slate-500">基于当前画布继续生成</p>
        </div>
        <div className="flex items-center gap-1">
          <Button className="h-9 rounded-full text-slate-600 hover:bg-slate-100" onClick={onRefreshSelection} type="button" variant="ghost">
            <RefreshCcw className="h-4 w-4" />
            <span className="hidden sm:inline">添加选区</span>
          </Button>
          <Button className="h-9 w-9 rounded-full text-slate-600 hover:bg-slate-100" onClick={onClose} size="icon" type="button" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-5 p-5">
          {references.length > 0 && (
            <div className="grid grid-cols-4 gap-1 overflow-hidden rounded-md bg-slate-100 p-1">
              {references.map((reference) => (
                <img
                  alt="画布参考图"
                  className="aspect-square min-w-0 rounded object-cover"
                  key={`${reference.elementId}-${reference.id}`}
                  src={reference.previewUrl}
                />
              ))}
            </div>
          )}
          <div>
            <textarea
              className="min-h-40 w-full resize-none rounded-lg border border-slate-200 bg-white p-4 text-lg leading-8 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述你想生成的图片，例如：现代极简客餐厅，浅木色地板，隐藏灯带，适合小户型。"
              value={prompt}
            />
            {error && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            {status && !error && (
              <div className="mt-3 rounded-md border border-cyan-100 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
                {status}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-slate-100 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <CanvasStudioSelect
            icon={mode === "image" ? ImageIcon : Film}
            label={mode === "image" ? "图片生成" : "视频生成"}
            onChange={(value) => handleModeChange(value as "image" | "video")}
            options={[
              { label: "图片生成", value: "image" },
              { label: "视频生成", value: "video" },
            ]}
            value={mode}
          />
          <CanvasStudioSelect
            icon={Box}
            label={mode === "image" ? "生图模型" : "视频模型"}
            onChange={handleModelChange}
            options={activeAvailableModels.map((option) => ({
              label: option.display_name,
              value: option.model,
            }))}
            value={model}
          />
          <CanvasStudioSelect
            icon={Sparkles}
            label={mode === "image" ? "图片清晰度" : "视频清晰度"}
            onChange={setQuality}
            options={qualityOptions.map((option) => ({ label: option, value: option }))}
            value={quality}
          />
          <CanvasStudioSelect
            icon={RectangleHorizontal}
            label={mode === "image" ? "图片比例" : "视频比例"}
            onChange={setRatio}
            options={(mode === "image" ? imageRatioOptions : videoSettings.aspectRatios).map((option) => ({ label: option, value: option }))}
            value={ratio}
          />
          {mode === "image" ? (
            <CanvasStudioSelect
              icon={ImageIcon}
              label="生成张数"
              onChange={isApimartImage ? () => undefined : setImageCount}
              options={(isApimartImage ? ["1"] : ["1", "2", "3", "4"]).map((option) => ({ label: `${option} 张`, value: option }))}
              value={effectiveImageCount}
            />
          ) : (
            <CanvasStudioSelect
              icon={Film}
              label="视频时长"
              onChange={setDuration}
              options={availableVideoVariants.durations.map((option) => ({ label: option, value: option }))}
              value={duration}
            />
          )}
        </div>
        <Button
          className="h-12 w-full rounded-full bg-slate-950 text-base font-semibold text-white hover:bg-slate-800"
          disabled={generating || !canGenerate}
          onClick={() => onGenerate({ duration, imageCount: effectiveImageCount, mode, model, prompt, quality, ratio, references, referenceElementIds })}
          type="button"
        >
          {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          {generating ? "生成中..." : !modelOptionsReady ? "加载模型中..." : `生成${mode === "image" ? "图片" : "视频"}`}
        </Button>
      </div>
    </aside>
  )
}

function CanvasStudioSelect({
  icon: Icon,
  label,
  onChange,
  options,
  value,
}: {
  icon: typeof Box
  label: string
  onChange: (value: string) => void
  options: { label: string; value: string }[]
  value: string
}) {
  return (
    <label className="inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm">
      <Icon className="h-4 w-4 shrink-0 text-slate-600" />
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="min-w-0 max-w-48 bg-transparent font-medium outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function getSelectedImageReferenceElements(elements: readonly OrderedExcalidrawElement[], files: BinaryFiles) {
  return elements
    .filter((element) => element.type === "image" && "fileId" in element && element.fileId)
    .slice(0, 4)
    .filter((element) => {
      const fileId = "fileId" in element ? element.fileId : null
      return Boolean(fileId && files[fileId]?.dataURL)
    })
}

async function renderReferencesFromCanvasSelection({
  files,
  sceneElements,
  selectedImageElements,
}: {
  files: BinaryFiles
  sceneElements: readonly OrderedExcalidrawElement[]
  selectedImageElements: readonly OrderedExcalidrawElement[]
}) {
  const visibleSceneElements = sceneElements.filter((element) => !element.isDeleted)

  return Promise.all(
    selectedImageElements.map(async (imageElement, index) => {
      const fileId = "fileId" in imageElement ? imageElement.fileId : null
      const fileData = fileId ? files[fileId] : null
      if (!fileId || !fileData?.dataURL) return null

      const renderElements = visibleSceneElements.filter((element) => {
        if (element.id === imageElement.id) return true
        if (element.type === "image") return false
        return elementsOverlap(imageElement, element)
      })

      const blob = await exportToBlob({
        appState: {
          exportBackground: false,
          exportWithDarkMode: true,
          viewBackgroundColor: "transparent",
        },
        elements: renderElements,
        exportPadding: 0,
        files,
        maxWidthOrHeight: 1600,
        mimeType: "image/webp",
        quality: 0.92,
      })
      const file = new File([blob], `canvas-reference-${index + 1}.webp`, {
        type: blob.type || "image/webp",
      })
      const previewUrl = URL.createObjectURL(file)

      return {
        elementId: imageElement.id,
        id: `${imageElement.id}-${Date.now().toString(36)}-${index}`,
        file,
        previewUrl,
      }
    })
  ).then((references) => references.filter((item): item is CanvasStudioReference => item !== null))
}

function elementsOverlap(first: OrderedExcalidrawElement, second: OrderedExcalidrawElement) {
  const firstBounds = getElementBounds(first)
  const secondBounds = getElementBounds(second)

  return (
    firstBounds.left < secondBounds.right &&
    firstBounds.right > secondBounds.left &&
    firstBounds.top < secondBounds.bottom &&
    firstBounds.bottom > secondBounds.top
  )
}

function getElementBounds(element: OrderedExcalidrawElement) {
  const left = Math.min(element.x, element.x + element.width)
  const right = Math.max(element.x, element.x + element.width)
  const top = Math.min(element.y, element.y + element.height)
  const bottom = Math.max(element.y, element.y + element.height)

  return { bottom, left, right, top }
}

function revokeCanvasReferencePreviewUrl(previewUrl: string) {
  if (previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(previewUrl)
  }
}

function countSelectedImageReferences(
  elements: readonly OrderedExcalidrawElement[],
  selectedElementIds: AppState["selectedElementIds"],
  files: BinaryFiles
) {
  return elements.reduce((count, element) => {
    if (!selectedElementIds[element.id]) return count
    if (element.type !== "image" || !("fileId" in element) || !element.fileId) return count

    return files[element.fileId]?.dataURL ? count + 1 : count
  }, 0)
}

function getProjectImportSourceKeys(project: ProjectItem, imageIndex?: number) {
  if (canImportProjectImage(project)) {
    if (typeof imageIndex === "number") return [getProjectImageSourceKey(project, imageIndex)]
    return getProjectImageUrls(project).map((_, index) => getProjectImageSourceKey(project, index))
  }

  if (canImportProjectVideo(project)) return [getProjectVideoSourceKey(project)]

  return [getProjectStatusSourceKey(project)]
}

function buildTaskProgressTitle(progress: number, fallback: string) {
  const normalizedProgress = Number.isFinite(progress) ? Math.round(progress) : 0
  if (normalizedProgress >= 100) return fallback

  return `${Math.min(99, Math.max(0, normalizedProgress))}%造梦中`
}

function buildTaskMetaText({
  currentText,
  error,
  progress,
  status,
}: {
  currentText: string
  error: string
  progress: number
  status: string
}) {
  const baseText = currentText
    .split("\n")
    .filter((line) => !line.startsWith("状态：") && !line.startsWith("进度：") && !line.startsWith("说明："))
    .join("\n")
  const statusLine = status === "partial_completed" ? "状态：部分完成" : status === "failed" ? "状态：生成失败" : "状态：生成中"
  const progressLine = status === "submitted" || status === "processing" ? `进度：${buildTaskProgressTitle(progress, "生成中")}` : ""
  const errorLine = error ? `说明：${error}` : ""

  return [baseText, statusLine, progressLine, errorLine].filter(Boolean).join("\n").slice(0, 360)
}

function updateCanvasTaskPlaceholderSource(element: OrderedExcalidrawElement, pendingTaskId: string, taskId: string) {
  const source = getCanvasLabTaskSourceData(element)
  if (source?.taskId !== pendingTaskId) return element

  const nextSource: CanvasLabSourceData = {
    ...source,
    sourceKey: `task:${taskId}`,
    taskId,
  }
  const nextElement = {
    ...element,
    customData: {
      ...element.customData,
      [canvasLabSourceCustomDataKey]: nextSource,
    },
  }

  if (element.type !== "text" || !("text" in element)) return nextElement

  return {
    ...nextElement,
    text: String(element.text ?? "").replaceAll(pendingTaskId, taskId),
  }
}

function markCanvasTaskPlaceholderFailed(element: OrderedExcalidrawElement, pendingTaskId: string, message: string) {
  const source = getCanvasLabTaskSourceData(element)
  if (source?.taskId !== pendingTaskId || element.type !== "text" || !("text" in element)) return element

  const isTitle = element.id.includes("task-title")
  const isMeta = element.id.includes("task-meta")
  if (!isTitle && !isMeta) return element

  return {
    ...element,
    strokeColor: isTitle ? "#be123c" : "#9f1239",
    text: isTitle ? "生成失败" : buildTaskMetaText({
      currentText: String(element.text ?? ""),
      error: message,
      progress: 100,
      status: "failed",
    }),
  }
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
                importing={getProjectImportSourceKeys(project).includes(importingKey)}
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
        {project.type === "视频" ? (
          previewUrl ? (
            <video className="h-full w-full object-cover" controls playsInline preload="metadata" src={previewUrl} />
          ) : (
            <div className="grid h-full w-full place-items-center bg-slate-950 text-slate-400">
              <Film className="h-8 w-8" />
            </div>
          )
        ) : previewUrl ? (
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
        {project.type === "视频" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-b from-transparent via-transparent to-black/10">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-slate-950/75 text-white shadow-lg">
              <Play className="ml-0.5 h-5 w-5 fill-current" />
            </div>
          </div>
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

async function dataUrlToBlob(dataUrl: string, mimeType: string) {
  const response = await fetch(dataUrl)
  const blob = await response.blob()

  return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: mimeType || "image/png" })
}

function getImageFileExtension(mimeType: string) {
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/gif") return "gif"
  if (mimeType === "image/avif") return "avif"

  return "png"
}

async function hydrateCanvasLabFiles(elements: readonly ExcalidrawElement[], files: BinaryFiles) {
  const nextFiles: BinaryFiles = { ...files }
  const imageElements = elements.filter((element) => element.type === "image" && "fileId" in element && element.fileId)

  await Promise.allSettled(
    imageElements.map(async (element) => {
      const fileId = "fileId" in element ? element.fileId : null
      if (!fileId || nextFiles[fileId]?.dataURL) return

      const source = getCanvasLabSourceData(element)
      if (!source?.storageUrl) return

      const file = nextFiles[fileId]
      try {
        const hydrated = await downloadCanvasLabImageAsDataUrl(source.storageUrl)
        nextFiles[fileId] = {
          created: file?.created ?? Date.now(),
          dataURL: hydrated.dataURL,
          id: fileId,
          lastRetrieved: Date.now(),
          mimeType: file?.mimeType || hydrated.mimeType,
        }
      } catch {
        nextFiles[fileId] = {
          created: file?.created ?? Date.now(),
          dataURL: createExpiredResourcePlaceholderDataUrl(source),
          id: fileId,
          lastRetrieved: Date.now(),
          mimeType: "image/svg+xml",
        }
      }
    })
  )

  return nextFiles
}

function createExpiredResourcePlaceholderDataUrl(source: ReturnType<typeof getCanvasLabSourceData>) {
  const title = source?.type === "task" ? "生成结果已失效" : "画布资源已失效"
  const detail = [source?.taskId ? `任务 ${source.taskId}` : "", source?.sourceKey ?? ""].filter(Boolean).join(" · ")
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">',
    '<rect width="640" height="420" rx="24" fill="#0f172a"/>',
    '<rect x="28" y="28" width="584" height="364" rx="18" fill="#111827" stroke="#334155" stroke-width="2" stroke-dasharray="12 10"/>',
    `<text x="320" y="186" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="30" font-weight="700" text-anchor="middle">${escapeSvgText(title)}</text>`,
    `<text x="320" y="232" fill="#94a3b8" font-family="Arial, sans-serif" font-size="18" text-anchor="middle">${escapeSvgText(detail || "元数据已保留，可重新导入或刷新任务")}</text>`,
    '</svg>',
  ].join("")

  return `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(svg)))}` as BinaryFiles[string]["dataURL"]
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function createCanvasThumbnailBlob(
  elements: readonly OrderedExcalidrawElement[],
  appState: CanvasLabCloudDocument["appState"],
  files: BinaryFiles
) {
  const visibleElements = elements.filter((element) => !element.isDeleted)
  if (visibleElements.length === 0) return null

  return exportToBlob({
    appState: {
      exportBackground: true,
      viewBackgroundColor: appState.viewBackgroundColor ?? "#020617",
    },
    elements: visibleElements,
    exportPadding: 24,
    files,
    maxWidthOrHeight: 640,
    mimeType: "image/webp",
    quality: 0.76,
  })
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
    const elements = sanitizeCanvasLabElements(cloudDocument.elements)
    const files = await hydrateCanvasLabFiles(elements, cloudDocument.files)

    await saveCanvasLabDocument(
      {
        appState: cloudDocument.appState,
        elements,
        files,
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
      document: {
        ...cloudDocument,
        elements,
        files,
      },
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
          elements: sanitizeCanvasLabElements(localDocument.elements),
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
