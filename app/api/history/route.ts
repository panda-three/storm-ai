import { NextResponse } from "next/server"
import { syncYunwuGenerationJob } from "@/lib/yunwu-task-sync"
import { loadGenerationJobsForUser, loadInteractiveYunwuGenerationJobsForUser, recoverStaleGenerationJobsForUser } from "@/lib/generation-jobs"
import { generationJobToProjectItem } from "@/lib/project-history"
import { getServerErrorStatus, requireAuthenticatedUser } from "@/lib/server-supabase"

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const jobsToSync = await loadInteractiveYunwuGenerationJobsForUser({ userId: auth.userId })
    await Promise.allSettled(jobsToSync.map((job) => syncYunwuGenerationJob(job, { mode: "interactive" })))
    await recoverStaleGenerationJobsForUser({ userId: auth.userId })
    const jobs = await loadGenerationJobsForUser({ userId: auth.userId })

    return NextResponse.json({
      ok: true,
      projects: jobs.map(generationJobToProjectItem),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取生成历史失败。"

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: getServerErrorStatus(error) }
    )
  }
}
