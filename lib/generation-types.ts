export type GenerationKind = "image" | "video"

export interface GenerationResponse {
  ok: true
  mode: "apimart" | "manju" | "mengfactory" | "mock" | "toapis" | "vectorengine" | "yunwu"
  taskId: string
  status: string
  type: GenerationKind
  imageUrls?: string[]
  pollUrl?: string
  progress?: number
  raw?: unknown
  taskError?: string
}

export interface NormalizedTaskStatus {
  ok: true
  mode: "apimart" | "manju" | "mengfactory" | "mock" | "toapis" | "vectorengine" | "yunwu"
  taskId: string
  status: "submitted" | "processing" | "completed" | "failed" | "partial_completed"
  progress: number
  imageUrls: string[]
  videoUrl: string
  taskError: string
  retryAfterMs?: number
  raw: unknown
}
