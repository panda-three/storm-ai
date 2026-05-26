import { NextResponse } from "next/server"
import {
  type CanvasDocumentUpdateInput,
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
    const input: CanvasDocumentUpdateInput = {}

    if (hasOwn(body, "appState")) input.appState = body.appState
    if (hasOwn(body, "elements")) input.elements = body.elements
    if (hasOwn(body, "files")) input.files = body.files
    if (hasOwn(body, "thumbnailUrl")) input.thumbnailUrl = body.thumbnailUrl
    if (hasOwn(body, "title")) input.title = body.title

    const document = await updateCanvasDocumentForUser({
      id,
      input,
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

function hasOwn(value: unknown, key: string) {
  return typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, key)
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
