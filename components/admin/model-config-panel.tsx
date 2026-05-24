"use client"

import { useEffect, useMemo, useState } from "react"
import { Eye, EyeOff, Loader2, Plus, Save, Settings2 } from "lucide-react"
import { useAdmin } from "@/components/admin/admin-provider"
import { Button } from "@/components/ui/button"
import {
  calculatePricingCredits,
  getSupabaseErrorMessage,
  saveModelConfigBundle,
  type ModelConfig,
  type ModelPricingDraft,
} from "@/lib/supabase"
import { formatModelNameForDisplay } from "@/lib/model-display"
import { getCatalogEntry, modelCatalog } from "@/lib/model-catalog"
import { imageModelSettings, videoModelSettings } from "@/lib/model-options"
import { cn } from "@/lib/utils"

function enabledPriceCount(prices: ModelPricingDraft[]) {
  return prices.filter((price) => price.enabled).length
}

function getPriceLabel(price: ModelPricingDraft) {
  if (price.type === "video") {
    return `${price.duration_seconds ?? 0} 秒 · ${price.quality ?? "未配置"}`
  }
  return price.quality ?? "未配置"
}

function mergeCatalogConfigs(configs: ModelConfig[]): ModelConfig[] {
  const byKey = new Map(configs.map((config) => [`${config.type}:${config.model}`, config]))
  const merged = [...configs]

  for (const [index, entry] of modelCatalog.entries()) {
    const key = `${entry.type}:${entry.model}`
    if (byKey.has(key)) continue

    merged.push({
      display_name: entry.defaultDisplayName,
      frontend_enabled: false,
      id: `catalog:${key}`,
      initial_selected: false,
      model: entry.model,
      sort_order: (index + 1) * 10,
      type: entry.type,
    })
  }

  return merged
}

function StatusPill({ enabled }: { enabled: boolean }) {
  const Icon = enabled ? Eye : EyeOff
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {enabled ? "展示" : "隐藏"}
    </span>
  )
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 break-all text-sm font-medium text-slate-800">{value}</div>
    </div>
  )
}

export function ModelConfigPanel() {
  const { modelConfigLoading, modelConfigs, modelPricing, refreshAdminConfig, saving, setFeedback, setSaving } = useAdmin()
  const [selectedKey, setSelectedKey] = useState("")
  const [draftConfigs, setDraftConfigs] = useState<ModelConfig[]>(mergeCatalogConfigs(modelConfigs))
  const [draftPricing, setDraftPricing] = useState<ModelPricingDraft[]>(modelPricing)

  useEffect(() => setDraftConfigs(mergeCatalogConfigs(modelConfigs)), [modelConfigs])
  useEffect(() => setDraftPricing(modelPricing), [modelPricing])

  const sortedConfigs = useMemo(
    () => draftConfigs.slice().sort((a, b) => a.type.localeCompare(b.type) || a.sort_order - b.sort_order),
    [draftConfigs]
  )
  const fallbackSelected = sortedConfigs[0]
  const selected =
    sortedConfigs.find((config) => `${config.type}:${config.model}` === selectedKey) ?? fallbackSelected
  const selectedPrices = selected
    ? draftPricing.filter((price) => price.type === selected.type && price.model === selected.model)
    : []

  useEffect(() => {
    if (!selectedKey && fallbackSelected) {
      setSelectedKey(`${fallbackSelected.type}:${fallbackSelected.model}`)
    }
  }, [fallbackSelected, selectedKey])

  const visibleCount = draftConfigs.filter((config) => {
    const prices = draftPricing.filter((price) => price.type === config.type && price.model === config.model)
    return config.frontend_enabled && enabledPriceCount(prices) > 0
  }).length

  const updateSelected = (patch: Partial<Omit<ModelConfig, "id" | "model" | "type">>) => {
    if (!selected) return
    setDraftConfigs((items) =>
      items.map((item) => {
        if (item.type !== selected.type || item.model !== selected.model) {
          return patch.initial_selected && item.type === selected.type ? { ...item, initial_selected: false } : item
        }
        return { ...item, ...patch }
      })
    )
  }

  const updatePrice = (target: ModelPricingDraft, patch: Partial<Pick<ModelPricingDraft, "cost_cny" | "enabled" | "markup">>) => {
    setDraftPricing((items) =>
      items.map((item) =>
        item === target
          ? {
              ...item,
              ...patch,
              cost_cny: Number.isFinite(patch.cost_cny) ? Number(patch.cost_cny) : item.cost_cny,
              markup: Number.isFinite(patch.markup) ? Number(patch.markup) : item.markup,
            }
          : item
      )
    )
  }

  const addPrice = () => {
    if (!selected) return
    if (selected.type === "image") {
      const quality = imageModelSettings[selected.model].qualities[0]
      setDraftPricing((items) => [
        ...items,
        {
          aspect_ratio: null,
          cost_cny: 1,
          duration_seconds: null,
          enabled: true,
          markup: 2,
          model: selected.model,
          quality,
          type: selected.type,
        },
      ])
      return
    }

    const settings = videoModelSettings[selected.model]
    setDraftPricing((items) => [
      ...items,
      {
        aspect_ratio: null,
        cost_cny: 1,
        duration_seconds: Number.parseInt(settings.durations[0], 10),
        enabled: true,
        markup: 2,
        model: selected.model,
        quality: settings.qualities[0],
        type: selected.type,
      },
    ])
  }

  const updatePriceVariant = (index: number, patch: Partial<Pick<ModelPricingDraft, "duration_seconds" | "quality">>) => {
    if (!selected) return
    const target = selectedPrices[index]
    if (!target) return
    setDraftPricing((items) =>
      items.map((item) =>
        item === target
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    )
  }

  const handleSave = async () => {
    if (!selected) return
    const enabledPriceKeys = selectedPrices
      .filter((price) => price.enabled)
      .map((price) =>
        price.type === "video"
          ? `${price.type}:${price.quality ?? ""}:${price.duration_seconds ?? ""}`
          : `${price.type}:${price.quality ?? ""}`
      )
    if (new Set(enabledPriceKeys).size !== enabledPriceKeys.length) {
      setFeedback({ type: "error", message: "同一参数组合只能保留一个启用价格。" })
      return
    }

    setSaving(true)
    setFeedback(null)
    try {
      await saveModelConfigBundle({
        config: {
          display_name: selected.display_name.trim(),
          frontend_enabled: selected.frontend_enabled,
          initial_selected: selected.initial_selected,
          model: selected.model,
          sort_order: selected.sort_order,
          type: selected.type,
        },
        pricing: selectedPrices,
      })
      await refreshAdminConfig()
      setFeedback({ type: "success", message: "模型配置已保存。" })
    } catch (error) {
      setFeedback({ type: "error", message: getSupabaseErrorMessage(error, "模型配置保存失败。") })
    } finally {
      setSaving(false)
    }
  }

  if (modelConfigLoading && draftConfigs.length === 0) {
    return (
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid content-start gap-5">
          <div className="grid items-start gap-3 sm:grid-cols-3">
            {["前台可见模型", "已配置模型", "价格真源"].map((label) => (
              <div className="h-[118px] rounded-lg border border-slate-200 bg-white p-4" key={label}>
                <div className="text-sm text-slate-500">{label}</div>
                <div className="mt-4 h-8 w-16 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="h-5 w-24 animate-pulse rounded bg-slate-100" />
              <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded bg-slate-100" />
            </div>
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1.3fr)_80px_100px_100px_90px] lg:items-center" key={index}>
                  <div className="min-w-0">
                    <div className="h-5 w-44 animate-pulse rounded bg-slate-100" />
                    <div className="mt-2 h-4 w-64 max-w-full animate-pulse rounded bg-slate-100" />
                  </div>
                  <div className="h-5 w-10 animate-pulse rounded bg-slate-100" />
                  <div className="h-5 w-16 animate-pulse rounded bg-slate-100" />
                  <div className="h-8 w-24 animate-pulse rounded-full bg-slate-100" />
                  <div className="h-5 w-14 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="min-h-[360px] rounded-lg border border-slate-200 bg-white p-5">
          <div className="h-5 w-24 animate-pulse rounded bg-slate-100" />
          <div className="mt-4 h-7 w-44 animate-pulse rounded bg-slate-100" />
          <div className="mt-6 grid gap-3">
            {Array.from({ length: 7 }, (_, index) => (
              <div className="h-10 animate-pulse rounded-md bg-slate-100" key={index} />
            ))}
          </div>
        </aside>
      </div>
    )
  }

  if (!selected) {
    return <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">暂无已配置模型。</div>
  }

  const catalog = getCatalogEntry(selected.type, selected.model)

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="grid content-start gap-5">
        <div className="grid items-start gap-3 sm:grid-cols-3">
          <div className="h-fit rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-500">前台可见模型</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{visibleCount}</div>
          </div>
          <div className="h-fit rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-500">已配置模型</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{draftConfigs.length}</div>
          </div>
          <div className="h-fit rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-500">价格真源</div>
            <div className="mt-2 text-sm font-medium text-slate-700">沿用当前数据库价格</div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">模型列表</h2>
            <p className="mt-1 text-sm text-slate-500">后台管理前台展示；新上游模型仍需先完成代码接入。</p>
          </div>
          <div className="divide-y divide-slate-100">
            {sortedConfigs.map((config) => {
              const prices = draftPricing.filter((price) => price.type === config.type && price.model === config.model)
              const configCatalog = getCatalogEntry(config.type, config.model)
              return (
                <button
                  className={cn(
                    "grid w-full gap-3 px-5 py-4 text-left transition-colors lg:grid-cols-[minmax(0,1.3fr)_80px_100px_100px_90px] lg:items-center",
                    config.type === selected.type && config.model === selected.model ? "bg-indigo-50/70" : "hover:bg-slate-50"
                  )}
                  key={`${config.type}:${config.model}`}
                  onClick={() => setSelectedKey(`${config.type}:${config.model}`)}
                  type="button"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-950">{config.display_name}</span>
                      {config.initial_selected && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                          初始选中
                        </span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-400">内部模型：{config.model}</div>
                  </div>
                  <div className="text-sm text-slate-600">{config.type === "image" ? "图片" : "视频"}</div>
                  <div className="text-sm font-medium text-slate-700">{configCatalog?.provider ?? "未知"}</div>
                  <StatusPill enabled={config.frontend_enabled} />
                  <div className="text-sm text-slate-600">
                    {enabledPriceCount(prices)}/{prices.length} 启用
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <aside className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <Settings2 className="h-4 w-4" />
              当前编辑
            </div>
            <h2 className="mt-2 truncate text-lg font-semibold text-slate-950">{selected.display_name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {catalog?.provider ?? "未知"} · {selected.type === "image" ? "图片模型" : "视频模型"}
            </p>
          </div>
          <Button className="bg-slate-950 text-white hover:bg-slate-800" disabled={saving} onClick={handleSave} size="sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </Button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1">
            <span className="text-sm font-medium text-slate-700">前台展示名称</span>
            <input
              className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => updateSelected({ display_name: event.target.value })}
              value={selected.display_name}
            />
          </label>

          <div className="grid gap-2">
            <ReadonlyField label="内部模型" value={selected.model} />
            <ReadonlyField label="接口模型" value={catalog?.apiModel ?? selected.model} />
            <ReadonlyField label="默认展示名" value={formatModelNameForDisplay(selected.model, selected.type)} />
          </div>

          <label className="grid gap-1">
            <span className="text-sm font-medium text-slate-700">创作台排序</span>
            <input
              className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              min="1"
              onChange={(event) => updateSelected({ sort_order: Number(event.target.value) })}
              type="number"
              value={selected.sort_order}
            />
          </label>

          <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-800">前台展示</div>
                <div className="text-xs text-slate-500">关闭后创作台不显示该模型</div>
              </div>
              <Button
                onClick={() => updateSelected({ frontend_enabled: !selected.frontend_enabled })}
                size="sm"
                variant={selected.frontend_enabled ? "default" : "outline"}
              >
                {selected.frontend_enabled ? "开启" : "关闭"}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-800">创作台初始选中</div>
                <div className="text-xs text-slate-500">同类型只保留一个初始选中项</div>
              </div>
              <Button
                onClick={() => updateSelected({ initial_selected: true })}
                size="sm"
                variant={selected.initial_selected ? "default" : "outline"}
              >
                {selected.initial_selected ? "初始选中" : "设为初始"}
              </Button>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-950">价格配置</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">扣点 = 成本 x 倍率 x 100</span>
                <Button onClick={addPrice} size="sm" variant="outline">
                  <Plus className="h-4 w-4" />
                  添加价格
                </Button>
              </div>
            </div>
            <div className="grid gap-3">
              {selectedPrices.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                  当前模型还没有价格项，前台不会展示。
                </div>
              )}
              {selectedPrices.map((price, index) => (
                <div className="rounded-lg border border-slate-200 p-3" key={price.id ?? `${price.type}-${price.model}-${index}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-slate-900">{getPriceLabel(price)}</div>
                    <Button
                      onClick={() => updatePrice(price, { enabled: !price.enabled })}
                      size="sm"
                      variant={price.enabled ? "default" : "outline"}
                    >
                      {price.enabled ? "启用" : "停用"}
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1">
                      <span className="text-xs text-slate-500">清晰度</span>
                      <select
                        className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm outline-none focus:border-indigo-300 focus:bg-white"
                        onChange={(event) => updatePriceVariant(index, { quality: event.target.value })}
                        value={price.quality ?? ""}
                      >
                        {(price.type === "image" ? imageModelSettings[price.model].qualities : videoModelSettings[price.model].qualities).map((quality) => (
                          <option key={quality} value={quality}>
                            {quality}
                          </option>
                        ))}
                      </select>
                    </label>
                    {price.type === "video" && (
                      <label className="grid gap-1">
                        <span className="text-xs text-slate-500">时长</span>
                        <select
                          className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm outline-none focus:border-indigo-300 focus:bg-white"
                          onChange={(event) => updatePriceVariant(index, { duration_seconds: Number.parseInt(event.target.value, 10) })}
                          value={`${price.duration_seconds ?? 0}`}
                        >
                          {videoModelSettings[price.model].durations.map((duration) => {
                            const seconds = Number.parseInt(duration, 10)
                            return (
                              <option key={duration} value={`${seconds}`}>
                                {duration}
                              </option>
                            )
                          })}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <label className="grid gap-1">
                      <span className="text-xs text-slate-500">成本</span>
                      <input
                        className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm outline-none focus:border-indigo-300 focus:bg-white"
                        min="0"
                        onChange={(event) => updatePrice(price, { cost_cny: Number(event.target.value) })}
                        step="0.01"
                        type="number"
                        value={price.cost_cny}
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs text-slate-500">倍率</span>
                      <input
                        className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm outline-none focus:border-indigo-300 focus:bg-white"
                        min="0.1"
                        onChange={(event) => updatePrice(price, { markup: Number(event.target.value) })}
                        step="0.1"
                        type="number"
                        value={price.markup}
                      />
                    </label>
                    <div className="grid gap-1">
                      <span className="text-xs text-slate-500">扣点</span>
                      <div className="flex h-9 items-center rounded-md bg-indigo-50 px-2 text-sm font-semibold text-indigo-700">
                        {calculatePricingCredits(price)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
