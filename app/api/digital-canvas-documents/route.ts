import { NextResponse } from "next/server"
import {
  createDigitalCanvasDocumentForUser,
  listDigitalCanvasDocumentsForUser,
} from "@/lib/digital-canvas-documents"
import { describeServerError, getServerErrorStatus, requireAuthenticatedUser } from "@/lib/server-supabase"

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const documents = await listDigitalCanvasDocumentsForUser(auth.userId)

    return NextResponse.json({ ok: true, documents })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: describeServerError(error, "读取数字画布列表失败。") },
      { status: getServerErrorStatus(error) }
    )
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const body = await request.json().catch(() => ({}))
    const document = await createDigitalCanvasDocumentForUser({
      title: body?.title,
      userId: auth.userId,
    })

    return NextResponse.json({ ok: true, document })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: describeServerError(error, "创建数字画布失败。") },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}
