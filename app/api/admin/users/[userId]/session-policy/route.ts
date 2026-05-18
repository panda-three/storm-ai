import { NextResponse } from "next/server"
import { describeServerError, getServerErrorStatus, getSupabaseServerClient, requireAdminUser } from "@/lib/server-supabase"

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const admin = await requireAdminUser(request)
    const { userId } = await params
    const payload = await request.json().catch(() => ({}))
    const allowMultiDeviceSessions = payload.allowMultiDeviceSessions

    if (!userId) {
      return NextResponse.json({ ok: false, error: "缺少用户 ID。" }, { status: 400 })
    }

    if (typeof allowMultiDeviceSessions !== "boolean") {
      return NextResponse.json({ ok: false, error: "登录策略参数无效。" }, { status: 400 })
    }

    const now = new Date().toISOString()
    const supabase = getSupabaseServerClient()
    const { data, error } = await supabase
      .from("user_accounts")
      .update({
        allow_multi_device_sessions: allowMultiDeviceSessions,
        updated_at: now,
      })
      .eq("user_id", userId)
      .select("user_id")
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ ok: false, error: "用户不存在。" }, { status: 404 })
    }

    if (!allowMultiDeviceSessions && userId !== admin.userId) {
      const { error: revokeSessionError } = await supabase
        .from("user_active_sessions")
        .update({
          revoked_at: now,
          revoked_by: admin.userId,
          revoked_reason: "single_device_policy_enabled",
          updated_at: now,
        })
        .eq("user_id", userId)
        .is("revoked_at", null)

      if (revokeSessionError) throw revokeSessionError
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = describeServerError(error, "更新登录策略失败。")
    return NextResponse.json(
      { ok: false, error: message },
      { status: getServerErrorStatus(error, message.includes("管理员") ? 403 : 500) }
    )
  }
}
