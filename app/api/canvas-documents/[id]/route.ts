import { NextResponse } from "next/server"
import {
  getCanvasDocumentForUser,
  softDeleteCanvasDocumentForUser,
  updateCanvasDocumentForUser,
} from "@/lib/canvas-documents"
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
    const document = await getCanvasDocumentForUser({
      id,
      userId: auth.userId,
    })

    return NextResponse.json({
      ok: true,
      document,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: describeServerError(error, "读取画布失败。"),
      },
      { status: getServerErrorStatus(error) }
    )
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const document = await updateCanvasDocumentForUser({
      id,
      input: {
        appState: body?.appState,
        elements: body?.elements,
        files: body?.files,
        thumbnailUrl: body?.thumbnailUrl,
        title: body?.title,
      },
      userId: auth.userId,
    })

    return NextResponse.json({
      ok: true,
      document,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: describeServerError(error, "保存画布失败。"),
      },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await context.params
    await softDeleteCanvasDocumentForUser({
      id,
      userId: auth.userId,
    })

    return NextResponse.json({
      ok: true,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: describeServerError(error, "删除画布失败。"),
      },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}
