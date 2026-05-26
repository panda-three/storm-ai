import { NextResponse } from "next/server"
import { createCanvasThumbnailUploadForUser } from "@/lib/canvas-documents"
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
    const upload = await createCanvasThumbnailUploadForUser({
      canvasId: id,
      input: {
        size: Number(body?.size),
        type: String(body?.type ?? ""),
      },
      userId: auth.userId,
    })

    return NextResponse.json({
      ok: true,
      upload,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: describeServerError(error, "创建画布缩略图上传地址失败。"),
      },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}
