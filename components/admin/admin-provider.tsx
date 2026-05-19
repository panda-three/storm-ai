"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react"
import { AuthPanel } from "@/components/auth-panel"
import { ForcedPasswordChange } from "@/components/forced-password-change"
import { Button } from "@/components/ui/button"
import { useAccountSession, getErrorMessage } from "@/hooks/use-account-session"
import {
  type AdminAccountSummary,
  type CreditPackage,
  type CustomerServiceSettings,
  type ModelConfig,
  type ModelPricing,
  type RedeemCode,
  loadAdminAccounts,
  loadCreditPackages,
  loadCustomerServiceSettings,
  loadModelConfigs,
  loadModelPricing,
  loadRedeemCodes,
} from "@/lib/supabase"

const emptyAdminAccountsPage = {
  accounts: [],
  emailSearch: "",
  includeLedger: false,
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1,
}

type Feedback =
  | {
      message: string
      type: "success" | "error"
    }
  | null

interface AdminContextValue {
  adminAccounts: AdminAccountSummary[]
  adminAccountsLoading: boolean
  adminAccountsEmailSearch: string
  adminAccountsPage: number
  adminAccountsPageSize: number
  adminAccountsTotal: number
  adminAccountsTotalPages: number
  creditPackages: CreditPackage[]
  customerService: CustomerServiceSettings
  feedback: Feedback
  modelConfigLoading: boolean
  modelPricing: ModelPricing[]
  modelConfigs: ModelConfig[]
  redeemCodes: RedeemCode[]
  refreshAdminAccounts: (options?: { emailSearch?: string; includeLedger?: boolean; page?: number }) => Promise<void>
  refreshAdminConfig: (options?: { accountsEmailSearch?: string; accountsPage?: number; includeModelConfig?: boolean }) => Promise<void>
  saving: boolean
  setCreditPackages: (packages: CreditPackage[]) => void
  setCustomerService: (settings: CustomerServiceSettings) => void
  setFeedback: (feedback: Feedback) => void
  setModelPricing: (pricing: ModelPricing[]) => void
  setModelConfigs: (configs: ModelConfig[]) => void
  setSaving: (saving: boolean) => void
}

const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin() {
  const context = useContext(AdminContext)
  if (!context) {
    throw new Error("useAdmin must be used inside AdminProvider")
  }
  return context
}

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const {
    account,
    accountStatus,
    authReady,
    refreshAccount,
    setSyncError,
    signOut,
    syncError,
    user,
    userId,
  } = useAccountSession()
  const [customerService, setCustomerService] = useState<CustomerServiceSettings>({
    description: "联系客服购买兑换码后，在站内输入兑换码完成点数充值。",
    qrCodeUrl: "",
    wechatId: "",
  })
  const [creditPackages, setCreditPackages] = useState<CreditPackage[]>([])
  const [adminAccounts, setAdminAccounts] = useState<AdminAccountSummary[]>([])
  const [adminAccountsEmailSearch, setAdminAccountsEmailSearch] = useState("")
  const [adminAccountsLoading, setAdminAccountsLoading] = useState(false)
  const [adminAccountsPage, setAdminAccountsPage] = useState(1)
  const [adminAccountsTotal, setAdminAccountsTotal] = useState(0)
  const [adminAccountsTotalPages, setAdminAccountsTotalPages] = useState(1)
  const [modelPricing, setModelPricing] = useState<ModelPricing[]>([])
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([])
  const [modelConfigLoading, setModelConfigLoading] = useState(true)
  const [redeemCodes, setRedeemCodes] = useState<RedeemCode[]>([])
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [saving, setSaving] = useState(false)
  const isAdmin = account?.role === "admin"
  const accountUserId = account?.userId ?? ""
  const adminAccountsPageSize = 10
  const shouldLoadAdminAccounts = pathname === "/admin" || pathname === "/admin/users" || pathname === "/admin/ledger"
  const shouldLoadAdminAccountLedger = pathname === "/admin/ledger"

  const refreshModelConfig = useCallback(async () => {
    setModelConfigLoading(true)
    try {
      const [configs, pricing] = await Promise.all([
        loadModelConfigs({ includeDisabled: true }),
        loadModelPricing({ includeDisabled: true }),
      ])
      setModelConfigs(configs)
      setModelPricing(pricing)
    } finally {
      setModelConfigLoading(false)
    }
  }, [])

  const resetAdminAccounts = useCallback(() => {
    setAdminAccounts([])
    setAdminAccountsEmailSearch("")
    setAdminAccountsPage(1)
    setAdminAccountsTotal(0)
    setAdminAccountsTotalPages(1)
  }, [])

  const refreshAdminAccounts = useCallback(async ({ emailSearch = "", includeLedger = shouldLoadAdminAccountLedger, page = 1 }: { emailSearch?: string; includeLedger?: boolean; page?: number } = {}) => {
    if (!userId || accountStatus !== "ready" || accountUserId !== userId || !isAdmin) {
      resetAdminAccounts()
      return
    }

    setAdminAccountsLoading(true)
    try {
      const accountsPage = await loadAdminAccounts({ emailSearch, includeLedger, page, pageSize: adminAccountsPageSize })
      setAdminAccounts(accountsPage.accounts)
      setAdminAccountsEmailSearch(accountsPage.emailSearch)
      setAdminAccountsPage(accountsPage.page)
      setAdminAccountsTotal(accountsPage.total)
      setAdminAccountsTotalPages(accountsPage.totalPages)
    } finally {
      setAdminAccountsLoading(false)
    }
  }, [accountStatus, accountUserId, isAdmin, resetAdminAccounts, shouldLoadAdminAccountLedger, userId])

  const refreshAdminConfig = useCallback(async ({ accountsEmailSearch = "", accountsPage = 1, includeModelConfig = true } = {}) => {
    if (!userId || accountStatus !== "ready" || accountUserId !== userId || !isAdmin) {
      resetAdminAccounts()
      setRedeemCodes([])
      setModelConfigs([])
      setModelPricing([])
      setModelConfigLoading(false)
      return
    }

    try {
      setAdminAccountsLoading(true)
      setSyncError("")
      const modelConfigPromise = includeModelConfig
        ? refreshModelConfig()
        : Promise.resolve()
      const accountsPagePromise = shouldLoadAdminAccounts
        ? loadAdminAccounts({
          emailSearch: accountsEmailSearch,
          includeLedger: shouldLoadAdminAccountLedger,
          page: accountsPage,
          pageSize: adminAccountsPageSize,
        })
        : Promise.resolve(emptyAdminAccountsPage)
      const [settings, packages, codes, accountsPageData] = await Promise.all([
        loadCustomerServiceSettings(),
        loadCreditPackages({ includeDisabled: true }),
        loadRedeemCodes(),
        accountsPagePromise,
        modelConfigPromise,
      ])
      setCustomerService(settings)
      setCreditPackages(packages)
      setRedeemCodes(codes)
      setAdminAccounts(accountsPageData.accounts)
      setAdminAccountsEmailSearch(accountsPageData.emailSearch)
      setAdminAccountsPage(accountsPageData.page)
      setAdminAccountsTotal(accountsPageData.total)
      setAdminAccountsTotalPages(accountsPageData.totalPages)
    } catch (error) {
      setSyncError(getErrorMessage(error, "加载管理员后台数据失败。"))
    } finally {
      setAdminAccountsLoading(false)
    }
  }, [accountStatus, accountUserId, isAdmin, refreshModelConfig, resetAdminAccounts, setSyncError, shouldLoadAdminAccountLedger, shouldLoadAdminAccounts, userId])

  const refreshAllAdminData = useCallback(async () => {
    if (!userId || accountStatus !== "ready" || accountUserId !== userId || !isAdmin) {
      resetAdminAccounts()
      setRedeemCodes([])
      setModelConfigs([])
      setModelPricing([])
      return
    }

    setSyncError("")
    try {
      await refreshModelConfig()
    } catch (error) {
      setSyncError(getErrorMessage(error, "加载模型配置失败。"))
      return
    }

    await refreshAdminConfig({ includeModelConfig: false })
  }, [accountStatus, accountUserId, isAdmin, refreshAdminConfig, refreshModelConfig, resetAdminAccounts, setSyncError, userId])

  useEffect(() => {
    refreshAllAdminData()
  }, [refreshAllAdminData])

  const value = useMemo(
    () => ({
      adminAccounts,
      adminAccountsEmailSearch,
      adminAccountsLoading,
      adminAccountsPage,
      adminAccountsPageSize,
      adminAccountsTotal,
      adminAccountsTotalPages,
      creditPackages,
      customerService,
      feedback,
      modelConfigLoading,
      modelConfigs,
      modelPricing,
      redeemCodes,
      refreshAdminAccounts,
      refreshAdminConfig,
      saving,
      setCreditPackages,
      setCustomerService,
      setFeedback,
      setModelConfigs,
      setModelPricing,
      setSaving,
    }),
    [
      adminAccounts,
      adminAccountsEmailSearch,
      adminAccountsLoading,
      adminAccountsPage,
      adminAccountsTotal,
      adminAccountsTotalPages,
      creditPackages,
      customerService,
      feedback,
      modelConfigLoading,
      modelConfigs,
      modelPricing,
      redeemCodes,
      refreshAdminAccounts,
      refreshAdminConfig,
      saving,
    ]
  )

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] text-sm text-slate-500">
        正在加载账户...
      </div>
    )
  }

  if (!user) {
    return <AuthPanel onAuthed={() => undefined} />
  }

  if (accountStatus === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 text-slate-950">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 text-center shadow-sm">
          <h1 className="text-base font-semibold">账户加载失败</h1>
          <p className="mt-2 text-sm text-slate-500">{syncError || "加载 Supabase 数据失败。"}</p>
          <Button className="mt-4 bg-indigo-600 text-white hover:bg-indigo-700" onClick={refreshAccount}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (accountStatus !== "ready" || !account || account.userId !== user.id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] text-sm text-slate-500">
        正在加载账户...
      </div>
    )
  }

  if (account.mustChangePassword) {
    return <ForcedPasswordChange onChanged={refreshAccount} onSignOut={signOut} />
  }

  if (!isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 text-slate-950">
        <section className="w-full max-w-xl rounded-lg border border-rose-200 bg-white p-6">
          <div className="flex items-center gap-2 text-rose-700">
            <AlertCircle className="h-5 w-5" />
            <h1 className="text-base font-semibold">无管理员权限</h1>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            当前账号不是管理员。请在 Supabase 的 user_accounts 表中将你的账号 role 设置为 admin 后重新登录。
          </p>
          <Button asChild className="mt-5">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              返回工作台
            </Link>
          </Button>
        </section>
      </main>
    )
  }

  return (
    <AdminContext.Provider value={value}>
      {syncError && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm">
          {syncError}
        </div>
      )}
      {feedback && (
        <div
          className={
            feedback.type === "success"
              ? "fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 shadow-sm"
              : "fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm"
          }
        >
          {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {feedback.message}
        </div>
      )}
      {children}
    </AdminContext.Provider>
  )
}
