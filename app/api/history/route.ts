import { NextResponse } from "next/server"
import { syncApimartGenerationJob } from "@/lib/apimart-task-sync"
import { syncGrsaiGenerationJob } from "@/lib/grsai-task-sync"
import { syncManjuGenerationJob } from "@/lib/manju-task-sync"
import { syncYunwuGenerationJob } from "@/lib/yunwu-task-sync"
import { syncToapisGenerationJob } from "@/lib/toapis-task-sync"
import {
  loadGenerationJobsForUser,
  loadInteractiveApimartGenerationJobsForUser,
  loadInteractiveGrsaiGenerationJobsForUser,
  loadInteractiveManjuGenerationJobsForUser,
  loadInteractiveToapisGenerationJobsForUser,
  loadInteractiveYunwuGenerationJobsForUser,
  recoverStaleGenerationJobsForUser,
} from "@/lib/generation-jobs"
import { generationJobToProjectItem } from "@/lib/project-history"
import { getServerErrorStatus, requireAuthenticatedUser } from "@/lib/server-supabase"

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const [yunwuJobsToSync, toapisJobsToSync, apimartJobsToSync, grsaiJobsToSync, manjuJobsToSync] = await Promise.all([
      loadInteractiveYunwuGenerationJobsForUser({ userId: auth.userId }),
      loadInteractiveToapisGenerationJobsForUser({ userId: auth.userId }),
      loadInteractiveApimartGenerationJobsForUser({ userId: auth.userId }),
      loadInteractiveGrsaiGenerationJobsForUser({ userId: auth.userId }),
      loadInteractiveManjuGenerationJobsForUser({ userId: auth.userId }),
    ])
    const [yunwuResults, toapisResults, apimartResults, grsaiResults, manjuResults] = await Promise.all([
      Promise.allSettled(yunwuJobsToSync.map((job) => syncYunwuGenerationJob(job, { mode: "interactive" }))),
      Promise.allSettled(toapisJobsToSync.map((job) => syncToapisGenerationJob(job, { mode: "interactive" }))),
      Promise.allSettled(apimartJobsToSync.map((job) => syncApimartGenerationJob(job, { mode: "interactive" }))),
      Promise.allSettled(grsaiJobsToSync.map((job) => syncGrsaiGenerationJob(job, { mode: "interactive" }))),
      Promise.allSettled(manjuJobsToSync.map((job) => syncManjuGenerationJob(job, { mode: "interactive" }))),
    ])
    logHistorySync("interactive", {
      apimart: summarizeSettledSync(apimartJobsToSync.length, apimartResults),
      grsai: summarizeSettledSync(grsaiJobsToSync.length, grsaiResults),
      manju: summarizeSettledSync(manjuJobsToSync.length, manjuResults),
      toapis: summarizeSettledSync(toapisJobsToSync.length, toapisResults),
      yunwu: summarizeSettledSync(yunwuJobsToSync.length, yunwuResults),
      userId: maskId(auth.userId),
    })
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

function summarizeSettledSync(checked: number, results: PromiseSettledResult<unknown>[]) {
  return results.reduce(
    (current, result) => {
      if (result.status === "rejected") {
        current.errors += 1
      }
      return current
    },
    {
      checked,
      errors: 0,
    }
  )
}

function logHistorySync(label: string, value: unknown) {
  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[History Sync] ${label}`, value)
}

function maskId(value: string) {
  if (!value) return ""
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}
