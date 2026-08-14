import { getSupabaseServerClient } from "@/lib/server-supabase"
import { deleteGeneratedImageByPublicUrl, describeServerError, getGeneratedStorageObjectPath } from "@/lib/server-supabase"
import type { GenerationKind, NormalizedTaskStatus } from "@/lib/generation-types"
import { buildGenerationFailureRefundReason } from "@/lib/generation-ledger"
import { GenerationLimitError, parseGenerationLimitResult } from "@/lib/generation-limits"
import type { ProjectReferenceImage } from "@/lib/reference-images"
import { getManjuVideoTaskStatus, isManjuFatalTaskError } from "@/lib/manju"
import { getYunwuVideoTaskStatus } from "@/lib/yunwu"

export type GenerationJobStatus = "submitted" | "processing" | "completed" | "failed" | "partial_completed"

export const generationTimeoutMessage = "生成任务超时未完成，系统已自动结束任务并退还点数。"
// Synchronous image jobs create billing before calling the upstream API; this recovers interrupted requests.
export const synchronousImageOrphanTimeoutMs = 10 * 60 * 1000
export const asyncVideoTimeoutMs = 60 * 60 * 1000
export const asyncImageTimeoutMs = 60 * 60 * 1000
export const manjuImageTimeoutMs = 30 * 60 * 1000
// 超过该时长的视频任务无论上游返回什么都直接结束并退点，防止无限停在“生成中”。
export const videoHardFailTimeoutMs = 3 * 60 * 60 * 1000
export const generationHistoryRetentionHours = 24
export const generationHistoryRetentionMs = generationHistoryRetentionHours * 60 * 60 * 1000
const videoMissingResultRetryMs = 90 * 1000

export interface GenerationJob {
  already_exists?: boolean
  id: string
  amount: number
  check_attempts: number
  client_request_id: string | null
  completed_at: string | null
  created_at: string
  input_reference_images: ProjectReferenceImage[]
  last_checked_at: string | null
  last_sync_error: string | null
  model: string
  next_check_at: string | null
  expected_result_count: number
  expires_at: string | null
  quality: string | null
  aspect_ratio: string | null
  duration_seconds: number | null
  prompt: string
  provider: string
  reference: string
  result_urls: string[]
  status: GenerationJobStatus
  storage_urls: string[]
  sync_locked_until: string | null
  task_error: string | null
  type: GenerationKind
  upstream_task_id: string | null
  user_id: string
}

const generationJobSelect =
  "id, amount, aspect_ratio, check_attempts, client_request_id, completed_at, created_at, duration_seconds, expected_result_count, expires_at, input_reference_images, last_checked_at, last_sync_error, model, next_check_at, prompt, provider, quality, reference, result_urls, status, storage_urls, sync_locked_until, task_error, type, upstream_task_id, user_id"
const legacyGenerationJobSelect =
  "id, amount, created_at, model, prompt, provider, reference, result_urls, status, task_error, type, upstream_task_id, user_id"

export function getGenerationJobExpiresAt(completedAt = new Date().toISOString()) {
  return new Date(Date.parse(completedAt) + generationHistoryRetentionMs).toISOString()
}

export async function createGenerationJob({
  amount,
  expectedResultCount = 1,
  model,
  prompt,
  provider,
  quality,
  aspectRatio,
  durationSeconds,
  reference,
  type,
  userId,
  clientRequestId,
  inputReferenceImages = [],
}: {
  amount: number
  clientRequestId?: string
  expectedResultCount?: number
  model: string
  prompt: string
  provider: string
  quality?: string
  aspectRatio?: string
  durationSeconds?: number | null
  reference: string
  type: GenerationKind
  userId: string
  inputReferenceImages?: ProjectReferenceImage[]
}) {
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .insert({
      amount,
      client_request_id: clientRequestId || null,
      expected_result_count: expectedResultCount,
      input_reference_images: inputReferenceImages,
      quality: quality || null,
      aspect_ratio: aspectRatio || null,
      duration_seconds: durationSeconds ?? null,
      model,
      prompt,
      provider,
      reference,
      status: "submitted",
      type,
      user_id: userId,
    })
    .select(generationJobSelect)
    .single()

  if (error) {
    throw new Error(describeServerError(error, "创建生成任务失败。"), { cause: error })
  }
  return data as GenerationJob
}

export async function createGenerationJobWithBilling({
  amount,
  expectedResultCount = 1,
  isFree = false,
  model,
  prompt,
  provider,
  quality,
  aspectRatio,
  durationSeconds,
  reason,
  reference,
  type,
  userId,
  clientRequestId,
  inputReferenceImages = [],
}: {
  amount: number
  clientRequestId?: string
  expectedResultCount?: number
  isFree?: boolean
  model: string
  prompt: string
  provider: string
  quality?: string
  aspectRatio?: string
  durationSeconds?: number | null
  reason: string
  reference: string
  type: GenerationKind
  userId: string
  inputReferenceImages?: ProjectReferenceImage[]
}) {
  const { data, error } = await getSupabaseServerClient().rpc("create_generation_job_with_billing", {
    p_amount: amount,
    p_client_request_id: clientRequestId || null,
    p_expected_result_count: expectedResultCount,
    p_quality: quality || null,
    p_aspect_ratio: aspectRatio || null,
    p_duration_seconds: durationSeconds ?? null,
    p_is_free: isFree,
    p_input_reference_images: inputReferenceImages,
    p_model: model,
    p_prompt: prompt,
    p_provider: provider,
    p_reason: reason,
    p_reference: reference,
    p_type: type,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(describeServerError(error, "创建生成任务失败。"), { cause: error })
  }

  const generationLimit = parseGenerationLimitResult(data)
  if (generationLimit) {
    throw new GenerationLimitError(generationLimit)
  }

  return data as GenerationJob
}

export async function updateGenerationJob(
  id: string,
  values: Partial<
    Pick<
      GenerationJob,
      | "check_attempts"
      | "completed_at"
      | "expires_at"
      | "input_reference_images"
      | "last_checked_at"
      | "last_sync_error"
      | "next_check_at"
      | "result_urls"
      | "status"
      | "storage_urls"
      | "sync_locked_until"
      | "task_error"
      | "upstream_task_id"
    >
  >
) {
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(generationJobSelect)
    .single()

  if (error) {
    throw new Error(describeServerError(error, "更新生成任务失败。"), { cause: error })
  }
  return data as GenerationJob
}

export async function updateActiveGenerationJob(
  id: string,
  values: Partial<
    Pick<
      GenerationJob,
      | "check_attempts"
      | "completed_at"
      | "expires_at"
      | "input_reference_images"
      | "last_checked_at"
      | "last_sync_error"
      | "next_check_at"
      | "result_urls"
      | "status"
      | "storage_urls"
      | "sync_locked_until"
      | "task_error"
      | "upstream_task_id"
    >
  >
) {
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["submitted", "processing"])
    .select(generationJobSelect)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "更新生成任务失败。"), { cause: error })
  }
  return data as GenerationJob | null
}

export async function failGenerationJobWithRefund({
  jobId,
  reason,
}: {
  jobId: string
  reason: string
}) {
  const { data, error } = await getSupabaseServerClient().rpc("fail_generation_job_with_refund", {
    p_job_id: jobId,
    p_reason: reason,
  })

  if (error) {
    throw new Error(describeServerError(error, "结束生成任务失败。"), { cause: error })
  }
  return data as GenerationJob
}

export async function loadGenerationJobForUser({
  taskId,
  userId,
}: {
  taskId: string
  userId: string
}) {
  if (!isUuid(taskId)) {
    return loadGenerationJobByUpstreamTaskForUser({ taskId, userId })
  }

  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取生成任务失败。"), { cause: error })
  }
  return isExpiredGenerationJob(data as GenerationJob | null) ? null : (data as GenerationJob | null)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function loadGenerationJobByUpstreamTaskForUser({
  taskId,
  userId,
}: {
  taskId: string
  userId: string
}) {
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("upstream_task_id", taskId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取上游生成任务失败。"), { cause: error })
  }
  return isExpiredGenerationJob(data as GenerationJob | null) ? null : (data as GenerationJob | null)
}

export async function loadGenerationJobsForUser({
  limit = 100,
  userId,
}: {
  limit?: number
  userId: string
}) {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("user_id", userId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    if (isMissingSyncColumnError(error)) {
      const { data: legacyData, error: legacyError } = await supabase
        .from("generation_jobs")
        .select(legacyGenerationJobSelect)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit)

      if (!legacyError) {
        return (legacyData ?? []).map(withDefaultSyncFields) as GenerationJob[]
      }
    }

    throw new Error(describeServerError(error, "读取生成历史失败。"), { cause: error })
  }
  return ((data ?? []) as GenerationJob[]).filter((job) => !isExpiredGenerationJob(job))
}

export async function recoverStaleGenerationJobsForUser({
  limit = 20,
  userId,
}: {
  limit?: number
  userId: string
}) {
  const jobs = await loadStaleGenerationJobs({ limit, userId })
  const results = await Promise.allSettled(jobs.map(recoverStaleGenerationJob))
  return summarizeRecoveryResults(jobs.length, results)
}

function withDefaultSyncFields(job: Partial<GenerationJob>): GenerationJob {
  return {
    check_attempts: 0,
    client_request_id: null,
    completed_at: null,
    aspect_ratio: null,
    duration_seconds: null,
    expected_result_count: 1,
    expires_at: null,
    last_checked_at: null,
    last_sync_error: null,
    input_reference_images: [],
    next_check_at: null,
    quality: null,
    storage_urls: [],
    sync_locked_until: null,
    ...job,
  } as GenerationJob
}

function isMissingSyncColumnError(error: unknown) {
  const message = describeServerError(error, "")
  return (
    message.includes("check_attempts") ||
    message.includes("completed_at") ||
    message.includes("last_checked_at") ||
    message.includes("last_sync_error") ||
    message.includes("next_check_at") ||
    message.includes("expected_result_count") ||
    message.includes("expires_at") ||
    message.includes("aspect_ratio") ||
    message.includes("duration_seconds") ||
    message.includes("input_reference_images") ||
    message.includes("quality") ||
    message.includes("storage_urls") ||
    message.includes("sync_locked_until")
  )
}

export async function loadDueYunwuGenerationJobs({ limit = 20 } = {}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "yunwu")
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .lte("next_check_at", now)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("next_check_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadDueToapisGenerationJobs({ limit = 20 } = {}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "toapis")
    .eq("type", "image")
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .lte("next_check_at", now)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("next_check_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取 ToAPIs 待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadDueGrsaiGenerationJobs({ limit = 20 } = {}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "grsai")
    .eq("type", "image")
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .lte("next_check_at", now)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("next_check_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取 GrsAi 待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadDueApimartGenerationJobs({ limit = 20 } = {}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "apimart")
    .eq("type", "image")
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .lte("next_check_at", now)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("next_check_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取 APIMart 待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadDueManjuGenerationJobs({ limit = 20 } = {}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "manju")
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .lte("next_check_at", now)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("next_check_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取 Manju 待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadInteractiveYunwuGenerationJobsForUser({
  limit = 20,
  userId,
}: {
  limit?: number
  userId: string
}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "yunwu")
    .eq("user_id", userId)
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取用户待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadInteractiveToapisGenerationJobsForUser({
  limit = 20,
  userId,
}: {
  limit?: number
  userId: string
}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "toapis")
    .eq("type", "image")
    .eq("user_id", userId)
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取用户 ToAPIs 待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadInteractiveGrsaiGenerationJobsForUser({
  limit = 20,
  userId,
}: {
  limit?: number
  userId: string
}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "grsai")
    .eq("type", "image")
    .eq("user_id", userId)
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取用户 GrsAi 待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadInteractiveApimartGenerationJobsForUser({
  limit = 20,
  userId,
}: {
  limit?: number
  userId: string
}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "apimart")
    .eq("type", "image")
    .eq("user_id", userId)
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取用户 APIMart 待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadInteractiveManjuGenerationJobsForUser({
  limit = 20,
  userId,
}: {
  limit?: number
  userId: string
}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "manju")
    .eq("type", "image")
    .eq("user_id", userId)
    .in("status", ["submitted", "processing"])
    .not("upstream_task_id", "is", null)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取用户 Manju 待同步任务失败。"), { cause: error })
  }
  return (data ?? []) as GenerationJob[]
}

export async function loadYunwuImageJobsForMirroring({ limit = 20 } = {}) {
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .eq("provider", "yunwu")
    .eq("type", "image")
    .in("status", ["completed", "partial_completed"])
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(describeServerError(error, "读取待转存图片任务失败。"), { cause: error })
  }

  return ((data ?? []) as GenerationJob[]).filter((job) =>
    job.result_urls.some((url) => !getGeneratedStorageObjectPath(url))
  )
}

export async function loadStaleGenerationJobs({
  limit = 20,
  userId,
}: {
  limit?: number
  userId?: string
} = {}) {
  const newestCreatedAt = new Date(Date.now() - synchronousImageOrphanTimeoutMs).toISOString()
  let query = getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .in("status", ["submitted", "processing"])
    .lte("created_at", newestCreatedAt)
    .or(
      [
        `and(provider.eq.yunwu,type.eq.image,upstream_task_id.is.null,created_at.lte.${new Date(Date.now() - synchronousImageOrphanTimeoutMs).toISOString()})`,
        `and(provider.eq.vectorengine,type.eq.image,upstream_task_id.is.null,created_at.lte.${new Date(Date.now() - synchronousImageOrphanTimeoutMs).toISOString()})`,
        `and(type.eq.video,upstream_task_id.not.is.null,created_at.lte.${new Date(Date.now() - asyncVideoTimeoutMs).toISOString()})`,
        `and(provider.eq.toapis,type.eq.image,upstream_task_id.not.is.null,created_at.lte.${new Date(Date.now() - asyncImageTimeoutMs).toISOString()})`,
        `and(provider.eq.grsai,type.eq.image,upstream_task_id.not.is.null,created_at.lte.${new Date(Date.now() - asyncImageTimeoutMs).toISOString()})`,
        `and(provider.eq.apimart,type.eq.image,upstream_task_id.not.is.null,created_at.lte.${new Date(Date.now() - asyncImageTimeoutMs).toISOString()})`,
        `and(provider.eq.manju,type.eq.image,upstream_task_id.not.is.null,created_at.lte.${new Date(Date.now() - manjuImageTimeoutMs).toISOString()})`,
      ].join(",")
    )
    .order("created_at", { ascending: true })
    .limit(limit)

  if (userId) {
    query = query.eq("user_id", userId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(describeServerError(error, "读取超时生成任务失败。"), { cause: error })
  }
  return ((data ?? []) as GenerationJob[]).filter((job) => !job.sync_locked_until || Date.parse(job.sync_locked_until) < Date.now())
}

export async function recoverStaleGenerationJobs({ limit = 20 } = {}) {
  const jobs = await loadStaleGenerationJobs({ limit })
  const results = await Promise.allSettled(jobs.map(recoverStaleGenerationJob))
  return summarizeRecoveryResults(jobs.length, results)
}

export async function recoverStaleGenerationJob(job: GenerationJob) {
  if (isTerminalGenerationJobStatus(job.status)) return job

  if (!job.upstream_task_id) {
    return failGenerationJobWithRefund({
      jobId: job.id,
      reason: buildGenerationFailureRefundReason({
        error: generationTimeoutMessage,
        model: job.model,
        provider: job.provider,
        type: job.type,
      }),
    })
  }

  if (job.provider === "manju" && job.type === "image") {
    return failGenerationJobWithRefund({
      jobId: job.id,
      reason: buildGenerationFailureRefundReason({
        error: generationTimeoutMessage,
        model: job.model,
        provider: job.provider,
        type: job.type,
      }),
    })
  }

  if ((job.provider === "toapis" || job.provider === "grsai" || job.provider === "apimart") && job.type === "image") {
    return updateGenerationJob(job.id, {
      last_checked_at: new Date().toISOString(),
      last_sync_error: generationTimeoutMessage,
      next_check_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      sync_locked_until: null,
    })
  }

  try {
    if ((job.provider !== "yunwu" && job.provider !== "manju") || job.type !== "video") {
      return updateGenerationJob(job.id, {
        last_checked_at: new Date().toISOString(),
        last_sync_error: "旧上游任务已停止自动查询。",
        next_check_at: null,
        sync_locked_until: null,
      })
    }

    const result = job.provider === "manju"
      ? await getManjuVideoTaskStatus(job.upstream_task_id)
      : await getYunwuVideoTaskStatus(job.upstream_task_id, job.model)
    const resultUrls = result.videoUrl ? [result.videoUrl] : []
    const missingResultError =
      result.status === "completed" && resultUrls.length === 0 && shouldStopWaitingForVideoUrl(job)
        ? "任务已完成，但接口没有返回结果地址。"
        : ""
    const shouldRetryMissingVideoResult =
      job.type === "video" && result.status === "completed" && resultUrls.length === 0 && !missingResultError
    const taskError =
      result.taskError ||
      missingResultError
    const status: GenerationJobStatus =
      taskError && result.status === "completed" ? "failed" : shouldRetryMissingVideoResult ? "processing" : result.status

    if (!isTerminalGenerationJobStatus(status)) {
      if (isPastVideoHardDeadline(job)) {
        return failGenerationJobWithRefund({
          jobId: job.id,
          reason: buildGenerationFailureRefundReason({
            error: generationTimeoutMessage,
            model: job.model,
            provider: job.provider,
            type: job.type,
          }),
        })
      }

      return updateGenerationJob(job.id, {
        last_checked_at: new Date().toISOString(),
        last_sync_error: generationTimeoutMessage,
        next_check_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        sync_locked_until: null,
      })
    }

    if (status === "failed") {
      return failGenerationJobWithRefund({
        jobId: job.id,
        reason: buildGenerationFailureRefundReason({
          error: taskError,
          model: job.model,
          provider: job.provider,
          type: job.type,
        }),
      })
    }

    const completedAt = job.completed_at ?? new Date().toISOString()
    const nextJob = await updateActiveGenerationJob(job.id, {
      completed_at: completedAt,
      expires_at: job.expires_at ?? getGenerationJobExpiresAt(completedAt),
      last_checked_at: new Date().toISOString(),
      last_sync_error: null,
      next_check_at: new Date().toISOString(),
      result_urls: resultUrls.length > 0 ? resultUrls : job.result_urls,
      status,
      sync_locked_until: null,
      task_error: taskError || null,
    })

    if (!nextJob) {
      return (await loadGenerationJobForUser({ taskId: job.id, userId: job.user_id })) ?? job
    }

    return nextJob
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务状态查询失败。"
    console.warn("[Generation Recovery] final status query failed", {
      error: message,
      jobId: job.id,
      upstreamTaskId: job.upstream_task_id,
    })

    // 上游任务不存在，或已超过硬性截止时间，都不再继续查询，直接结束任务并退点。
    if (isManjuFatalTaskError(error) || isPastVideoHardDeadline(job)) {
      return failGenerationJobWithRefund({
        jobId: job.id,
        reason: buildGenerationFailureRefundReason({
          error: message,
          model: job.model,
          provider: job.provider,
          type: job.type,
        }),
      })
    }

    return updateGenerationJob(job.id, {
      check_attempts: job.check_attempts + 1,
      last_checked_at: new Date().toISOString(),
      last_sync_error: message,
      next_check_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      sync_locked_until: null,
    })
  }
}

function shouldStopWaitingForVideoUrl(job: GenerationJob) {
  if (job.type !== "video") return true
  return Date.now() - Date.parse(job.created_at) >= videoMissingResultRetryMs
}

function isPastVideoHardDeadline(job: GenerationJob) {
  if (job.type !== "video") return false
  const createdAt = Date.parse(job.created_at)
  if (!Number.isFinite(createdAt)) return false
  return Date.now() - createdAt >= videoHardFailTimeoutMs
}

export async function lockGenerationJobForSync(id: string, lockMs = 2 * 60 * 1000) {
  const now = new Date().toISOString()
  const lockUntil = new Date(Date.now() + lockMs).toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .update({
      sync_locked_until: lockUntil,
      updated_at: now,
    })
    .eq("id", id)
    .in("status", ["submitted", "processing"])
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`)
    .select(generationJobSelect)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "锁定生成任务失败。"), { cause: error })
  }
  return data as GenerationJob | null
}

export function normalizeJobTaskStatus(job: GenerationJob): NormalizedTaskStatus {
  const isImage = job.type === "image"

  return {
    ok: true,
    mode:
      job.provider === "mock"
        ? "mock"
        : job.provider === "yunwu"
          ? "yunwu"
          : job.provider === "grsai"
            ? "grsai"
            : job.provider === "toapis"
              ? "toapis"
              : job.provider === "apimart"
                ? "apimart"
                : job.provider === "manju"
                  ? "manju"
                  : job.provider === "vectorengine"
                    ? "vectorengine"
                    : "mock",
    taskId: job.id,
    status: job.status,
    progress: isTerminalGenerationJobStatus(job.status) ? 100 : 0,
    imageUrls: isImage ? job.result_urls : [],
    videoUrl: isImage ? "" : job.result_urls[0] ?? "",
    taskError: job.task_error ?? "",
    retryAfterMs: getGenerationJobRetryAfterMs(job),
    raw: job,
  }
}

export function getGenerationJobRetryAfterMs(job: GenerationJob) {
  if (job.sync_locked_until) {
    const lockRetryAfterMs = Date.parse(job.sync_locked_until) - Date.now()
    if (Number.isFinite(lockRetryAfterMs) && lockRetryAfterMs > 0) {
      return Math.min(lockRetryAfterMs, 30 * 1000)
    }
  }

  if (!job.last_sync_error) return undefined
  if (isTerminalGenerationJobStatus(job.status) || !job.next_check_at) return undefined

  const retryAfterMs = Date.parse(job.next_check_at) - Date.now()
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return undefined

  return retryAfterMs
}

export function isTerminalGenerationJobStatus(status: GenerationJobStatus) {
  return status === "completed" || status === "failed" || status === "partial_completed"
}

export function isExpiredGenerationJob(job: GenerationJob | null) {
  if (!job?.expires_at || !isTerminalGenerationJobStatus(job.status)) return false
  return Date.parse(job.expires_at) <= Date.now()
}

export async function deleteGenerationJobAndStoredAssets(job: GenerationJob) {
  const urls = getStorageCleanupUrls(job)
  const results = await Promise.allSettled(urls.map((url) => deleteGeneratedImageByPublicUrl(url)))
  const failed = results.filter((result) => result.status === "rejected")

  if (failed.length > 0) {
    throw new Error(`清理 ${failed.length}/${urls.length} 个生成文件失败。`)
  }

  const { error } = await getSupabaseServerClient().from("generation_jobs").delete().eq("id", job.id)
  if (error) {
    throw new Error(describeServerError(error, "删除生成历史失败。"), { cause: error })
  }
}

export async function deleteGenerationJobForUser({
  taskId,
  userId,
}: {
  taskId: string
  userId: string
}) {
  const job = await loadGenerationJobForUser({ taskId, userId })
  if (!job) return false

  await deleteGenerationJobAndStoredAssets(job)
  return true
}

export async function cleanupExpiredGenerationJobs({ limit = 50 } = {}) {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseServerClient()
    .from("generation_jobs")
    .select(generationJobSelect)
    .in("status", ["completed", "failed", "partial_completed"])
    .lte("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(limit)

  if (error) {
    if (isMissingSyncColumnError(error)) {
      return {
        checked: 0,
        deleted: 0,
        errors: 0,
        skipped: 0,
      }
    }

    throw new Error(describeServerError(error, "读取过期生成历史失败。"), { cause: error })
  }

  const jobs = (data ?? []) as GenerationJob[]
  const results = await Promise.allSettled(jobs.map(deleteGenerationJobAndStoredAssets))

  return results.reduce(
    (current, result) => {
      if (result.status === "fulfilled") {
        current.deleted += 1
      } else {
        current.errors += 1
      }
      return current
    },
    {
      checked: jobs.length,
      deleted: 0,
      errors: 0,
      skipped: 0,
    }
  )
}

function getStorageCleanupUrls(job: GenerationJob) {
  return Array.from(
    new Set([
      ...(job.storage_urls ?? []),
      ...(job.result_urls ?? []),
      ...(job.input_reference_images ?? []).map((image) => image.publicUrl),
    ])
  ).filter((url) =>
    getGeneratedStorageObjectPath(url)
  )
}

function summarizeRecoveryResults(checked: number, results: Array<PromiseSettledResult<GenerationJob>>) {
  return results.reduce(
    (current, result) => {
      if (result.status === "rejected") {
        current.errors += 1
      } else if (result.value.status === "failed") {
        current.recovered += 1
      } else {
        current.skipped += 1
      }
      return current
    },
    {
      checked,
      errors: 0,
      recovered: 0,
      skipped: 0,
    }
  )
}
