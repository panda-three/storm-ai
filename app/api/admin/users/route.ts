import { NextResponse } from "next/server"
import { describeServerError, getServerErrorStatus, getSupabaseServerClient, requireAdminUser } from "@/lib/server-supabase"
import type { AdminAccountRow, AdminAccountSummary } from "@/lib/supabase"

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 10

function getPositiveInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET(request: Request) {
  try {
    await requireAdminUser(request)

    const { searchParams } = new URL(request.url)
    const page = getPositiveInteger(searchParams.get("page"), 1)
    const pageSize = Math.min(getPositiveInteger(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const supabase = getSupabaseServerClient()
    const accountQuery = supabase
      .from("user_accounts")
      .select("user_id, email, username, credit_balance, ledger, role, updated_at, membership_tier, membership_expires_at, membership_free_image_qualities, must_change_password, temporary_password_set_at, temporary_password_set_by, allow_multi_device_sessions", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(from, to)

    const { data: accountRows, count, error: accountError } = await accountQuery

    if (accountError) throw accountError

    const accountsRows = (accountRows ?? []) as AdminAccountRow[]
    const accountUserIds = accountsRows.map((account) => account.user_id)
    const activeSessionPromise = accountUserIds.length > 0
      ? supabase
        .from("user_active_sessions")
        .select("user_id, device_label, created_at, last_seen_at, revoked_at, revoked_reason")
        .in("user_id", accountUserIds)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
      : Promise.resolve({ data: [], error: null })
    const authUsersPromise = Promise.all(
      accountsRows.map(async (account) => {
        const { data, error } = await supabase.auth.admin.getUserById(account.user_id)
        if (error) throw error
        return data.user
      })
    )
    const [{ data: activeSessionRows, error: activeSessionError }, authUsers] = await Promise.all([
      activeSessionPromise,
      authUsersPromise,
    ])

    if (activeSessionError) throw activeSessionError

    const usersById = new Map(authUsers.filter(Boolean).map((user) => [user.id, user]))
    const activeSessionsByUserId = new Map((activeSessionRows ?? []).map((session) => [session.user_id, session]))
    const accounts = accountsRows.map<AdminAccountSummary>((account) => {
      const user = usersById.get(account.user_id)
      const activeSession = activeSessionsByUserId.get(account.user_id)

      return {
        ...account,
        active_session_created_at: activeSession?.created_at ?? null,
        active_session_device_label: activeSession?.device_label ?? null,
        active_session_last_seen_at: activeSession?.last_seen_at ?? null,
        active_session_revoked_at: activeSession?.revoked_at ?? null,
        active_session_revoked_reason: activeSession?.revoked_reason ?? null,
        email: account.email ?? user?.email ?? null,
        email_confirmed_at: user?.email_confirmed_at ?? null,
      }
    })
    const total = count ?? 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return NextResponse.json({ ok: true, accounts, page, pageSize, total, totalPages })
  } catch (error) {
    const message = describeServerError(error, "加载用户列表失败。")
    return NextResponse.json(
      { ok: false, error: message },
      { status: getServerErrorStatus(error, message.includes("管理员") ? 403 : 500) }
    )
  }
}
