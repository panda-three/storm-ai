import type { AppState, BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import { getSupabaseClient } from "@/lib/supabase"

export interface CanvasLabDocumentListItem {
  assetCount: number
  id: string
  thumbnailUrl: string | null
  title: string
  updatedAt: string
}

export interface CanvasLabCloudDocument extends CanvasLabDocumentListItem {
  appState: Partial<Pick<AppState, "gridSize" | "scrollX" | "scrollY" | "viewBackgroundColor" | "zoom">>
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
}

export interface CanvasLabAssetUpload {
  asset: {
    canvasId: string
    createdAt: string
    fileSize: number
    height: number | null
    id: string
    metadata: Record<string, unknown>
    mimeType: string
    storageUrl: string
    width: number | null
  }
  bucket: string
  path: string
  publicUrl: string
  token: string
}

export interface CanvasLabThumbnailUpload {
  bucket: string
  path: string
  publicUrl: string
  token: string
}

export interface CanvasLabVersionSummary {
  createdAt: string
  id: string
  reason: string
}

export interface CanvasLabAssetBindingPayload {
  externalUrl?: string
  height?: number
  mimeType?: string
  sourceKey?: string
  sourceProjectId?: string
  sourceTaskId?: string
  sourceType?: string
  storageUrl?: string
  width?: number
}

interface CanvasDocumentPayload {
  appState?: CanvasLabCloudDocument["appState"]
  elements?: readonly ExcalidrawElement[]
  files?: BinaryFiles
  thumbnailUrl?: string | null
  title?: string
}

export async function listCanvasLabCloudDocuments() {
  const payload = await requestCanvasLabApi<{ documents?: CanvasLabDocumentListItem[] }>("/api/canvas-documents")
  return payload.documents ?? []
}

export async function createCanvasLabCloudDocument(title?: string) {
  return requestCanvasLabApi<{ document: CanvasLabCloudDocument }>("/api/canvas-documents", {
    body: JSON.stringify({ title }),
    method: "POST",
  }).then((payload) => payload.document)
}

export async function getCanvasLabCloudDocument(id: string) {
  return requestCanvasLabApi<{ document: CanvasLabCloudDocument }>(`/api/canvas-documents/${encodeURIComponent(id)}`)
    .then((payload) => payload.document)
}

export async function saveCanvasLabCloudDocument(id: string, payload: CanvasDocumentPayload) {
  return requestCanvasLabApi<{ document: CanvasLabCloudDocument }>(`/api/canvas-documents/${encodeURIComponent(id)}`, {
    body: JSON.stringify(payload),
    method: "PATCH",
  }).then((response) => response.document)
}

export async function deleteCanvasLabCloudDocument(id: string) {
  await requestCanvasLabApi(`/api/canvas-documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function createCanvasLabAssetUpload({
  canvasId,
  file,
  height,
  width,
}: {
  canvasId: string
  file: File
  height?: number
  width?: number
}) {
  return requestCanvasLabApi<{ upload: CanvasLabAssetUpload }>(`/api/canvas-documents/${encodeURIComponent(canvasId)}/uploads`, {
    body: JSON.stringify({
      height,
      name: file.name,
      size: file.size,
      type: file.type,
      width,
    }),
    method: "POST",
  }).then((payload) => payload.upload)
}

export async function uploadCanvasLabAssetFile(upload: CanvasLabAssetUpload, file: File) {
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error("Supabase 未配置，无法上传画布素材。")
  }

  const { error } = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, {
    contentType: file.type,
  })

  if (error) throw error
}

export async function createCanvasLabThumbnailUpload({
  canvasId,
  thumbnail,
}: {
  canvasId: string
  thumbnail: Blob
}) {
  return requestCanvasLabApi<{ upload: CanvasLabThumbnailUpload }>(`/api/canvas-documents/${encodeURIComponent(canvasId)}/thumbnail`, {
    body: JSON.stringify({
      size: thumbnail.size,
      type: thumbnail.type,
    }),
    method: "POST",
  }).then((payload) => payload.upload)
}

export async function uploadCanvasLabThumbnail(upload: CanvasLabThumbnailUpload, thumbnail: Blob) {
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error("Supabase 未配置，无法上传画布缩略图。")
  }

  const { error } = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, thumbnail, {
    contentType: thumbnail.type,
  })

  if (error) throw error
}

export async function createCanvasLabAssetBinding(canvasId: string, payload: CanvasLabAssetBindingPayload) {
  return requestCanvasLabApi<{ asset: unknown }>(`/api/canvas-documents/${encodeURIComponent(canvasId)}/assets`, {
    body: JSON.stringify(payload),
    method: "POST",
  }).then((response) => response.asset)
}

export async function createCanvasImageGenerationTask(formData: FormData) {
  const token = await getCurrentAccessToken()
  const response = await fetch("/api/generate/image", {
    body: formData,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    method: "POST",
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || payload?.ok === false) {
    throw new Error(getApiErrorMessage(payload, `创建生成任务失败：HTTP ${response.status}。`))
  }

  return payload as {
    clientRequestId?: string
    imageUrls?: string[]
    ok: true
    progress?: number
    status: string
    taskError?: string
    taskId: string
    type: "image"
  }
}

export async function getCanvasGenerationTaskStatus(taskId: string) {
  const payload = await requestCanvasLabApi<{
    error?: string
    imageUrls: string[]
    ok: true
    progress: number
    status: "submitted" | "processing" | "completed" | "failed" | "partial_completed"
    taskError: string
    taskId: string
    videoUrl: string
  }>(`/api/tasks/${encodeURIComponent(taskId)}`)

  return payload
}

export async function downloadCanvasLabImageAsDataUrl(url: string, filename = "canvas-image.png") {
  const response = await fetch(`/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`)
  if (!response.ok) {
    throw new Error(`图片恢复失败：HTTP ${response.status}。`)
  }

  const blob = await response.blob()
  if (!blob.type.startsWith("image/")) {
    throw new Error("画布资源不是图片。")
  }

  return new Promise<{ dataURL: BinaryFileData["dataURL"]; mimeType: BinaryFileData["mimeType"] }>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败。"))
    reader.onload = () => resolve({
      dataURL: String(reader.result) as BinaryFileData["dataURL"],
      mimeType: blob.type as BinaryFileData["mimeType"],
    })
    reader.readAsDataURL(blob)
  })
}

export async function listCanvasLabVersions(canvasId: string) {
  const payload = await requestCanvasLabApi<{ versions: CanvasLabVersionSummary[] }>(`/api/canvas-documents/${encodeURIComponent(canvasId)}/versions`)
  return payload.versions
}

export async function createCanvasLabVersion(canvasId: string, reason = "manual") {
  const payload = await requestCanvasLabApi<{ version: CanvasLabVersionSummary }>(`/api/canvas-documents/${encodeURIComponent(canvasId)}/versions`, {
    body: JSON.stringify({ reason }),
    method: "POST",
  })
  return payload.version
}

export async function restoreCanvasLabVersion(canvasId: string, versionId: string) {
  const payload = await requestCanvasLabApi<{ document: CanvasLabCloudDocument }>(`/api/canvas-documents/${encodeURIComponent(canvasId)}/restore`, {
    body: JSON.stringify({ versionId }),
    method: "POST",
  })
  return payload.document
}

async function requestCanvasLabApi<T>(path: string, init: RequestInit = {}) {
  const token = await getCurrentAccessToken()
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(path, {
    ...init,
    headers,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || payload?.ok === false) {
    throw new Error(getApiErrorMessage(payload, `画布接口请求失败：HTTP ${response.status}。`))
  }

  return payload as T & { ok: true }
}

async function getCurrentAccessToken() {
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error("Supabase 未配置，无法同步云端画布。")
  }

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const token = data.session?.access_token
  if (!token) {
    throw new Error("登录状态已失效，请重新登录。")
  }

  return token
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: unknown }).error
    if (typeof error === "string" && error) return error
  }

  return fallback
}
