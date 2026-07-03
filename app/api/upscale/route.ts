import { NextResponse } from "next/server"
import sharp from "sharp"
import { upscaleImageWithFal } from "@/lib/fal-upscale"
import { getServerErrorStatus, requireAuthenticatedUser } from "@/lib/server-supabase"
import { getUpscaleDailyUsage, recordUpscaleSuccess } from "@/lib/upscale-quota"
import { normalizeUpscaleScale, resolveUpscaleScale, validateUpscaleFile } from "@/lib/upscale-policy"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request)
    const body = await request.formData()
    const file = body.get("image")
    let requestedScale: 2 | 4
    try {
      requestedScale = normalizeUpscaleScale(body.get("scale") ?? 2)
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "请选择 2x 或 4x。" },
        { status: 400 }
      )
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "请上传一张图片。" }, { status: 400 })
    }

    const fileValidation = validateUpscaleFile(file)
    if (!fileValidation.ok) {
      return NextResponse.json({ ok: false, error: fileValidation.error }, { status: 400 })
    }

    const quota = await getUpscaleDailyUsage(auth.userId)
    if (quota.remainingToday <= 0) {
      return NextResponse.json(
        { ok: false, error: "今日高清放大额度已用完。", remainingToday: 0, usedToday: quota.usedToday },
        { status: 429 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const metadata = await sharp(buffer).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (width <= 0 || height <= 0) {
      return NextResponse.json({ ok: false, error: "无法读取图片尺寸，请换一张图片。" }, { status: 400 })
    }

    const scaleResolution = resolveUpscaleScale({ height, requestedScale, width })
    if (!scaleResolution.ok) {
      return NextResponse.json({ ok: false, error: scaleResolution.error }, { status: 400 })
    }

    const result = await upscaleImageWithFal({
      imageBuffer: buffer,
      mimeType: file.type,
      scale: scaleResolution.actualScale,
    })
    const updatedQuota = await recordUpscaleSuccess(auth.userId)

    return NextResponse.json({
      ok: true,
      actualScale: scaleResolution.actualScale,
      fileName: result.fileName,
      image: {
        contentType: result.contentType,
        height: result.height,
        url: result.imageUrl,
        width: result.width,
      },
      imageUrl: result.imageUrl,
      remainingToday: updatedQuota.remainingToday,
      requestedScale,
      usedToday: updatedQuota.usedToday,
      warning: scaleResolution.warning,
    })
  } catch (error) {
    const status = getServerErrorStatus(error, 500)
    const message = error instanceof Error && error.message ? error.message : "高清放大请求失败。"
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
