import { assertApimartConfigured, getTaskStatus, isApimartRateLimitError } from "@/lib/apimart"
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
} from "@/lib/server-supabase"
import { buildGenerationFailureRefundReason } from "@/lib/generation-ledger"

const baseRetryMs = 60 * 1000
const maxRetryMs = 30 * 60 * 1000
const interactiveMinCheckMs = 4 * 1000
const interactiveLockMs = 45 * 1000

export interface SyncApimartGenerationJobResult {
  job: GenerationJob
  locked: boolean
  status: "skipped" | "synced" | "retryable_error"
}

export async function syncApimartGenerationJob(
  job: GenerationJob,
  { mode = "scheduled" }: { mode?: "interactive" | "scheduled" } = {}
): Promise<SyncApimartGenerationJobResult> {
  if (!isApimartAsyncImageJob(job) || isTerminalGenerationJobStatus(job.status)) {
    return { job, locked: false, status: "skipped" }
  }

  if (mode === "interactive" && !shouldSyncApimartJobInteractively(job)) {
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

  logApimartSync("start", {
    attempts: lockedJob.check_attempts,
    jobId: lockedJob.id,
    status: lockedJob.status,
    upstreamTaskId: lockedJob.upstream_task_id,
    userId: maskId(lockedJob.user_id),
  })

  try {
    assertApimartConfigured()
    const result = await getTaskStatus(lockedJob.upstream_task_id)
    const expectedResultCount = 1
    const upstreamResultUrls = uniqueUrls(result.imageUrls).slice(0, expectedResultCount)
    const persisted = await persistResultUrls({
      job: lockedJob,
      urls: upstreamResultUrls,
    })
    const resultUrls = persisted.resultUrls
    const missingResultError =
      result.status === "completed" && resultUrls.length === 0 ? "任务已完成，但接口没有返回图片地址。" : ""
    const taskError = missingResultError || persisted.error || (result.status === "failed" ? result.taskError : "")
    const status: GenerationJobStatus = missingResultError && result.status === "completed" ? "failed" : result.status

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
      logApimartSync("failed_refund", {
        error: taskError,
        jobId: lockedJob.id,
        upstreamTaskId: lockedJob.upstream_task_id,
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

    if (isTerminalGenerationJobStatus(status)) {
      await cleanupReferenceUrls(lockedJob.storage_urls)
    }

    logApimartSync(status === "completed" ? "completed" : "output", {
      imageUrls: resultUrls.length,
      jobId: updatedJob.id,
      status,
      upstreamTaskId: updatedJob.upstream_task_id,
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

    if (!isApimartRateLimitError(message)) {
      logApimartSync("retryable_error", {
        attempts,
        error: message,
        jobId: lockedJob.id,
        upstreamTaskId: lockedJob.upstream_task_id,
      })
    }

    return { job: nextJob, locked: true, status: "retryable_error" }
  }
}

export function shouldSyncApimartJobInteractively(job: GenerationJob) {
  if (isTerminalGenerationJobStatus(job.status) || !isApimartAsyncImageJob(job)) return false
  if (job.last_sync_error && job.next_check_at && Date.parse(job.next_check_at) > Date.now()) return false
  if (!job.last_checked_at) return true
  return Date.now() - Date.parse(job.last_checked_at) >= interactiveMinCheckMs
}

function isApimartAsyncImageJob(job: GenerationJob) {
  return job.provider === "apimart" && job.type === "image" && Boolean(job.upstream_task_id)
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
      logApimartSync("mirror_failed", {
        error: message,
        jobId: job.id,
        upstreamTaskId: job.upstream_task_id,
      })
    }
  }

  return {
    error: errors.length > 0 ? Array.from(new Set(errors)).join("；") : null,
    resultUrls,
    storageUrls,
  }
}

async function cleanupReferenceUrls(urls: string[]) {
  const referenceUrls = urls.filter((url) => getReferenceStorageObjectPath(url))
  if (referenceUrls.length === 0) return

  await Promise.all(referenceUrls.map((url) => deleteReferenceImageByPublicUrl(url))).catch((error) => {
    logApimartSync("reference_cleanup_failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.filter((url) => typeof url === "string" && url.length > 0)))
}

function getNextCheckAt(attempts: number) {
  const delay = Math.min(maxRetryMs, baseRetryMs * 2 ** Math.min(attempts, 5))
  return new Date(Date.now() + delay).toISOString()
}

function logApimartSync(label: string, value: unknown) {
  if (label.includes("error") || label.includes("failed") || label.includes("refund")) {
    console.warn(`[APIMart Sync] ${label}`, value)
    return
  }

  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[APIMart Sync] ${label}`, value)
}

function maskId(value: string) {
  if (!value) return ""
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}
