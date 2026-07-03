import { getGrsaiImageTaskStatus, isGrsaiRateLimitError } from "@/lib/grsai"
import {
  failGenerationJobWithRefund,
  getGenerationJobExpiresAt,
  isTerminalGenerationJobStatus,
  lockGenerationJobForSync,
  loadGenerationJobForUser,
  updateActiveGenerationJob,
  updateGenerationJob,
  type GenerationJob,
  type GenerationJobStatus,
} from "@/lib/generation-jobs"
import {
  deleteReferenceImageByPublicUrl,
  getGeneratedStorageObjectPath,
  getReferenceStorageObjectPath,
  persistRemoteGeneratedImage,
  refundGenerationCredits,
} from "@/lib/server-supabase"
import {
  buildGenerationFailureRefundReason,
  buildGenerationPartialFailureRefundReason,
} from "@/lib/generation-ledger"

const baseRetryMs = 60 * 1000
const maxRetryMs = 30 * 60 * 1000
const interactiveMinCheckMs = 10 * 1000
const interactiveLockMs = 45 * 1000

export interface SyncGrsaiGenerationJobResult {
  job: GenerationJob
  locked: boolean
  status: "skipped" | "synced" | "retryable_error"
}

export async function syncGrsaiGenerationJob(
  job: GenerationJob,
  { mode = "scheduled" }: { mode?: "interactive" | "scheduled" } = {}
): Promise<SyncGrsaiGenerationJobResult> {
  if (!isGrsaiAsyncImageJob(job) || isTerminalGenerationJobStatus(job.status)) {
    return { job, locked: false, status: "skipped" }
  }

  if (mode === "interactive" && !shouldSyncGrsaiJobInteractively(job)) {
    return { job, locked: false, status: "skipped" }
  }

  const lockedJob = await lockGenerationJobForSync(job.id, mode === "interactive" ? interactiveLockMs : undefined)
  if (!lockedJob) {
    const latestJob = await loadGenerationJobForUser({ taskId: job.id, userId: job.user_id })
    return { job: latestJob ?? job, locked: false, status: "skipped" }
  }

  if (!lockedJob.upstream_task_id) {
    return { job: lockedJob, locked: true, status: "skipped" }
  }

  logGrsaiSync("start", {
    attempts: lockedJob.check_attempts,
    jobId: lockedJob.id,
    status: lockedJob.status,
    upstreamTaskId: maskId(lockedJob.upstream_task_id),
    userId: maskId(lockedJob.user_id),
  })

  try {
    const result = await getGrsaiImageTaskStatus(lockedJob.upstream_task_id)
    const expectedResultCount = Math.max(1, lockedJob.expected_result_count)
    const upstreamResultUrls = uniqueUrls(result.imageUrls).slice(0, expectedResultCount)
    const persisted = await persistResultUrls({
      job: lockedJob,
      urls: upstreamResultUrls,
    })
    const resultUrls = persisted.resultUrls
    const missingResultError =
      result.status === "completed" && resultUrls.length === 0 ? "任务已完成，但接口没有返回图片地址。" : ""
    const isPartialImageResult = result.status === "completed" && resultUrls.length > 0 && resultUrls.length < expectedResultCount
    const partialResultError = isPartialImageResult
      ? buildPartialImageMessage({
          amount: lockedJob.amount,
          expectedResultCount,
          successCount: resultUrls.length,
          sourceLabel: "GrsAi completed 结果",
          upstreamErrors: [persisted.error].filter((error): error is string => Boolean(error)),
        })
      : ""
    const taskError = missingResultError || partialResultError || persisted.error || (result.status === "failed" ? result.taskError : "")
    const status: GenerationJobStatus =
      missingResultError && result.status === "completed"
        ? "failed"
        : isPartialImageResult
          ? "partial_completed"
          : result.status

    if (status === "failed" && lockedJob.status !== "failed") {
      const failedJob = await failGenerationJobWithRefund({
        jobId: lockedJob.id,
        reason: buildGenerationFailureRefundReason({
          error: taskError,
          model: lockedJob.model,
          provider: lockedJob.provider,
          type: lockedJob.type,
        }),
      })
      await cleanupReferenceUrls(lockedJob.storage_urls)
      logGrsaiSync("failed_refund", {
        error: taskError,
        jobId: lockedJob.id,
        upstreamTaskId: maskId(lockedJob.upstream_task_id),
      })
      return { job: failedJob, locked: true, status: "synced" }
    }

    const now = new Date().toISOString()
    const completedAt = isTerminalGenerationJobStatus(status) ? lockedJob.completed_at ?? now : lockedJob.completed_at
    const updatedJob = await updateActiveGenerationJob(lockedJob.id, {
      check_attempts: 0,
      completed_at: completedAt,
      expires_at:
        isTerminalGenerationJobStatus(status) && completedAt
          ? lockedJob.expires_at ?? getGenerationJobExpiresAt(completedAt)
          : lockedJob.expires_at,
      last_checked_at: now,
      last_sync_error: persisted.error,
      next_check_at: isTerminalGenerationJobStatus(status) ? now : getNextCheckAt(0),
      result_urls: resultUrls.length > 0 ? resultUrls : lockedJob.result_urls,
      status,
      storage_urls: Array.from(new Set([...(lockedJob.storage_urls ?? []), ...persisted.storageUrls])),
      sync_locked_until: null,
      task_error: taskError || null,
    })

    if (!updatedJob) {
      return { job: lockedJob, locked: true, status: "skipped" }
    }

    if (status === "partial_completed" && lockedJob.status !== "partial_completed") {
      await refundJobCredits({
        amount: calculatePartialRefundAmount(lockedJob.amount, resultUrls.length, expectedResultCount),
        job: lockedJob,
        reason: buildGenerationPartialFailureRefundReason({
          expectedCount: expectedResultCount,
          failedCount: expectedResultCount - resultUrls.length,
          model: lockedJob.model,
          provider: lockedJob.provider,
          type: lockedJob.type,
        }),
        reference: buildPartialRefundReference(lockedJob.reference, resultUrls.length, expectedResultCount),
      })
    }

    if (isTerminalGenerationJobStatus(status)) {
      await cleanupReferenceUrls(lockedJob.storage_urls)
    }

    logGrsaiSync(status === "partial_completed" ? "partial_completed" : status === "completed" ? "completed" : "output", {
      imageUrls: resultUrls.length,
      jobId: updatedJob.id,
      status,
      upstreamTaskId: updatedJob.upstream_task_id ? maskId(updatedJob.upstream_task_id) : "",
    })

    return { job: updatedJob, locked: true, status: "synced" }
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务状态查询失败。"
    const attempts = lockedJob.check_attempts + 1
    const now = new Date().toISOString()
    const nextJob = await updateGenerationJob(lockedJob.id, {
      check_attempts: attempts,
      last_checked_at: now,
      last_sync_error: message,
      next_check_at: getNextCheckAt(attempts),
      sync_locked_until: null,
    })

    if (!isGrsaiRateLimitError(message)) {
      logGrsaiSync("retryable_error", {
        attempts,
        error: message,
        jobId: lockedJob.id,
        upstreamTaskId: maskId(lockedJob.upstream_task_id),
      })
    }

    return { job: nextJob, locked: true, status: "retryable_error" }
  }
}

async function cleanupReferenceUrls(urls: string[]) {
  const referenceUrls = urls.filter((url) => getReferenceStorageObjectPath(url))
  if (referenceUrls.length === 0) return

  await Promise.all(referenceUrls.map((url) => deleteReferenceImageByPublicUrl(url))).catch((error) => {
    logGrsaiSync("reference_cleanup_failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

export function shouldSyncGrsaiJobNow(job: GenerationJob) {
  if (isTerminalGenerationJobStatus(job.status) || !isGrsaiAsyncImageJob(job)) return false
  if (!job.next_check_at) return true
  return Date.parse(job.next_check_at) <= Date.now()
}

export function shouldSyncGrsaiJobInteractively(job: GenerationJob) {
  if (isTerminalGenerationJobStatus(job.status) || !isGrsaiAsyncImageJob(job)) return false
  if (job.last_sync_error && job.next_check_at && Date.parse(job.next_check_at) > Date.now()) return false
  if (!job.last_checked_at) return true
  return Date.now() - Date.parse(job.last_checked_at) >= interactiveMinCheckMs
}

function isGrsaiAsyncImageJob(job: GenerationJob) {
  return job.provider === "grsai" && job.type === "image" && Boolean(job.upstream_task_id)
}

async function persistResultUrls({
  job,
  urls,
}: {
  job: GenerationJob
  urls: string[]
}) {
  const resultUrls: string[] = []
  const storageUrls: string[] = []
  const errors: string[] = []

  for (const url of urls) {
    if (getGeneratedStorageObjectPath(url)) {
      resultUrls.push(url)
      storageUrls.push(url)
      continue
    }

    try {
      const savedUrl = await persistRemoteGeneratedImage({
        sourceUrl: url,
        userId: job.user_id,
      })
      resultUrls.push(savedUrl)
      storageUrls.push(savedUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成图片转存失败。"
      errors.push(message)
      resultUrls.push(url)
      logGrsaiSync("mirror_failed", {
        error: message,
        jobId: job.id,
        upstreamTaskId: job.upstream_task_id ? maskId(job.upstream_task_id) : "",
      })
    }
  }

  return {
    error: errors.length > 0 ? Array.from(new Set(errors)).join("；") : null,
    resultUrls,
    storageUrls,
  }
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.filter((url) => typeof url === "string" && url.length > 0)))
}

function calculatePartialRefundAmount(amount: number, successCount: number, expectedResultCount: number) {
  if (amount <= 0 || expectedResultCount <= 0) return 0
  const failedCount = Math.max(0, expectedResultCount - successCount)
  return Math.floor((amount * failedCount) / expectedResultCount)
}

function buildPartialRefundReference(reference: string, successCount: number, expectedResultCount: number) {
  return `${reference}_partial_${successCount}_of_${expectedResultCount}`
}

function buildPartialImageMessage({
  amount,
  expectedResultCount,
  sourceLabel = "上游 completed 结果",
  successCount,
  upstreamErrors = [],
}: {
  amount: number
  expectedResultCount: number
  sourceLabel?: string
  successCount: number
  upstreamErrors?: string[]
}) {
  const failedCount = Math.max(0, expectedResultCount - successCount)
  const refundAmount = calculatePartialRefundAmount(amount, successCount, expectedResultCount)
  const refundText = refundAmount > 0 ? `已退还 ${refundAmount.toLocaleString()} 点。` : "本次未扣点，无需退款。"
  const details =
    upstreamErrors.length > 0
      ? `具体原因：${upstreamErrors.join("；")}`
      : `${sourceLabel}只解析到 ${successCount}/${expectedResultCount} 个图片地址；如果上游后台显示已全部生成，通常是返回字段未被解析或图片地址缺失。`
  return `已生成 ${successCount}/${expectedResultCount} 张，失败 ${failedCount} 张，${refundText} ${details}`
}

async function refundJobCredits({
  amount,
  job,
  reason,
  reference,
}: {
  amount: number
  job: GenerationJob
  reason: string
  reference: string
}) {
  if (amount <= 0) return

  await refundGenerationCredits({
    amount,
    reason,
    reference,
    userId: job.user_id,
  })
}

function getNextCheckAt(attempts: number) {
  const delay = Math.min(maxRetryMs, baseRetryMs * 2 ** Math.min(attempts, 5))
  return new Date(Date.now() + delay).toISOString()
}

function logGrsaiSync(label: string, value: unknown) {
  if (label.includes("error") || label.includes("failed") || label.includes("refund")) {
    console.warn(`[GrsAi Sync] ${label}`, value)
    return
  }

  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[GrsAi Sync] ${label}`, value)
}

function maskId(value: string) {
  if (!value) return ""
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}
