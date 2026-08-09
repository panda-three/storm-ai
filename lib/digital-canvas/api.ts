import { getSupabaseClient } from "@/lib/supabase"
import type { ProjectItem } from "@/lib/project-history"
import type { StoredReferenceImage } from "@/lib/reference-images"
import type {
  DigitalCanvasDocument,
  DigitalCanvasDocumentListItem,
  DigitalCanvasGraph,
} from "@/lib/digital-canvas/types"

// ---------- 持久化：数字画布文档 ----------

export async function listDigitalCanvasDocuments() {
  const payload = await request<{ documents?: DigitalCanvasDocumentListItem[] }>("/api/digital-canvas-documents")
  return payload.documents ?? []
}

export async function createDigitalCanvasDocument(title?: string) {
  const payload = await request<{ document: DigitalCanvasDocument }>("/api/digital-canvas-documents", {
    body: JSON.stringify({ title }),
    method: "POST",
  })
  return payload.document
}

export async function getDigitalCanvasDocument(id: string) {
  const payload = await request<{ document: DigitalCanvasDocument }>(
    `/api/digital-canvas-documents/${encodeURIComponent(id)}`
  )
  return payload.document
}

export async function saveDigitalCanvasDocument(
  id: string,
  input: { graph?: DigitalCanvasGraph; title?: string; thumbnailUrl?: string | null }
) {
  const payload = await request<{ document: DigitalCanvasDocument }>(
    `/api/digital-canvas-documents/${encodeURIComponent(id)}`,
    {
      body: JSON.stringify(input),
      method: "PATCH",
    }
  )
  return payload.document
}

export async function deleteDigitalCanvasDocument(id: string) {
  await request(`/api/digital-canvas-documents/${encodeURIComponent(id)}`, { method: "DELETE" })
}

// ---------- 生成：复用创作台生成 + 任务轮询接口 ----------

export interface DigitalCanvasImageGenerationResult {
  imageUrls: string[]
}

interface CreateImageTaskResponse {
  clientRequestId?: string
  imageUrls?: string[]
  ok: true
  progress?: number
  status: string
  taskError?: string
  taskId: string
  type: "image"
}

interface TaskStatusResponse {
  error?: string
  imageUrls: string[]
  ok: true
  progress: number
  status: "submitted" | "processing" | "completed" | "failed" | "partial_completed"
  taskError: string
  taskId: string
  videoUrl: string
}

// 将上游节点传来的图片 URL 上传为参考图（编辑/图生图场景）。
export async function uploadReferenceImageFromUrl(url: string): Promise<StoredReferenceImage> {
  const token = await getAccessToken()
  const proxied = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent("reference.png")}`
  const blobResponse = await fetch(proxied)
  if (!blobResponse.ok) {
    throw new Error(`参考图下载失败：HTTP ${blobResponse.status}。`)
  }
  const blob = await blobResponse.blob()
  const file = new File([blob], "reference.png", { type: blob.type || "image/png" })

  const formData = new FormData()
  formData.append("file", file)

  const response = await fetch("/api/uploads/reference-image", {
    body: formData,
    headers: { Authorization: `Bearer ${token}` },
    method: "POST",
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok === false) {
    throw new Error(getErrorMessage(payload, "参考图上传失败。"))
  }

  return {
    bucket: payload.bucket,
    name: payload.name,
    path: payload.path,
    size: payload.size,
    type: payload.type,
  }
}

// 直接上传本地文件作为参考图（快捷渲染面板的图槽）。
export async function uploadReferenceImageFile(file: File): Promise<StoredReferenceImage> {
  const token = await getAccessToken()
  const formData = new FormData()
  formData.append("file", file)

  const response = await fetch("/api/uploads/reference-image", {
    body: formData,
    headers: { Authorization: `Bearer ${token}` },
    method: "POST",
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok === false) {
    throw new Error(getErrorMessage(payload, "参考图上传失败。"))
  }

  return {
    bucket: payload.bucket,
    name: payload.name,
    path: payload.path,
    size: payload.size,
    type: payload.type,
  }
}

// 生成历史（复用创作台历史接口，供画布「生成历史」面板取图）。
export async function listGenerationHistory() {
  const payload = await request<{ projects?: ProjectItem[] }>("/api/history")
  return (payload.projects ?? []).filter((project) => !project.deletedAt)
}

// 提交图片生成任务（支持参考图，用于图生图/编辑）。
export async function createImageGenerationTask(input: {
  clientRequestId?: string
  imageCount?: number
  model: string
  prompt: string
  quality: string
  ratio: string
  referenceImages?: StoredReferenceImage[]
}) {
  const token = await getAccessToken()
  const response = await fetch("/api/generate/image", {
    body: JSON.stringify(input),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok === false) {
    throw new Error(getErrorMessage(payload, `创建生成任务失败：HTTP ${response.status}。`))
  }
  return payload as CreateImageTaskResponse
}

export async function getImageTaskStatus(taskId: string) {
  const payload = await request<TaskStatusResponse>(`/api/tasks/${encodeURIComponent(taskId)}`)
  return payload
}

// 轮询直到任务完成，回调 onProgress 用于更新节点进度。
export async function pollImageTask(
  taskId: string,
  {
    initialImageUrls = [],
    onProgress,
    signal,
  }: {
    initialImageUrls?: string[]
    onProgress?: (progress: number) => void
    signal?: AbortSignal
  } = {}
): Promise<DigitalCanvasImageGenerationResult> {
  if (initialImageUrls.length > 0) {
    onProgress?.(100)
    return { imageUrls: initialImageUrls }
  }

  const start = Date.now()
  const timeoutMs = 5 * 60 * 1000
  const intervalMs = 2500

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) throw new Error("生成已取消。")
    if (Date.now() - start > timeoutMs) throw new Error("生成超时，请稍后重试。")

    const status = await getImageTaskStatus(taskId)
    if (typeof status.progress === "number") {
      onProgress?.(Math.max(0, Math.min(100, status.progress)))
    }

    if (status.status === "completed" || status.status === "partial_completed") {
      return { imageUrls: status.imageUrls ?? [] }
    }

    if (status.status === "failed") {
      throw new Error(status.taskError || status.error || "生成失败，请稍后重试。")
    }

    await delay(intervalMs)
  }
}

// ---------- 内部工具 ----------

async function request<T>(path: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(path, { ...init, headers })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || payload?.ok === false) {
    throw new Error(getErrorMessage(payload, `数字画布接口请求失败：HTTP ${response.status}。`))
  }

  return payload as T & { ok: true }
}

async function getAccessToken() {
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error("Supabase 未配置，无法使用数字画布。")
  }
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) {
    throw new Error("登录状态已失效，请重新登录。")
  }
  return token
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: unknown }).error
    if (typeof error === "string" && error) return error
  }
  return fallback
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
