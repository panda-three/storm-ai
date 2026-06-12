import { NextResponse } from "next/server"
import { validateReferenceImageMetadata } from "@/lib/reference-images"
import { describeServerError, getServerErrorStatus, requireAuthenticatedUser, uploadReferenceImage } from "@/lib/server-supabase"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.includes("multipart/form-data")) {
      throw new Error("参考图上传请求格式无效。")
    }

    const body = await request.formData()
    const file = body.get("file")
    if (!(file instanceof File) || file.size <= 0) {
      throw new Error("参考图文件无效。")
    }

    validateReferenceImageMetadata({ size: file.size, type: file.type })
    const uploaded = await uploadReferenceImage({
      buffer: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
      name: file.name || "reference-image",
      userId: auth.userId,
    })

    return NextResponse.json({
      ok: true,
      ...uploaded,
    })
  } catch (error) {
    const message = describeServerError(error, "参考图上传失败。")

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: getServerErrorStatus(error, 400) }
    )
  }
}
