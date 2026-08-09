"use client"

import { AlertCircle, Loader2 } from "lucide-react"
import { AuthPanel } from "@/components/auth-panel"
import { ForcedPasswordChange } from "@/components/forced-password-change"
import { Button } from "@/components/ui/button"
import { useAccountSession } from "@/hooks/use-account-session"
import { DigitalCanvasWorkspace } from "@/components/digital-canvas/canvas-workspace"

export function DigitalCanvasShell() {
  const {
    account,
    accountStatus,
    authReady,
    refreshAccount,
    reloadAuthSession,
    signOut,
    syncError,
    user,
  } = useAccountSession()

  if (!authReady) {
    return <ShellLoading text="正在加载账户..." />
  }

  if (!user) {
    return <AuthPanel onAuthed={reloadAuthSession} variant="landing" />
  }

  if (accountStatus === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-lg">
          <AlertCircle className="mx-auto h-6 w-6 text-rose-500" />
          <h1 className="mt-3 text-base font-semibold">账户加载失败</h1>
          <p className="mt-2 text-sm text-slate-500">{syncError || "加载账户数据失败。"}</p>
          <Button className="mt-4" onClick={refreshAccount} type="button">
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (accountStatus !== "ready" || !account || account.userId !== user.id) {
    return <ShellLoading text="正在准备数字画布..." />
  }

  if (account.mustChangePassword) {
    return <ForcedPasswordChange onChanged={refreshAccount} onSignOut={signOut} />
  }

  return <DigitalCanvasWorkspace email={user.email ?? "未设置邮箱"} />
}

function ShellLoading({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {text}
    </div>
  )
}
