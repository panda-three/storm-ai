import { convertToExcalidrawElements } from "@excalidraw/excalidraw"
import type { BinaryFileData } from "@excalidraw/excalidraw/types"
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform"
import {
  canvasLabSourceCustomDataKey,
  createCanvasLabId,
  type CanvasLabSourceData,
} from "@/lib/canvas-lab-scene"
import { isDeletedProjectItem, sortProjectHistory, type ProjectItem } from "@/lib/project-history"

const generatedImagePathPrefixes = [
  "/supabase/storage/v1/object/public/generated-images/",
  "/storage/v1/object/public/generated-images/",
]

export function getProjectSourceKey(project: ProjectItem) {
  return project.taskId || project.clientRequestId || project.upstreamTaskId || project.id
}

export function getProjectPreviewUrl(project: ProjectItem) {
  return project.previewUrl || project.imageUrls?.[0] || ""
}

export function getProjectImageUrls(project: ProjectItem) {
  return (project.imageUrls ?? []).filter((url): url is string => Boolean(url))
}

export function getProjectDownloadUrl(project: ProjectItem) {
  const previewUrl = getProjectPreviewUrl(project)
  if (!previewUrl) return ""

  if (isGeneratedImageStoragePath(previewUrl)) {
    return new URL(previewUrl, getConfiguredSupabaseUrl()).toString()
  }

  try {
    return new URL(previewUrl, getCurrentOrigin()).toString()
  } catch {
    return previewUrl
  }
}

export function getProjectImportTargets(project: ProjectItem) {
  if (project.type === "生图") {
    const imageUrls = getProjectImageUrls(project)
    if (imageUrls.length > 0) {
      return imageUrls.map((url, index) => ({
        kind: "image" as const,
        filename: buildProjectImportFilename(project, index),
        index,
        sourceUrl: url,
      }))
    }
  }

  if (project.type === "视频" && getProjectPreviewUrl(project)) {
    return [
      {
        kind: "video" as const,
        filename: buildProjectImportFilename(project, 0, "mp4"),
        index: 0,
        sourceUrl: getProjectPreviewUrl(project),
      },
    ]
  }

  return []
}

export function getCanvasLabProjects(projects: ProjectItem[]) {
  return sortProjectHistory(projects)
    .filter((project) => !isDeletedProjectItem(project))
    .slice(0, 36)
}

export function getProjectImportFilename(project: ProjectItem) {
  return buildProjectImportFilename(project, 0)
}

export function buildProjectImportFilename(project: ProjectItem, index: number, extension = "png") {
  const sourceKey = getProjectSourceKey(project)
  const title = project.title?.trim() || sourceKey || "canvas-image"
  const suffix = index > 0 ? `-${String(index + 1).padStart(2, "0")}` : ""
  const baseName = `${title}${suffix}`

  return `${baseName.replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 48) || "canvas-image"}.${extension}`
}

export function getProjectSourceData(project: ProjectItem): CanvasLabSourceData {
  return {
    importedAt: new Date().toISOString(),
    projectId: project.id,
    sourceKey: getProjectSourceKey(project),
    taskId: project.taskId,
    type: "project",
    upstreamTaskId: project.upstreamTaskId,
  }
}

export async function downloadProjectFile(project: ProjectItem) {
  const downloadUrl = getProjectDownloadUrl(project)
  if (!downloadUrl) return null

  const response = await downloadProjectResource(downloadUrl, getProjectImportFilename(project))
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

export async function downloadProjectResource(downloadUrl: string, filename: string) {
  return fetch(`/api/download?url=${encodeURIComponent(downloadUrl)}&filename=${encodeURIComponent(filename)}`)
}

export async function downloadCanvasImageUrl(sourceUrl: string, sourceKey: string, filename = "canvas-result.png") {
  const response = await downloadProjectResource(sourceUrl, filename)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(getPayloadErrorMessage(payload, `图片下载失败：HTTP ${response.status}。`))
  }

  const blob = await response.blob()
  if (!blob.type.startsWith("image/")) {
    throw new Error("画布仅支持导入图片资源。")
  }

  return createCanvasBinaryImageFile(blob, sourceKey)
}

export async function downloadProjectImage(project: ProjectItem, sourceUrl: string, index = 0) {
  const response = await downloadProjectResource(sourceUrl, buildProjectImportFilename(project, index))
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
  const sourceKey = `${getProjectSourceKey(project)}:${index}`
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

export async function createCanvasBinaryImageFile(blob: Blob, sourceKey: string) {
  const dataURL = await blobToDataURL(blob)
  const size = await getImageSize(blob).catch(() => ({ width: 320, height: 220 }))
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

export function createProjectElements(
  project: ProjectItem,
  filePayload: Awaited<ReturnType<typeof downloadProjectFile>>,
  existingElementCount: number,
  variantKey = "",
  storageUrl = ""
) {
  const source = getProjectSourceData(project)
  if (storageUrl) {
    source.storageUrl = storageUrl
  }
  const sourceKey = variantKey ? `${getProjectSourceKey(project)}:${variantKey}` : getProjectSourceKey(project)
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

export function createCanvasUploadElements({
  assetId,
  existingElementCount,
  filePayload,
  storageUrl,
  title,
}: {
  assetId: string
  existingElementCount: number
  filePayload: Awaited<ReturnType<typeof createCanvasBinaryImageFile>>
  storageUrl: string
  title: string
}) {
  const source: CanvasLabSourceData = {
    assetId,
    importedAt: new Date().toISOString(),
    projectId: assetId,
    sourceKey: `upload:${assetId}`,
    storageUrl,
    type: "upload",
  }
  const sourceKey = source.sourceKey
  const x = 80 + (existingElementCount % 6) * 36
  const y = 80 + (existingElementCount % 5) * 32
  const cardWidth = 380
  const imageWidth = Math.min(330, Math.max(220, filePayload.width))
  const imageHeight = Math.min(260, Math.max(160, Math.round((imageWidth / filePayload.width) * filePayload.height)))
  const cardHeight = imageHeight + 112
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
    {
      customData: buildElementCustomData(source),
      fileId: filePayload.file.id,
      height: imageHeight,
      id: createCanvasLabId("image", sourceKey),
      type: "image",
      width: imageWidth,
      x: x + 24,
      y: y + 24,
    },
    {
      customData: buildElementCustomData(source),
      fontSize: 20,
      height: 28,
      id: createCanvasLabId("title", sourceKey),
      strokeColor: "#f8fafc",
      text: title || "上传图片",
      type: "text",
      width: cardWidth - 48,
      x: x + 24,
      y: y + imageHeight + 40,
    },
    {
      customData: buildElementCustomData(source),
      fontSize: 14,
      height: 48,
      id: createCanvasLabId("meta", sourceKey),
      strokeColor: "#94a3b8",
      text: "本地上传 · 已保存到素材库",
      type: "text",
      width: cardWidth - 48,
      x: x + 24,
      y: y + imageHeight + 74,
    },
  ]

  return convertToExcalidrawElements(skeletons, { regenerateIds: false }) as OrderedExcalidrawElement[]
}

export function createCanvasTaskPlaceholderElements({
  canvasId,
  existingElementCount,
  prompt,
  taskId,
}: {
  canvasId: string
  existingElementCount: number
  prompt: string
  taskId: string
}) {
  const source: CanvasLabSourceData = {
    importedAt: new Date().toISOString(),
    projectId: canvasId,
    sourceKey: `task:${taskId}`,
    taskId,
    type: "task",
  }
  const x = 120 + (existingElementCount % 6) * 36
  const y = 120 + (existingElementCount % 5) * 32
  const cardWidth = 360
  const skeletons: ExcalidrawElementSkeleton[] = [
    {
      backgroundColor: "#082f49",
      customData: buildElementCustomData(source),
      fillStyle: "solid",
      height: 180,
      id: createCanvasLabId("task-card", taskId),
      roughness: 0,
      strokeColor: "#38bdf8",
      type: "rectangle",
      width: cardWidth,
      x,
      y,
    },
    {
      customData: buildElementCustomData(source),
      fontSize: 20,
      height: 28,
      id: createCanvasLabId("task-title", taskId),
      strokeColor: "#e0f2fe",
      text: "生成中",
      type: "text",
      width: cardWidth - 48,
      x: x + 24,
      y: y + 28,
    },
    {
      customData: buildElementCustomData(source),
      fontSize: 14,
      height: 72,
      id: createCanvasLabId("task-meta", taskId),
      strokeColor: "#bae6fd",
      text: [`任务：${taskId}`, prompt].filter(Boolean).join("\n").slice(0, 240),
      type: "text",
      width: cardWidth - 48,
      x: x + 24,
      y: y + 68,
    },
  ]

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

function getPayloadErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: unknown }).error
    if (typeof error === "string" && error) return error
  }

  if (payload instanceof Error && payload.message) return payload.message
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const message = (payload as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }

  return fallback
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

function isGeneratedImageStoragePath(value: string) {
  return generatedImagePathPrefixes.some((prefix) => value.startsWith(prefix))
}

function getConfiguredSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || getCurrentOrigin()
}

function getCurrentOrigin() {
  if (typeof window === "undefined") return "https://www.zlaction.online"
  return window.location.origin
}
