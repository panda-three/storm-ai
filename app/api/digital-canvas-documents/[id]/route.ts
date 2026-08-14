import { NextResponse } from "next/server"
import {
  type DigitalCanvasDocumentUpdateInput,
  getDigitalCanvasDocumentForUser,
  softDeleteDigitalCanvasDocumentForUser,
  updateDigitalCanvasDocumentForUser,
} from "@/lib/digital-canvas-documents"
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
    const document = await getDigitalCanvasDocumentForUser({ id, userId: auth.userId })

    return NextResponse.json({ ok: true, document })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: describeServerError(error, "读取数字画布失败。") },
      { status: getServerErrorStatus(error) }
    )
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const input: DigitalCanvasDocumentUpdateInput = {}

    if (hasOwn(body, "title")) input.title = body.title
    if (hasOwn(body, "graph")) input.graph = body.graph
    if (hasOwn(body, "thumbnailUrl")) input.thumbnailUrl = body.thumbnailUrl

    const document = await updateDigitalCanvasDocumentForUser({ id, input, userId: auth.userId })

    return NextResponse.json({ ok: true, document })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: describeServerError(error, "保存数字画布失败。") },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const { id } = await context.params
    await softDeleteDigitalCanvasDocumentForUser({ id, userId: auth.userId })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: describeServerError(error, "删除数字画布失败。") },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}

function hasOwn(value: unknown, key: string) {
  return typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, key)
}
