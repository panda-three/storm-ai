import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  getReferenceImageBucket,
  getReferenceImageExtension,
  getReferenceImagePathPrefix,
  validateReferenceImageMetadata,
} from "@/lib/reference-images"
import { fetchSafeRemoteResource, parseSafeRemoteUrl } from "@/lib/safe-fetch-url"

export interface AuthenticatedRequestUser {
  sessionId: string
  token: string
  userId: string
}

interface RequireAuthenticatedUserOptions {
  allowPasswordChangeRequired?: boolean
  allowInactiveSession?: boolean
}

export class ServerResponseError extends Error {
  status: number

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options)
    this.name = "ServerResponseError"
    this.status = status
  }
}

export function getServerErrorStatus(error: unknown, fallback = 500) {
  if (error instanceof ServerResponseError) return error.status
  return fallback
}

export async function requireAdminUser(request: Request): Promise<AuthenticatedRequestUser> {
  const auth = await requireAuthenticatedUser(request)
  const { data, error } = await getSupabaseServerClient()
    .from("user_accounts")
    .select("role")
    .eq("user_id", auth.userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取管理员权限失败。"), { cause: error })
  }

  if (data?.role !== "admin") {
    throw new Error("无管理员权限。")
  }

  return auth
}

interface SupabaseJwtPayload {
  session_id?: unknown
  sub?: unknown
}

let serviceClient: SupabaseClient | null = null
let userAuthClient: SupabaseClient | null = null

export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error("缺少 Supabase 服务端环境变量：NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。")
  }

  if (!serviceClient) {
    serviceClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return serviceClient
}

function getSupabaseUserAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error("缺少 Supabase 认证环境变量：NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY。")
  }

  if (!userAuthClient) {
    userAuthClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return userAuthClient
}

export async function requireAuthenticatedUser(
  request: Request,
  options: RequireAuthenticatedUserOptions = {}
): Promise<AuthenticatedRequestUser> {
  const authorization = request.headers.get("authorization") ?? ""
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()

  if (!token) {
    throw new ServerResponseError("请先登录后再生成。", 401)
  }

  const supabase = getSupabaseUserAuthClient()
  const { data, error } = await supabase.auth.getUser(token).catch((error: unknown) => {
    const message = describeServerError(error, "认证服务连接失败。")
    console.warn("[Supabase Auth] token verification request failed", {
      message,
    })
    throw new ServerResponseError("认证服务暂时不可用，请稍后重试。", 503, { cause: error })
  })

  if (error || !data.user) {
    console.warn("[Supabase Auth] token verification failed", {
      message: error?.message,
      status: error?.status,
    })
    throw new ServerResponseError("登录状态已失效，请重新登录。", 401, { cause: error })
  }

  const sessionId = getSessionIdFromAccessToken(token)
  if (!sessionId) {
    throw new ServerResponseError("登录状态缺少会话标识，请重新登录。", 401)
  }

  const { data: account, error: accountError } = await getSupabaseServerClient()
    .from("user_accounts")
    .select("must_change_password, allow_multi_device_sessions")
    .eq("user_id", data.user.id)
    .maybeSingle()

  if (accountError) {
    throw new Error(describeServerError(accountError, "读取账户安全状态失败。"), { cause: accountError })
  }

  if (!options.allowInactiveSession && !account?.allow_multi_device_sessions) {
    await assertServerActiveSession({
      sessionId,
      userId: data.user.id,
    })
  }

  if (!options.allowPasswordChangeRequired && account?.must_change_password) {
    throw new Error("请先修改临时密码后再继续。")
  }

  return {
    sessionId,
    token,
    userId: data.user.id,
  }
}

async function assertServerActiveSession({ sessionId, userId }: { sessionId: string; userId: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from("user_active_sessions")
    .select("session_id, last_seen_at, revoked_at")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取登录设备状态失败。"), { cause: error })
  }

  const lastSeenAt = data?.last_seen_at ? new Date(data.last_seen_at).getTime() : 0
  const stale = !lastSeenAt || Date.now() - lastSeenAt > 7 * 24 * 60 * 60 * 1000

  if (!data || data.session_id !== sessionId || data.revoked_at || stale) {
    throw new ServerResponseError("该账号已在其他设备登录或登录占用已失效，请重新登录。", 401)
  }

  const { error: updateError } = await getSupabaseServerClient()
    .from("user_active_sessions")
    .update({
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .is("revoked_at", null)

  if (updateError) {
    throw new Error(describeServerError(updateError, "刷新登录设备状态失败。"), { cause: updateError })
  }
}

function getSessionIdFromAccessToken(token: string) {
  const [, payload] = token.split(".")
  if (!payload) return ""

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const json = Buffer.from(padded, "base64").toString("utf8")
    const parsed = JSON.parse(json) as SupabaseJwtPayload

    return typeof parsed.session_id === "string" ? parsed.session_id : ""
  } catch {
    return ""
  }
}

export async function spendGenerationCredits({
  amount,
  reason,
  reference,
  userId,
}: {
  amount: number
  reason: string
  reference: string
  userId: string
}) {
  const { data, error } = await getSupabaseServerClient().rpc("spend_generation_credits", {
    p_amount: amount,
    p_reason: reason,
    p_reference: reference,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(describeServerError(error, "扣点失败。"), { cause: error })
  }
  return data as { amount: number; credit_balance: number; reference: string }
}

export async function recordFreeGenerationUsage({
  reason,
  reference,
  userId,
}: {
  reason: string
  reference: string
  userId: string
}) {
  const { data, error } = await getSupabaseServerClient().rpc("record_free_generation_usage", {
    p_reason: reason,
    p_reference: reference,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(describeServerError(error, "记录会员免费使用失败。"), { cause: error })
  }
  return data as { amount: number; credit_balance: number; reference: string }
}

export async function refundGenerationCredits({
  amount,
  reason,
  reference,
  userId,
}: {
  amount: number
  reason: string
  reference: string
  userId: string
}) {
  const { data, error } = await getSupabaseServerClient().rpc("refund_generation_credits", {
    p_amount: amount,
    p_reason: reason,
    p_reference: reference,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(describeServerError(error, "退款失败。"), { cause: error })
  }
  return data as { amount: number; already_refunded?: boolean; credit_balance: number; reference: string }
}

export async function uploadGeneratedImage({
  buffer,
  contentType,
  userId,
}: {
  buffer: Buffer
  contentType: string
  userId: string
}) {
  const bucket = process.env.SUPABASE_GENERATED_IMAGES_BUCKET ?? "generated-images"
  const extension = contentType.includes("webp") ? "webp" : contentType.includes("jpeg") ? "jpg" : "png"
  const path = `users/${userId}/images/${Date.now()}-${crypto.randomUUID()}.${extension}`
  const supabase = getSupabaseServerClient()
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: false,
  })

  if (error) throw error

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  if (!data.publicUrl) {
    throw new Error("生成图片已上传，但未取得公开访问 URL。")
  }

  return {
    bucket,
    path,
    publicUrl: data.publicUrl,
  }
}

export async function uploadReferenceImage({
  buffer,
  contentType,
  name,
  userId,
}: {
  buffer: Buffer
  contentType: string
  name: string
  userId: string
}) {
  validateReferenceImageMetadata({ size: buffer.byteLength, type: contentType })

  const bucket = getReferenceImageBucket()
  const extension = getReferenceImageExtension(contentType)
  const path = `${getReferenceImagePathPrefix(userId)}${Date.now()}-${crypto.randomUUID()}.${extension}`
  const supabase = getSupabaseServerClient()
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: false,
  })

  if (error) throw error

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  if (!data.publicUrl) {
    throw new Error("参考图已上传，但未取得公开访问 URL。")
  }

  return {
    bucket,
    name,
    path,
    publicUrl: data.publicUrl,
    size: buffer.byteLength,
    type: contentType,
  }
}

export function getGeneratedStorageObjectPath(publicUrl: string) {
  const bucket = process.env.SUPABASE_GENERATED_IMAGES_BUCKET ?? "generated-images"
  const marker = `/storage/v1/object/public/${bucket}/`
  const markerIndex = publicUrl.indexOf(marker)

  if (markerIndex === -1) return ""

  const path = decodeURIComponent(publicUrl.slice(markerIndex + marker.length).split("?")[0] ?? "")
  return path
}

export async function deleteGeneratedImageByPublicUrl(publicUrl: string) {
  const bucket = process.env.SUPABASE_GENERATED_IMAGES_BUCKET ?? "generated-images"
  const path = getGeneratedStorageObjectPath(publicUrl)
  if (!path) return

  const { error } = await getSupabaseServerClient().storage.from(bucket).remove([path])
  if (error) {
    console.warn("[Supabase Storage] generated image cleanup failed", {
      error: describeServerError(error, "清理生成图片失败。"),
      path,
    })
  }
}

export function getReferenceStorageObjectPath(publicUrl: string) {
  const bucket = getReferenceImageBucket()
  const marker = `/storage/v1/object/public/${bucket}/`
  const markerIndex = publicUrl.indexOf(marker)

  if (markerIndex === -1) return ""

  const path = decodeURIComponent(publicUrl.slice(markerIndex + marker.length).split("?")[0] ?? "")
  return path.startsWith("users/") && path.includes("/reference-images/") ? path : ""
}

export async function deleteReferenceImageByPublicUrl(publicUrl: string) {
  const bucket = getReferenceImageBucket()
  const path = getReferenceStorageObjectPath(publicUrl)
  if (!path) return

  const { error } = await getSupabaseServerClient().storage.from(bucket).remove([path])
  if (error) {
    console.warn("[Supabase Storage] reference image cleanup failed", {
      error: describeServerError(error, "清理参考图失败。"),
      path,
    })
  }
}

const remoteImageMaxBytes = 25 * 1024 * 1024
const allowedRemoteImageContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])

export async function persistRemoteGeneratedImage({
  sourceUrl,
  userId,
}: {
  sourceUrl: string
  userId: string
}) {
  const dataImage = parseDataImageUrl(sourceUrl)
  if (dataImage) {
    const buffer = Buffer.from(dataImage.data, "base64")
    if (buffer.byteLength > remoteImageMaxBytes) {
      throw new Error("生成图片超过 25MB，无法保存到历史项目。")
    }

    const uploaded = await uploadGeneratedImage({
      buffer,
      contentType: dataImage.contentType,
      userId,
    })
    return uploaded.publicUrl
  }

  let response: Response
  let parsedSourceUrl: URL

  try {
    parsedSourceUrl = parseSafeRemoteUrl(sourceUrl, { allowHttp: process.env.NODE_ENV !== "production" })
    response = await fetchSafeRemoteResource(
      parsedSourceUrl,
      {
        signal: AbortSignal.timeout(30000),
      },
      { allowHttp: process.env.NODE_ENV !== "production" }
    )
  } catch (error) {
    throw new Error(`生成图片地址不可访问：${describeServerError(error, "请求图片失败。")}`, { cause: error })
  }

  if (!response.ok) {
    throw new Error(`生成图片地址不可访问：HTTP ${response.status}。`)
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""
  if (!allowedRemoteImageContentTypes.has(contentType)) {
    throw new Error(`生成结果不是可用图片内容：${contentType || "未知类型"}。`)
  }

  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > remoteImageMaxBytes) {
    throw new Error("生成图片超过 25MB，无法保存到历史项目。")
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > remoteImageMaxBytes) {
    throw new Error("生成图片超过 25MB，无法保存到历史项目。")
  }

  const uploaded = await uploadGeneratedImage({
    buffer,
    contentType,
    userId,
  })
  return uploaded.publicUrl
}

function parseDataImageUrl(value: string) {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp|gif|avif));base64,([a-z0-9+/=_-]+)$/i)
  if (!match) return null

  return {
    contentType: match[1].toLowerCase(),
    data: match[2],
  }
}

export function describeServerError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message

  if (typeof error === "object" && error !== null) {
    const parts = ["message", "details", "hint", "code"]
      .map((key) => {
        const value = (error as Record<string, unknown>)[key]
        return typeof value === "string" && value ? value : ""
      })
      .filter(Boolean)

    if (parts.length > 0) return parts.join(" ")
  }

  if (typeof error === "string" && error) return error

  return fallback
}
