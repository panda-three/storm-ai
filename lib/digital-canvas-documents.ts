import { describeServerError, getSupabaseServerClient, ServerResponseError } from "@/lib/server-supabase"
import { createEmptyGraph, type DigitalCanvasGraph } from "@/lib/digital-canvas/types"

export interface DigitalCanvasDocumentUpdateInput {
  title?: unknown
  graph?: DigitalCanvasGraph
  thumbnailUrl?: string | null
}

interface DigitalCanvasDocumentRow {
  id: string
  user_id: string
  title: string | null
  graph: DigitalCanvasGraph | null
  thumbnail_url: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

const DIGITAL_CANVAS_TABLE = "digital_canvas_documents"
const maxDigitalCanvasPayloadBytes = 6 * 1024 * 1024
const maxDigitalCanvasDocumentsPerUser = 30
const maxDigitalCanvasNodes = 400
const maxDigitalCanvasEdges = 800

export async function listDigitalCanvasDocumentsForUser(userId: string) {
  const { data, error } = await getSupabaseServerClient()
    .from(DIGITAL_CANVAS_TABLE)
    .select("id, title, thumbnail_url, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })

  if (error) {
    throw new Error(describeServerError(error, "读取数字画布列表失败。"), { cause: error })
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    thumbnailUrl: row.thumbnail_url ?? null,
    title: normalizeTitle(row.title),
    updatedAt: row.updated_at,
  }))
}

export async function createDigitalCanvasDocumentForUser({ title, userId }: { title?: unknown; userId: string }) {
  await assertDocumentQuota(userId)

  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from(DIGITAL_CANVAS_TABLE)
    .insert({
      graph: createEmptyGraph(),
      title: normalizeTitle(title),
      updated_at: now,
      user_id: userId,
    })
    .select("id, user_id, title, graph, thumbnail_url, created_at, updated_at, deleted_at")
    .single()

  if (error) {
    throw new Error(describeServerError(error, "创建数字画布失败。"), { cause: error })
  }

  return mapRow(data as DigitalCanvasDocumentRow)
}

export async function getDigitalCanvasDocumentForUser({ id, userId }: { id: string; userId: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from(DIGITAL_CANVAS_TABLE)
    .select("id, user_id, title, graph, thumbnail_url, created_at, updated_at, deleted_at")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取数字画布失败。"), { cause: error })
  }

  if (!data) {
    throw new ServerResponseError("数字画布不存在或无权访问。", 404)
  }

  return mapRow(data as DigitalCanvasDocumentRow)
}

export async function updateDigitalCanvasDocumentForUser({
  id,
  input,
  userId,
}: {
  id: string
  input: DigitalCanvasDocumentUpdateInput
  userId: string
}) {
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if ("title" in input) update.title = normalizeTitle(input.title)
  if ("thumbnailUrl" in input) update.thumbnail_url = input.thumbnailUrl || null
  if ("graph" in input) update.graph = sanitizeGraph(input.graph)

  assertPayloadSize(update)

  const { data, error } = await getSupabaseServerClient()
    .from(DIGITAL_CANVAS_TABLE)
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id, user_id, title, graph, thumbnail_url, created_at, updated_at, deleted_at")
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "保存数字画布失败。"), { cause: error })
  }

  if (!data) {
    throw new ServerResponseError("数字画布不存在或无权访问。", 404)
  }

  return mapRow(data as DigitalCanvasDocumentRow)
}

export async function softDeleteDigitalCanvasDocumentForUser({ id, userId }: { id: string; userId: string }) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from(DIGITAL_CANVAS_TABLE)
    .update({ deleted_at: now, updated_at: now })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "删除数字画布失败。"), { cause: error })
  }

  if (!data) {
    throw new ServerResponseError("数字画布不存在或无权访问。", 404)
  }
}

function mapRow(row: DigitalCanvasDocumentRow) {
  return {
    graph: sanitizeGraph(row.graph ?? undefined),
    id: row.id,
    thumbnailUrl: row.thumbnail_url ?? null,
    title: normalizeTitle(row.title),
    updatedAt: row.updated_at,
  }
}

function normalizeTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim() : ""
  return (title || "未命名数字画布").slice(0, 80)
}

function sanitizeGraph(graph: DigitalCanvasGraph | undefined): DigitalCanvasGraph {
  if (!graph || typeof graph !== "object") return createEmptyGraph()

  const nodes = Array.isArray(graph.nodes) ? graph.nodes.slice(0, maxDigitalCanvasNodes) : []
  const edges = Array.isArray(graph.edges) ? graph.edges.slice(0, maxDigitalCanvasEdges) : []

  const sanitized: DigitalCanvasGraph = { edges, nodes }
  if (graph.viewport && typeof graph.viewport === "object") {
    const { x, y, zoom } = graph.viewport
    sanitized.viewport = {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    }
  }

  return sanitized
}

function assertPayloadSize(update: Record<string, unknown>) {
  const size = Buffer.byteLength(JSON.stringify(update), "utf8")
  if (size > maxDigitalCanvasPayloadBytes) {
    throw new ServerResponseError("数字画布内容过大，请先减少节点或图片数量后再保存。", 413)
  }
}

async function assertDocumentQuota(userId: string) {
  const { count, error } = await getSupabaseServerClient()
    .from(DIGITAL_CANVAS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null)

  if (error) {
    throw new Error(describeServerError(error, "检查数字画布数量失败。"), { cause: error })
  }

  if ((count ?? 0) >= maxDigitalCanvasDocumentsPerUser) {
    throw new ServerResponseError(`单个账号最多保留 ${maxDigitalCanvasDocumentsPerUser} 个数字画布。`, 400)
  }
}
