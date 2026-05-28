import { NextResponse } from "next/server"
import {
  failGenerationJobWithRefund,
  deleteGenerationJobForUser,
  getGenerationJobExpiresAt,
  loadGenerationJobForUser,
  updateActiveGenerationJob,
  normalizeJobTaskStatus,
  recoverStaleGenerationJob,
  isTerminalGenerationJobStatus,
  synchronousImageOrphanTimeoutMs,
  asyncVideoTimeoutMs,
  asyncImageTimeoutMs,
  type GenerationJob,
} from "@/lib/generation-jobs"
import { syncApimartGenerationJob } from "@/lib/apimart-task-sync"
import { getYunwuVideoTaskStatus } from "@/lib/yunwu"
import { syncYunwuGenerationJob } from "@/lib/yunwu-task-sync"
import { syncToapisGenerationJob } from "@/lib/toapis-task-sync"
import { getServerErrorStatus, requireAuthenticatedUser } from "@/lib/server-supabase"
import { buildGenerationFailureRefundReason } from "@/lib/generation-ledger"

const videoMissingResultRetryMs = 90 * 1000

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await params

    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少任务 ID。" }, { status: 400 })
    }

    const job = await loadGenerationJobForUser({ taskId: id, userId: auth.userId })
    if (!job) {
      if (id.startsWith("task_")) {
        return NextResponse.json(createOrphanedTaskStatus(id), { status: 410 })
      }

      return NextResponse.json({ ok: false, error: "任务不存在或无权访问。" }, { status: 404 })
    }

    const recoveredJob = await recoverStaleGenerationJobIfDue(job)

    if (isTerminalGenerationJobStatus(recoveredJob.status)) {
      return NextResponse.json(normalizeJobTaskStatus(recoveredJob))
    }

    if (!recoveredJob.upstream_task_id) {
      return NextResponse.json(normalizeJobTaskStatus(recoveredJob))
    }

    if (recoveredJob.provider === "yunwu" && recoveredJob.type === "video") {
      const result = await getYunwuVideoTaskStatus(recoveredJob.upstream_task_id, recoveredJob.model).catch(async (error) => {
        const message = error instanceof Error ? error.message : "任务状态查询失败。"
        return updateActiveGenerationJob(recoveredJob.id, {
          last_checked_at: new Date().toISOString(),
          last_sync_error: message,
          sync_locked_until: null,
        })
      })

      if (!result || "id" in result) {
        return NextResponse.json(normalizeJobTaskStatus(result ?? recoveredJob))
      }

      const resultUrls = result.videoUrl ? [result.videoUrl] : []
      const missingResultError =
        result.status === "completed" && resultUrls.length === 0 && shouldStopWaitingForVideoUrl(recoveredJob)
          ? "任务已完成，但接口没有返回视频地址。"
          : ""
      const shouldRetryMissingVideoResult = result.status === "completed" && resultUrls.length === 0 && !missingResultError
      const taskError = result.taskError || missingResultError
      const status = taskError && result.status === "completed" ? "failed" : shouldRetryMissingVideoResult ? "processing" : result.status

      if (shouldRetryMissingVideoResult) {
        console.warn("[Tasks] video completed without url, retrying", {
          jobId: recoveredJob.id,
          provider: recoveredJob.provider,
          upstreamTaskId: recoveredJob.upstream_task_id,
        })
      }

      if (status === "failed") {
        const failedJob = await failGenerationJobWithRefund({
          jobId: recoveredJob.id,
          reason: buildGenerationFailureRefundReason({
            error: taskError,
            model: recoveredJob.model,
            provider: recoveredJob.provider,
            type: recoveredJob.type,
          }),
        })
        return NextResponse.json(normalizeJobTaskStatus(failedJob))
      }

      const completedAt = status === "completed" ? recoveredJob.completed_at ?? new Date().toISOString() : recoveredJob.completed_at
      const nextJob = await updateActiveGenerationJob(recoveredJob.id, {
        completed_at: completedAt,
        expires_at: status === "completed" && completedAt ? recoveredJob.expires_at ?? getGenerationJobExpiresAt(completedAt) : recoveredJob.expires_at,
        last_checked_at: new Date().toISOString(),
        last_sync_error: null,
        next_check_at: status === "completed" ? new Date().toISOString() : recoveredJob.next_check_at,
        result_urls: resultUrls.length > 0 ? resultUrls : recoveredJob.result_urls,
        status,
        sync_locked_until: null,
        task_error: taskError || null,
      })

      return NextResponse.json(normalizeJobTaskStatus(nextJob ?? recoveredJob))
    }

    if (recoveredJob.provider === "toapis") {
      logTaskSyncRoute("dispatch", {
        jobId: recoveredJob.id,
        provider: recoveredJob.provider,
        upstreamTaskId: recoveredJob.upstream_task_id,
      })
      const result = await syncToapisGenerationJob(recoveredJob, { mode: "interactive" })
      return NextResponse.json(normalizeJobTaskStatus(result.job))
    }

    if (recoveredJob.provider === "apimart") {
      logTaskSyncRoute("dispatch", {
        jobId: recoveredJob.id,
        provider: recoveredJob.provider,
        upstreamTaskId: recoveredJob.upstream_task_id,
      })
      const result = await syncApimartGenerationJob(recoveredJob, { mode: "interactive" })
      return NextResponse.json(normalizeJobTaskStatus(result.job))
    }

    if (recoveredJob.provider === "yunwu") {
      logTaskSyncRoute("dispatch", {
        jobId: recoveredJob.id,
        provider: recoveredJob.provider,
        upstreamTaskId: recoveredJob.upstream_task_id,
      })
      const result = await syncYunwuGenerationJob(recoveredJob, { mode: "interactive" })
      return NextResponse.json(normalizeJobTaskStatus(result.job))
    }

    return NextResponse.json(normalizeJobTaskStatus(recoveredJob))
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务状态查询失败。"
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: getServerErrorStatus(error) }
    )
  }
}

function shouldStopWaitingForVideoUrl(job: GenerationJob) {
  return Date.now() - Date.parse(job.created_at) >= videoMissingResultRetryMs
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await params

    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少任务 ID。" }, { status: 400 })
    }

    const deleted = await deleteGenerationJobForUser({ taskId: id, userId: auth.userId })
    return NextResponse.json({ deleted, ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除生成历史失败。"
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: getServerErrorStatus(error) }
    )
  }
}

async function recoverStaleGenerationJobIfDue(job: GenerationJob) {
  if (isTerminalGenerationJobStatus(job.status)) return job

  const ageMs = Date.now() - Date.parse(job.created_at)
  const isSynchronousImageOrphan =
    (job.provider === "yunwu" || job.provider === "vectorengine") &&
    job.type === "image" &&
    !job.upstream_task_id &&
    ageMs >= synchronousImageOrphanTimeoutMs
  const isAsyncVideoTimeout = job.type === "video" && Boolean(job.upstream_task_id) && ageMs >= asyncVideoTimeoutMs
  const isAsyncImageTimeout =
    (job.provider === "toapis" || job.provider === "apimart") &&
    job.type === "image" &&
    Boolean(job.upstream_task_id) &&
    ageMs >= asyncImageTimeoutMs

  if (!isSynchronousImageOrphan && !isAsyncVideoTimeout && !isAsyncImageTimeout) {
    return job
  }

  return recoverStaleGenerationJob(job)
}

function logTaskSyncRoute(label: string, value: unknown) {
  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[Tasks] ${label}`, value)
}

function createOrphanedTaskStatus(taskId: string) {
  const message = "旧任务没有本地生成记录，已停止自动查询。"

  return {
    ok: false,
    mode: "yunwu",
    taskId,
    status: "failed",
    progress: 0,
    imageUrls: [],
    videoUrl: "",
    orphaned: true,
    taskError: message,
    error: message,
    raw: {},
  }
}
