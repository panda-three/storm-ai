export type GenerationKind = "image" | "video"

export interface GenerationResponse {
  ok: true
  mode: "apimart" | "mengfactory" | "mock" | "yunwu"
  taskId: string
  status: string
  type: GenerationKind
}

export interface NormalizedTaskStatus {
  ok: true
  mode: "apimart" | "mengfactory" | "mock" | "yunwu"
  taskId: string
  status: "submitted" | "processing" | "completed" | "failed" | "partial_completed"
  progress: number
  imageUrls: string[]
  videoUrl: string
  taskError: string
  retryAfterMs?: number
  raw: unknown
}
