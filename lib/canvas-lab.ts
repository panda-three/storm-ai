import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import { isDeletedProjectItem, sortProjectHistory, type ProjectItem } from "@/lib/project-history"

const canvasLabDbName = "storm-canvas-lab-v1"
const canvasLabStoreName = "documents"
const canvasLabDocumentId = "main"
const canvasLabPrefsKey = "storm-canvas-lab-prefs-v1"

export const canvasLabSourceCustomDataKey = "stormCanvasSource"

export interface CanvasLabSourceData {
  importedAt: string
  projectId: string
  sourceKey: string
  taskId?: string
  type: "project"
  upstreamTaskId?: string
}

export interface CanvasLabDocument {
  appState: Partial<Pick<AppState, "gridSize" | "scrollX" | "scrollY" | "viewBackgroundColor" | "zoom">>
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  id: typeof canvasLabDocumentId
  updatedAt: string
  version: 1
}

export interface CanvasLabPrefs {
  assetRailOpen: boolean
}

const defaultCanvasLabPrefs: CanvasLabPrefs = {
  assetRailOpen: true,
}

function openCanvasLabDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持 IndexedDB。"))
      return
    }

    const request = indexedDB.open(canvasLabDbName, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(canvasLabStoreName)) {
        db.createObjectStore(canvasLabStoreName)
      }
    }
    request.onerror = () => reject(request.error ?? new Error("打开画布存储失败。"))
    request.onsuccess = () => resolve(request.result)
  })
}

async function withCanvasLabStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | void
) {
  const db = await openCanvasLabDb()

  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(canvasLabStoreName, mode)
    const store = transaction.objectStore(canvasLabStoreName)
    const request = operation(store)
    let result: T | undefined

    if (request) {
      request.onsuccess = () => {
        result = request.result
      }
      request.onerror = () => {
        reject(request.error ?? new Error("读取画布存储失败。"))
      }
    }

    transaction.oncomplete = () => {
      db.close()
      resolve(result)
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? new Error("写入画布存储失败。"))
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error ?? new Error("画布存储事务已中断。"))
    }
  })
}

export async function loadCanvasLabDocument() {
  const document = await withCanvasLabStore<CanvasLabDocument>("readonly", (store) => store.get(canvasLabDocumentId))

  if (!document || document.version !== 1 || document.id !== canvasLabDocumentId) {
    return null
  }

  return document
}

export async function saveCanvasLabDocument(document: Omit<CanvasLabDocument, "id" | "updatedAt" | "version">) {
  const nextDocument: CanvasLabDocument = {
    ...document,
    id: canvasLabDocumentId,
    updatedAt: new Date().toISOString(),
    version: 1,
  }

  await withCanvasLabStore("readwrite", (store) => store.put(nextDocument, canvasLabDocumentId))
  return nextDocument
}

export async function deleteCanvasLabDocument() {
  await withCanvasLabStore("readwrite", (store) => store.delete(canvasLabDocumentId))
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

export function loadCanvasLabPrefs(): CanvasLabPrefs {
  if (typeof window === "undefined") return defaultCanvasLabPrefs

  try {
    const raw = window.localStorage.getItem(canvasLabPrefsKey)
    if (!raw) return defaultCanvasLabPrefs

    return {
      ...defaultCanvasLabPrefs,
      ...(JSON.parse(raw) as Partial<CanvasLabPrefs>),
    }
  } catch {
    return defaultCanvasLabPrefs
  }
}

export function saveCanvasLabPrefs(prefs: CanvasLabPrefs) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(canvasLabPrefsKey, JSON.stringify(prefs))
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

export function getProjectSourceKey(project: ProjectItem) {
  return project.taskId || project.clientRequestId || project.upstreamTaskId || project.id
}

export function getProjectPreviewUrl(project: ProjectItem) {
  return project.previewUrl || project.imageUrls?.[0] || ""
}

export function getCanvasLabProjects(projects: ProjectItem[]) {
  return sortProjectHistory(projects)
    .filter((project) => !isDeletedProjectItem(project))
    .slice(0, 36)
}

export function getProjectImportFilename(project: ProjectItem) {
  const sourceKey = getProjectSourceKey(project)
  const baseName = project.title?.trim() || sourceKey || "canvas-image"

  return `${baseName.replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 48) || "canvas-image"}.png`
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

export function getElementSourceData(element: ExcalidrawElement) {
  const value = element.customData?.[canvasLabSourceCustomDataKey]
  if (!value || typeof value !== "object") return null

  const source = value as Partial<CanvasLabSourceData>
  if (source.type !== "project" || typeof source.sourceKey !== "string") return null

  return source as CanvasLabSourceData
}
