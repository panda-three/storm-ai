import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"

const canvasLabDbName = "storm-canvas-lab-v1"
const canvasLabStoreName = "documents"
const defaultCanvasLabDocumentId = "main"
const canvasLabPrefsKey = "storm-canvas-lab-prefs-v1"

export interface CanvasLabDocument {
  appState: Partial<Pick<AppState, "gridSize" | "scrollX" | "scrollY" | "viewBackgroundColor" | "zoom">>
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  id: string
  title?: string
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

export async function loadCanvasLabDocument(documentId = defaultCanvasLabDocumentId) {
  const document = await withCanvasLabStore<CanvasLabDocument>("readonly", (store) => store.get(documentId))

  if (!document || document.version !== 1 || document.id !== documentId) {
    return null
  }

  return document
}

export async function saveCanvasLabDocument(
  document: Omit<CanvasLabDocument, "id" | "updatedAt" | "version">,
  documentId = defaultCanvasLabDocumentId
) {
  const nextDocument: CanvasLabDocument = {
    ...document,
    id: documentId,
    updatedAt: new Date().toISOString(),
    version: 1,
  }

  await withCanvasLabStore("readwrite", (store) => store.put(nextDocument, documentId))
  return nextDocument
}

export async function deleteCanvasLabDocument(documentId = defaultCanvasLabDocumentId) {
  await withCanvasLabStore("readwrite", (store) => store.delete(documentId))
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
