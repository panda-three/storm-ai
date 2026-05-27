import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import { sanitizeCanvasLabElements } from "@/lib/canvas-lab-scene"
import { describeServerError, getSupabaseServerClient, ServerResponseError } from "@/lib/server-supabase"

export interface CanvasDocumentUpdateInput {
  appState?: Partial<Pick<AppState, "gridSize" | "scrollX" | "scrollY" | "viewBackgroundColor" | "zoom">>
  elements?: readonly ExcalidrawElement[]
  files?: BinaryFiles
  thumbnailUrl?: string | null
  title?: string
}

export interface CanvasAssetUploadInput {
  height?: number
  name?: string
  size: number
  type: string
  width?: number
}

export interface CanvasAssetBindingInput {
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

export interface CanvasThumbnailUploadInput {
  size: number
  type: string
}

interface CanvasDocumentRow {
  app_state: CanvasDocumentUpdateInput["appState"] | null
  created_at: string
  deleted_at: string | null
  files: BinaryFiles | null
  id: string
  scene: { elements?: readonly ExcalidrawElement[] } | null
  thumbnail_url: string | null
  title: string | null
  updated_at: string
  user_id: string
}

const maxCanvasPayloadBytes = 4 * 1024 * 1024
const maxCanvasUploadBytes = 12 * 1024 * 1024
const maxCanvasThumbnailBytes = 1024 * 1024
const maxCanvasDocumentsPerUser = 20
const maxCanvasAssetsPerDocument = 120
const maxCanvasVersionsPerDocument = 20
const allowedCanvasUploadTypes = new Set(["image/png", "image/jpeg", "image/webp"])
const allowedCanvasThumbnailTypes = new Set(["image/webp", "image/png", "image/jpeg"])

export async function listCanvasDocumentsForUser(userId: string) {
  const { data, error } = await getSupabaseServerClient()
    .from("canvas_documents")
    .select("id, title, thumbnail_url, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })

  if (error) {
    throw new Error(describeServerError(error, "读取画布列表失败。"), { cause: error })
  }

  return Promise.all(
    (data ?? []).map(async (row) => ({
      assetCount: await countCanvasAssets({ canvasId: row.id, userId }),
      id: row.id,
      thumbnailUrl: row.thumbnail_url ?? null,
      title: normalizeCanvasTitle(row.title),
      updatedAt: row.updated_at,
    }))
  )
}

export async function createCanvasDocumentForUser({ title, userId }: { title?: unknown; userId: string }) {
  await assertCanvasDocumentQuota(userId)

  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("canvas_documents")
    .insert({
      app_state: {},
      files: {},
      scene: { elements: [] },
      title: normalizeCanvasTitle(title),
      updated_at: now,
      user_id: userId,
    })
    .select("id, user_id, title, scene, app_state, files, thumbnail_url, created_at, updated_at, deleted_at")
    .single()

  if (error) {
    throw new Error(describeServerError(error, "创建画布失败。"), { cause: error })
  }

  return mapCanvasDocumentRow(data as CanvasDocumentRow)
}

export async function getCanvasDocumentForUser({ id, userId }: { id: string; userId: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from("canvas_documents")
    .select("id, user_id, title, scene, app_state, files, thumbnail_url, created_at, updated_at, deleted_at")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取画布失败。"), { cause: error })
  }

  if (!data) {
    throw new ServerResponseError("画布不存在或无权访问。", 404)
  }

  return mapCanvasDocumentRow(data as CanvasDocumentRow)
}

export async function updateCanvasDocumentForUser({
  id,
  input,
  userId,
}: {
  id: string
  input: CanvasDocumentUpdateInput
  userId: string
}) {
  assertCanvasPayloadSize(input)

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if ("title" in input) update.title = normalizeCanvasTitle(input.title)
  if ("thumbnailUrl" in input) update.thumbnail_url = input.thumbnailUrl || null
  if ("appState" in input) update.app_state = input.appState ?? {}
  if ("files" in input) update.files = input.files ?? {}
  if ("elements" in input) update.scene = { elements: sanitizeCanvasLabElements(input.elements ?? []) }

  const { data, error } = await getSupabaseServerClient()
    .from("canvas_documents")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id, user_id, title, scene, app_state, files, thumbnail_url, created_at, updated_at, deleted_at")
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "保存画布失败。"), { cause: error })
  }

  if (!data) {
    throw new ServerResponseError("画布不存在或无权访问。", 404)
  }

  return mapCanvasDocumentRow(data as CanvasDocumentRow)
}

export async function softDeleteCanvasDocumentForUser({ id, userId }: { id: string; userId: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from("canvas_documents")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "删除画布失败。"), { cause: error })
  }

  if (!data) {
    throw new ServerResponseError("画布不存在或无权访问。", 404)
  }
}

export async function createCanvasAssetUploadForUser({
  canvasId,
  input,
  userId,
}: {
  canvasId: string
  input: CanvasAssetUploadInput
  userId: string
}) {
  validateCanvasUploadInput(input)
  await getCanvasDocumentForUser({ id: canvasId, userId })
  await assertCanvasAssetQuota({ canvasId, userId })

  const bucket = process.env.SUPABASE_CANVAS_ASSETS_BUCKET ?? "canvas-assets"
  const assetId = crypto.randomUUID()
  const extension = getCanvasUploadExtension(input.type)
  const path = `users/${userId}/canvases/${canvasId}/${assetId}.${extension}`
  const supabase = getSupabaseServerClient()
  const { data: signedUpload, error: signedUploadError } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path)

  if (signedUploadError) {
    throw new Error(describeServerError(signedUploadError, "创建画布素材上传地址失败。"), { cause: signedUploadError })
  }

  const { data: publicUrl } = supabase.storage.from(bucket).getPublicUrl(path)
  const { data: asset, error } = await supabase
    .from("canvas_assets")
    .insert({
      canvas_id: canvasId,
      file_size: input.size,
      height: normalizePositiveInteger(input.height),
      id: assetId,
      metadata: {
        name: normalizeUploadName(input.name),
        path,
      },
      mime_type: input.type,
      source_key: `upload:${assetId}`,
      source_type: "upload",
      storage_url: publicUrl.publicUrl,
      user_id: userId,
      width: normalizePositiveInteger(input.width),
    })
    .select("id, canvas_id, storage_url, mime_type, width, height, file_size, metadata, created_at")
    .single()

  if (error) {
    throw new Error(describeServerError(error, "登记画布素材失败。"), { cause: error })
  }

  return {
    asset: {
      canvasId: asset.canvas_id,
      createdAt: asset.created_at,
      fileSize: asset.file_size,
      height: asset.height,
      id: asset.id,
      metadata: asset.metadata,
      mimeType: asset.mime_type,
      storageUrl: asset.storage_url,
      width: asset.width,
    },
    bucket,
    path,
    publicUrl: publicUrl.publicUrl,
    token: signedUpload.token,
  }
}

export async function createCanvasThumbnailUploadForUser({
  canvasId,
  input,
  userId,
}: {
  canvasId: string
  input: CanvasThumbnailUploadInput
  userId: string
}) {
  validateCanvasThumbnailInput(input)
  await getCanvasDocumentForUser({ id: canvasId, userId })

  const bucket = process.env.SUPABASE_CANVAS_THUMBNAILS_BUCKET ?? "canvas-thumbnails"
  const extension = getCanvasThumbnailExtension(input.type)
  const path = `users/${userId}/canvases/${canvasId}/thumbnail.${extension}`
  const supabase = getSupabaseServerClient()
  const { data: signedUpload, error: signedUploadError } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path, {
      upsert: true,
    })

  if (signedUploadError) {
    throw new Error(describeServerError(signedUploadError, "创建画布缩略图上传地址失败。"), { cause: signedUploadError })
  }

  const { data: publicUrl } = supabase.storage.from(bucket).getPublicUrl(path)

  return {
    bucket,
    path,
    publicUrl: `${publicUrl.publicUrl}?v=${Date.now().toString(36)}`,
    token: signedUpload.token,
  }
}

export async function listCanvasAssetsForUser({ canvasId, userId }: { canvasId: string; userId: string }) {
  await getCanvasDocumentForUser({ id: canvasId, userId })

  const { data, error } = await getSupabaseServerClient()
    .from("canvas_assets")
    .select("id, source_type, source_project_id, source_task_id, source_key, storage_url, external_url, mime_type, width, height, file_size, metadata, created_at")
    .eq("canvas_id", canvasId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(describeServerError(error, "读取画布素材失败。"), { cause: error })
  }

  return (data ?? []).map((asset) => ({
    createdAt: asset.created_at,
    externalUrl: asset.external_url,
    fileSize: asset.file_size,
    height: asset.height,
    id: asset.id,
    metadata: asset.metadata,
    mimeType: asset.mime_type,
    sourceKey: asset.source_key,
    sourceProjectId: asset.source_project_id,
    sourceTaskId: asset.source_task_id,
    sourceType: asset.source_type,
    storageUrl: asset.storage_url,
    width: asset.width,
  }))
}

export async function createCanvasAssetBindingForUser({
  canvasId,
  input,
  userId,
}: {
  canvasId: string
  input: CanvasAssetBindingInput
  userId: string
}) {
  await getCanvasDocumentForUser({ id: canvasId, userId })
  await assertCanvasAssetQuota({ canvasId, userId })

  const sourceType = normalizeAssetSourceType(input.sourceType)
  const sourceKey = normalizeNullableText(input.sourceKey)
  const { data, error } = await getSupabaseServerClient()
    .from("canvas_assets")
    .upsert(
      {
        canvas_id: canvasId,
        external_url: normalizeNullableText(input.externalUrl),
        height: normalizePositiveInteger(input.height),
        metadata: {},
        mime_type: normalizeNullableText(input.mimeType),
        source_key: sourceKey,
        source_project_id: normalizeNullableText(input.sourceProjectId),
        source_task_id: normalizeNullableText(input.sourceTaskId),
        source_type: sourceType,
        storage_url: normalizeNullableText(input.storageUrl),
        user_id: userId,
        width: normalizePositiveInteger(input.width),
      },
      sourceKey ? { onConflict: "canvas_id,source_key" } : undefined
    )
    .select("id, source_type, source_project_id, source_task_id, source_key, storage_url, external_url, mime_type, width, height, file_size, metadata, created_at")
    .single()

  if (error) {
    throw new Error(describeServerError(error, "登记画布素材失败。"), { cause: error })
  }

  return {
    createdAt: data.created_at,
    externalUrl: data.external_url,
    fileSize: data.file_size,
    height: data.height,
    id: data.id,
    metadata: data.metadata,
    mimeType: data.mime_type,
    sourceKey: data.source_key,
    sourceProjectId: data.source_project_id,
    sourceTaskId: data.source_task_id,
    sourceType: data.source_type,
    storageUrl: data.storage_url,
    width: data.width,
  }
}

export async function listCanvasVersionsForUser({ canvasId, userId }: { canvasId: string; userId: string }) {
  await getCanvasDocumentForUser({ id: canvasId, userId })

  const { data, error } = await getSupabaseServerClient()
    .from("canvas_versions")
    .select("id, reason, created_at")
    .eq("canvas_id", canvasId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(maxCanvasVersionsPerDocument)

  if (error) {
    throw new Error(describeServerError(error, "读取画布版本失败。"), { cause: error })
  }

  return (data ?? []).map((version) => ({
    createdAt: version.created_at,
    id: version.id,
    reason: version.reason,
  }))
}

export async function createCanvasVersionForUser({
  canvasId,
  reason = "manual",
  userId,
}: {
  canvasId: string
  reason?: string
  userId: string
}) {
  const document = await getCanvasDocumentForUser({ id: canvasId, userId })
  const { data, error } = await getSupabaseServerClient()
    .from("canvas_versions")
    .insert({
      app_state: document.appState,
      canvas_id: canvasId,
      files: document.files,
      reason: normalizeVersionReason(reason),
      scene: { elements: sanitizeCanvasLabElements(document.elements) },
      user_id: userId,
    })
    .select("id, reason, created_at")
    .single()

  if (error) {
    throw new Error(describeServerError(error, "保存画布版本失败。"), { cause: error })
  }

  await pruneCanvasVersions({ canvasId, userId })

  return {
    createdAt: data.created_at,
    id: data.id,
    reason: data.reason,
  }
}

export async function restoreCanvasVersionForUser({
  canvasId,
  userId,
  versionId,
}: {
  canvasId: string
  userId: string
  versionId: string
}) {
  await createCanvasVersionForUser({ canvasId, reason: "before_restore", userId })

  const { data: version, error } = await getSupabaseServerClient()
    .from("canvas_versions")
    .select("scene, app_state, files")
    .eq("id", versionId)
    .eq("canvas_id", canvasId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取恢复版本失败。"), { cause: error })
  }

  if (!version) {
    throw new ServerResponseError("版本不存在或无权访问。", 404)
  }

  return updateCanvasDocumentForUser({
    id: canvasId,
    input: {
      appState: (version.app_state as CanvasDocumentUpdateInput["appState"]) ?? {},
      elements: sanitizeCanvasLabElements(
        Array.isArray((version.scene as { elements?: unknown })?.elements)
          ? (version.scene as { elements: readonly ExcalidrawElement[] }).elements
          : []
      ),
      files: (version.files as BinaryFiles) ?? {},
    },
    userId,
  })
}

function mapCanvasDocumentRow(row: CanvasDocumentRow) {
  return {
    appState: row.app_state ?? {},
    assetCount: 0,
    elements: sanitizeCanvasLabElements(Array.isArray(row.scene?.elements) ? row.scene.elements : []),
    files: row.files ?? {},
    id: row.id,
    thumbnailUrl: row.thumbnail_url ?? null,
    title: normalizeCanvasTitle(row.title),
    updatedAt: row.updated_at,
  }
}

async function countCanvasAssets({ canvasId, userId }: { canvasId: string; userId: string }) {
  const { count, error } = await getSupabaseServerClient()
    .from("canvas_assets")
    .select("id", { count: "exact", head: true })
    .eq("canvas_id", canvasId)
    .eq("user_id", userId)

  if (error) {
    console.warn("[Canvas Assets] count failed", {
      canvasId,
      error: describeServerError(error, "统计画布素材失败。"),
    })
    return 0
  }

  return count ?? 0
}

function normalizeCanvasTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim() : ""
  return (title || "未命名画布").slice(0, 80)
}

function assertCanvasPayloadSize(input: CanvasDocumentUpdateInput) {
  const size = Buffer.byteLength(JSON.stringify(input), "utf8")
  if (size > maxCanvasPayloadBytes) {
    throw new ServerResponseError("画布内容过大，请先减少大图或素材数量后再保存。", 413)
  }
}

async function assertCanvasDocumentQuota(userId: string) {
  const { count, error } = await getSupabaseServerClient()
    .from("canvas_documents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null)

  if (error) {
    throw new Error(describeServerError(error, "检查画布数量失败。"), { cause: error })
  }

  if ((count ?? 0) >= maxCanvasDocumentsPerUser) {
    throw new ServerResponseError(`单个账号最多保留 ${maxCanvasDocumentsPerUser} 个画布。`, 400)
  }
}

async function assertCanvasAssetQuota({ canvasId, userId }: { canvasId: string; userId: string }) {
  const { count, error } = await getSupabaseServerClient()
    .from("canvas_assets")
    .select("id", { count: "exact", head: true })
    .eq("canvas_id", canvasId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(describeServerError(error, "检查画布素材数量失败。"), { cause: error })
  }

  if ((count ?? 0) >= maxCanvasAssetsPerDocument) {
    throw new ServerResponseError(`单个画布最多保留 ${maxCanvasAssetsPerDocument} 个素材。`, 400)
  }
}

async function pruneCanvasVersions({ canvasId, userId }: { canvasId: string; userId: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from("canvas_versions")
    .select("id")
    .eq("canvas_id", canvasId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    console.warn("[Canvas Versions] prune list failed", {
      error: describeServerError(error, "读取画布版本失败。"),
    })
    return
  }

  const staleIds = (data ?? []).slice(maxCanvasVersionsPerDocument).map((version) => version.id)
  if (staleIds.length === 0) return

  const { error: deleteError } = await getSupabaseServerClient()
    .from("canvas_versions")
    .delete()
    .in("id", staleIds)
    .eq("canvas_id", canvasId)
    .eq("user_id", userId)

  if (deleteError) {
    console.warn("[Canvas Versions] prune delete failed", {
      error: describeServerError(deleteError, "清理画布旧版本失败。"),
    })
  }
}

function normalizeVersionReason(value: string) {
  const reason = value.trim()
  return (reason || "manual").slice(0, 40)
}

function validateCanvasUploadInput(input: CanvasAssetUploadInput) {
  if (!allowedCanvasUploadTypes.has(input.type)) {
    throw new ServerResponseError("画布只支持上传 PNG、JPG、WEBP 图片。", 400)
  }

  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > maxCanvasUploadBytes) {
    throw new ServerResponseError("图片大小不能超过 12MB。", 400)
  }
}

function validateCanvasThumbnailInput(input: CanvasThumbnailUploadInput) {
  if (!allowedCanvasThumbnailTypes.has(input.type)) {
    throw new ServerResponseError("画布缩略图格式不支持。", 400)
  }

  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > maxCanvasThumbnailBytes) {
    throw new ServerResponseError("画布缩略图不能超过 1MB。", 400)
  }
}

function getCanvasUploadExtension(type: string) {
  if (type === "image/webp") return "webp"
  if (type === "image/jpeg") return "jpg"
  return "png"
}

function getCanvasThumbnailExtension(type: string) {
  if (type === "image/png") return "png"
  if (type === "image/jpeg") return "jpg"
  return "webp"
}

function normalizeUploadName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : ""
  return (name || "canvas-image").slice(0, 120)
}

function normalizePositiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeNullableText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : ""
  return text || null
}

function normalizeAssetSourceType(value: unknown) {
  const sourceType = typeof value === "string" ? value.trim() : ""
  return (sourceType || "external").slice(0, 40)
}
