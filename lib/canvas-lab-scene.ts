import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { CanvasLabDocument } from "@/lib/canvas-lab-local-store"

export const canvasLabSourceCustomDataKey = "stormCanvasSource"

export interface CanvasLabSourceData {
  assetId?: string
  importedAt: string
  projectId: string
  sourceKey: string
  storageUrl?: string
  taskId?: string
  type: "project" | "task" | "upload"
  upstreamTaskId?: string
}

export function sanitizeCanvasLabAppState(appState: AppState): CanvasLabDocument["appState"] {
  return {
    gridSize: appState.gridSize,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    viewBackgroundColor: appState.viewBackgroundColor,
    zoom: appState.zoom,
  }
}

function hashString(value: string) {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash).toString(36)
}

export function createCanvasLabId(prefix: string, value: string) {
  return `${prefix}-${hashString(value || prefix)}`
}

export function getElementSourceData(element: ExcalidrawElement) {
  const source = getCanvasLabSourceData(element)
  if (source?.type !== "project") return null
  return source
}

export function getCanvasLabTaskSourceData(element: ExcalidrawElement) {
  const source = getCanvasLabSourceData(element)
  if (source?.type !== "task" || !source.taskId) return null
  return source
}

export function getCanvasLabSourceData(element: ExcalidrawElement) {
  const value = element.customData?.[canvasLabSourceCustomDataKey]
  if (!value || typeof value !== "object") return null

  const source = value as Partial<CanvasLabSourceData>
  if (!source.type || typeof source.sourceKey !== "string") return null

  return source as CanvasLabSourceData
}

export function buildSceneSignature(
  elements: readonly OrderedExcalidrawElement[],
  appState: Record<string, unknown>,
  files: BinaryFiles
) {
  return JSON.stringify({
    appState,
    elements: elements.map((element) => [element.id, element.version, element.versionNonce, element.isDeleted]),
    files: Object.keys(files)
      .sort()
      .map((id) => [id, files[id]?.version ?? 0]),
  })
}
