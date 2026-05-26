import { NextResponse } from "next/server"
import { createCanvasVersionForUser, listCanvasVersionsForUser } from "@/lib/canvas-documents"
import { describeServerError, getServerErrorStatus, requireAuthenticatedUser } from "@/lib/server-supabase"

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await context.params
    const versions = await listCanvasVersionsForUser({
      canvasId: id,
      userId: auth.userId,
    })

    return NextResponse.json({
      ok: true,
      versions,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: describeServerError(error, "读取画布版本失败。"),
      },
      { status: getServerErrorStatus(error) }
    )
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const version = await createCanvasVersionForUser({
      canvasId: id,
      reason: String(body?.reason ?? "manual"),
      userId: auth.userId,
    })

    return NextResponse.json({
      ok: true,
      version,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: describeServerError(error, "保存画布版本失败。"),
      },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}
