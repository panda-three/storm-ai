import { NextResponse } from "next/server"
import {
  deleteGenerationJobForUser,
  loadGenerationJobForUser,
  normalizeJobTaskStatus,
  recoverStaleGenerationJob,
  isTerminalGenerationJobStatus,
  synchronousImageOrphanTimeoutMs,
  asyncVideoTimeoutMs,
  asyncImageTimeoutMs,
  manjuImageTimeoutMs,
  type GenerationJob,
} from "@/lib/generation-jobs"
import { syncApimartGenerationJob } from "@/lib/apimart-task-sync"
import { syncGrsaiGenerationJob } from "@/lib/grsai-task-sync"
import { syncManjuGenerationJob } from "@/lib/manju-task-sync"
import { syncYunwuGenerationJob } from "@/lib/yunwu-task-sync"
import { syncToapisGenerationJob } from "@/lib/toapis-task-sync"
import { getServerErrorStatus, requireAuthenticatedUser } from "@/lib/server-supabase"

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

    if (recoveredJob.provider === "grsai") {
      logTaskSyncRoute("dispatch", {
        jobId: recoveredJob.id,
        provider: recoveredJob.provider,
        upstreamTaskId: recoveredJob.upstream_task_id,
      })
      const result = await syncGrsaiGenerationJob(recoveredJob, { mode: "interactive" })
      return NextResponse.json(normalizeJobTaskStatus(result.job))
    }

    if (recoveredJob.provider === "manju") {
      logTaskSyncRoute("dispatch", {
        jobId: recoveredJob.id,
        provider: recoveredJob.provider,
        upstreamTaskId: recoveredJob.upstream_task_id,
      })
      const result = await syncManjuGenerationJob(recoveredJob, { mode: "interactive" })
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
    (job.provider === "toapis" || job.provider === "grsai" || job.provider === "apimart") &&
    job.type === "image" &&
    Boolean(job.upstream_task_id) &&
    ageMs >= asyncImageTimeoutMs
  const isManjuImageTimeout =
    job.provider === "manju" &&
    job.type === "image" &&
    Boolean(job.upstream_task_id) &&
    ageMs >= manjuImageTimeoutMs

  if (!isSynchronousImageOrphan && !isAsyncVideoTimeout && !isAsyncImageTimeout && !isManjuImageTimeout) {
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
