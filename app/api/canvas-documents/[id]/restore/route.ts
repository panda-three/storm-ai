import { NextResponse } from "next/server"
import { restoreCanvasVersionForUser } from "@/lib/canvas-documents"
import { describeServerError, getServerErrorStatus, requireAuthenticatedUser } from "@/lib/server-supabase"

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const document = await restoreCanvasVersionForUser({
      canvasId: id,
      userId: auth.userId,
      versionId: String(body?.versionId ?? ""),
    })

    return NextResponse.json({
      ok: true,
      document,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: describeServerError(error, "恢复画布版本失败。"),
      },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}
