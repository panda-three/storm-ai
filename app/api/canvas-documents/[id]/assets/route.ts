import { NextResponse } from "next/server"
import { createCanvasAssetBindingForUser, listCanvasAssetsForUser } from "@/lib/canvas-documents"
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
    const assets = await listCanvasAssetsForUser({
      canvasId: id,
      userId: auth.userId,
    })

    return NextResponse.json({
      ok: true,
      assets,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: describeServerError(error, "读取画布素材失败。"),
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
    const asset = await createCanvasAssetBindingForUser({
      canvasId: id,
      input: {
        externalUrl: body?.externalUrl,
        height: Number(body?.height),
        mimeType: body?.mimeType,
        sourceKey: body?.sourceKey,
        sourceProjectId: body?.sourceProjectId,
        sourceTaskId: body?.sourceTaskId,
        sourceType: body?.sourceType,
        storageUrl: body?.storageUrl,
        width: Number(body?.width),
      },
      userId: auth.userId,
    })

    return NextResponse.json({
      ok: true,
      asset,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: describeServerError(error, "登记画布素材失败。"),
      },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}
