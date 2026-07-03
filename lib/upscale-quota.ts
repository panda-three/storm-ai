import { getSupabaseServerClient } from "@/lib/server-supabase"

export const upscaleDailySuccessLimit = 10

export function getUpscaleUsageDate(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

export async function getUpscaleDailyUsage(userId: string, usageDate = getUpscaleUsageDate()) {
  const { data, error } = await getSupabaseServerClient()
    .from("upscale_daily_usage")
    .select("success_count")
    .eq("user_id", userId)
    .eq("usage_date", usageDate)
    .maybeSingle()

  if (error) {
    throw new Error(`读取高清放大额度失败：${error.message}`)
  }

  const usedToday = typeof data?.success_count === "number" ? data.success_count : 0
  return {
    limit: upscaleDailySuccessLimit,
    remainingToday: Math.max(0, upscaleDailySuccessLimit - usedToday),
    usedToday,
  }
}

export async function recordUpscaleSuccess(userId: string, usageDate = getUpscaleUsageDate()) {
  const { data, error } = await getSupabaseServerClient().rpc("increment_upscale_daily_success", {
    p_limit: upscaleDailySuccessLimit,
    p_usage_date: usageDate,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(`记录高清放大额度失败：${error.message}`)
  }

  const usedToday = typeof data === "number" ? data : Number(data)
  if (!Number.isFinite(usedToday)) {
    throw new Error("记录高清放大额度失败：数据库返回无效。")
  }

  return {
    limit: upscaleDailySuccessLimit,
    remainingToday: Math.max(0, upscaleDailySuccessLimit - usedToday),
    usedToday,
  }
}
