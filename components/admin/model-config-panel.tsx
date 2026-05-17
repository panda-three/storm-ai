"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, Eye, EyeOff, Info, Plus, Save, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { calculatePricingCredits } from "@/lib/supabase"
import {
  apimartGptImage2ApiModelName,
  apimartGptImage2ModelName,
  gptImage2AllModelName,
  grokVideo3ModelName,
  imageModelOptions,
  toaGptImage2ModelName,
  toapisGptImage2ApiModelName,
  videoModelOptions,
  yunwuGeminiImageModelName,
  yunwuVeo31FastVideoModelName,
} from "@/lib/model-options"
import { cn } from "@/lib/utils"

type ModelKind = "image" | "video"
type ProviderLabel = "云雾" | "APIMart" | "ToAPIs"

interface DemoPrice {
  cost_cny: number
  enabled: boolean
  id: string
  label: string
  markup: number
}

interface DemoModelConfig {
  apiModel: string
  displayName: string
  frontendEnabled: boolean
  id: string
  initialSelected: boolean
  internalModel: string
  prices: DemoPrice[]
  provider: ProviderLabel
  sortOrder: number
  type: ModelKind
}

const demoModelConfigs: DemoModelConfig[] = [
  {
    apiModel: yunwuGeminiImageModelName,
    displayName: "Nano Banana Pro",
    frontendEnabled: true,
    id: "image-yunwu-gemini",
    initialSelected: true,
    internalModel: yunwuGeminiImageModelName,
    prices: [
      { cost_cny: 0.3, enabled: true, id: "1k", label: "1K", markup: 2 },
      { cost_cny: 0.6, enabled: true, id: "2k", label: "2K", markup: 2 },
      { cost_cny: 1.2, enabled: true, id: "4k", label: "4K", markup: 2 },
    ],
    provider: "云雾",
    sortOrder: 1,
    type: "image",
  },
  {
    apiModel: "gpt-image-2",
    displayName: "GPT Image 2",
    frontendEnabled: true,
    id: "image-yunwu-gpt",
    initialSelected: false,
    internalModel: gptImage2AllModelName,
    prices: [
      { cost_cny: 0.9, enabled: true, id: "2k", label: "2K", markup: 2 },
    ],
    provider: "云雾",
    sortOrder: 2,
    type: "image",
  },
  {
    apiModel: apimartGptImage2ApiModelName,
    displayName: "GPT Image 2 · M通道",
    frontendEnabled: true,
    id: "image-apimart-gpt",
    initialSelected: false,
    internalModel: apimartGptImage2ModelName,
    prices: [
      { cost_cny: 0.35, enabled: true, id: "1k", label: "1K", markup: 2 },
      { cost_cny: 0.75, enabled: true, id: "2k", label: "2K", markup: 2 },
      { cost_cny: 1.6, enabled: false, id: "4k", label: "4K", markup: 2 },
    ],
    provider: "APIMart",
    sortOrder: 3,
    type: "image",
  },
  {
    apiModel: toapisGptImage2ApiModelName,
    displayName: "GPT Image 2 · ToA通道",
    frontendEnabled: false,
    id: "image-toapis-gpt",
    initialSelected: false,
    internalModel: toaGptImage2ModelName,
    prices: [
      { cost_cny: 0.32, enabled: true, id: "1k", label: "1K", markup: 2 },
      { cost_cny: 0.7, enabled: true, id: "2k", label: "2K", markup: 2 },
      { cost_cny: 1.45, enabled: true, id: "4k", label: "4K", markup: 2 },
    ],
    provider: "ToAPIs",
    sortOrder: 4,
    type: "image",
  },
  {
    apiModel: yunwuVeo31FastVideoModelName,
    displayName: "VEO 3.1 Fast",
    frontendEnabled: true,
    id: "video-yunwu-veo",
    initialSelected: true,
    internalModel: yunwuVeo31FastVideoModelName,
    prices: [
      { cost_cny: 2, enabled: true, id: "8s-720p", label: "8 秒 · 720P", markup: 2 },
      { cost_cny: 4, enabled: true, id: "8s-1080p", label: "8 秒 · 1080P", markup: 2 },
      { cost_cny: 8, enabled: false, id: "8s-4k", label: "8 秒 · 4K", markup: 2 },
    ],
    provider: "云雾",
    sortOrder: 1,
    type: "video",
  },
  {
    apiModel: grokVideo3ModelName,
    displayName: "Grok Video 3",
    frontendEnabled: true,
    id: "video-yunwu-grok",
    initialSelected: false,
    internalModel: grokVideo3ModelName,
    prices: [
      { cost_cny: 1.8, enabled: true, id: "6s-720p", label: "6 秒 · 720P", markup: 2 },
    ],
    provider: "云雾",
    sortOrder: 2,
    type: "video",
  },
]

function enabledPriceCount(config: DemoModelConfig) {
  return config.prices.filter((price) => price.enabled).length
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
  const [configs, setConfigs] = useState<DemoModelConfig[]>(demoModelConfigs)
  const [selectedId, setSelectedId] = useState(demoModelConfigs[0].id)
  const [feedback, setFeedback] = useState("")
  const selected = configs.find((config) => config.id === selectedId) ?? configs[0]
  const visibleCount = configs.filter((config) => config.frontendEnabled && enabledPriceCount(config) > 0).length
  const knownModelCount = imageModelOptions.length + videoModelOptions.length

  const sortedConfigs = useMemo(
    () => configs.slice().sort((a, b) => a.type.localeCompare(b.type) || a.sortOrder - b.sortOrder),
    [configs]
  )

  const updateSelected = (patch: Partial<Pick<DemoModelConfig, "displayName" | "frontendEnabled" | "initialSelected" | "sortOrder">>) => {
    setConfigs((items) =>
      items.map((item) => {
        if (item.id !== selected.id) {
          return patch.initialSelected && item.type === selected.type ? { ...item, initialSelected: false } : item
        }

        return {
          ...item,
          ...patch,
          displayName: patch.displayName ?? item.displayName,
          sortOrder: Number.isFinite(patch.sortOrder) ? Number(patch.sortOrder) : item.sortOrder,
        }
      })
    )
  }

  const updatePrice = (priceId: string, patch: Partial<Pick<DemoPrice, "cost_cny" | "enabled" | "markup">>) => {
    setConfigs((items) =>
      items.map((item) =>
        item.id === selected.id
          ? {
              ...item,
              prices: item.prices.map((price) =>
                price.id === priceId
                  ? {
                      ...price,
                      ...patch,
                      cost_cny: Number.isFinite(patch.cost_cny) ? Number(patch.cost_cny) : price.cost_cny,
                      markup: Number.isFinite(patch.markup) ? Number(patch.markup) : price.markup,
                    }
                  : price
              ),
            }
          : item
      )
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-500">前台可见模型</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{visibleCount}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-500">当前内置模型</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{knownModelCount}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-500">本页状态</div>
            <div className="mt-2 text-sm font-medium text-amber-700">UI 原型，不写入数据库</div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">模型列表</h2>
              <p className="mt-1 text-sm text-slate-500">后台可见渠道；创作台只显示前台展示名称。</p>
            </div>
            <Button className="bg-indigo-600 text-white hover:bg-indigo-700" size="sm">
              <Plus className="h-4 w-4" />
              添加模型
            </Button>
          </div>

          <div className="grid grid-cols-[minmax(0,1.3fr)_80px_100px_100px_90px] border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs font-medium text-slate-500 max-lg:hidden">
            <div>前台展示名称</div>
            <div>类型</div>
            <div>渠道</div>
            <div>前台展示</div>
            <div>价格</div>
          </div>

          <div className="divide-y divide-slate-100">
            {sortedConfigs.map((config) => (
              <button
                className={cn(
                  "grid w-full cursor-pointer gap-3 px-5 py-4 text-left transition-colors lg:grid-cols-[minmax(0,1.3fr)_80px_100px_100px_90px] lg:items-center",
                  config.id === selected.id ? "bg-indigo-50/70" : "hover:bg-slate-50"
                )}
                key={config.id}
                onClick={() => setSelectedId(config.id)}
                type="button"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-950">{config.displayName}</span>
                    {config.initialSelected && (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                        初始选中
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-400">内部模型：{config.internalModel}</div>
                </div>
                <div className="text-sm text-slate-600">{config.type === "image" ? "图片" : "视频"}</div>
                <div className="text-sm font-medium text-slate-700">{config.provider}</div>
                <StatusPill enabled={config.frontendEnabled} />
                <div className="text-sm text-slate-600">
                  {enabledPriceCount(config)}/{config.prices.length} 启用
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
          <div className="flex items-center gap-2 font-semibold">
            <Info className="h-4 w-4" />
            新增模型操作
          </div>
          <p className="mt-2">
            已接入渠道的新模型：选择渠道、填写内部模型和接口模型、设置前台展示名称、配置价格并开启展示。新渠道必须先开发接入适配器，后台才会出现该渠道选项。
          </p>
        </div>
      </div>

      <aside className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <Settings2 className="h-4 w-4" />
              当前编辑
            </div>
            <h2 className="mt-2 truncate text-lg font-semibold text-slate-950">{selected.displayName}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {selected.provider} · {selected.type === "image" ? "图片模型" : "视频模型"}
            </p>
          </div>
          <Button
            className="bg-slate-950 text-white hover:bg-slate-800"
            size="sm"
            onClick={() => setFeedback("已保存当前 UI 原型状态。真实保存会在下一阶段接入。")}
          >
            <Save className="h-4 w-4" />
            保存
          </Button>
        </div>

        {feedback && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {feedback}
          </div>
        )}

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1">
            <span className="text-sm font-medium text-slate-700">前台展示名称</span>
            <input
              className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => updateSelected({ displayName: event.target.value })}
              value={selected.displayName}
            />
            <span className="text-xs text-slate-500">只影响创作台下拉显示，不影响接口调用。</span>
          </label>

          <div className="grid gap-2">
            <ReadonlyField label="内部模型" value={selected.internalModel} />
            <ReadonlyField label="接口模型" value={selected.apiModel} />
            <ReadonlyField label="渠道" value={selected.provider} />
          </div>

          <label className="grid gap-1">
            <span className="text-sm font-medium text-slate-700">创作台排序</span>
            <input
              className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              min="1"
              onChange={(event) => updateSelected({ sortOrder: Number(event.target.value) })}
              type="number"
              value={selected.sortOrder}
            />
          </label>

          <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-800">前台展示</div>
                <div className="text-xs text-slate-500">关闭后创作台不显示该模型</div>
              </div>
              <Button
                onClick={() => updateSelected({ frontendEnabled: !selected.frontendEnabled })}
                size="sm"
                variant={selected.frontendEnabled ? "default" : "outline"}
              >
                {selected.frontendEnabled ? "开启" : "关闭"}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-800">创作台初始选中</div>
                <div className="text-xs text-slate-500">同类型只保留一个初始选中项</div>
              </div>
              <Button
                onClick={() => updateSelected({ initialSelected: true })}
                size="sm"
                variant={selected.initialSelected ? "default" : "outline"}
              >
                {selected.initialSelected ? "初始选中" : "设为初始"}
              </Button>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-950">价格配置预览</h3>
              <span className="text-xs text-slate-500">扣点 = 成本 x 倍率 x 100</span>
            </div>
            <div className="grid gap-3">
              {selected.prices.map((price) => (
                <div className="rounded-lg border border-slate-200 p-3" key={price.id}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-slate-900">{price.label}</div>
                    <Button
                      onClick={() => updatePrice(price.id, { enabled: !price.enabled })}
                      size="sm"
                      variant={price.enabled ? "default" : "outline"}
                    >
                      {price.enabled ? "启用" : "停用"}
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <label className="grid gap-1">
                      <span className="text-xs text-slate-500">成本</span>
                      <input
                        className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm outline-none focus:border-indigo-300 focus:bg-white"
                        min="0"
                        onChange={(event) => updatePrice(price.id, { cost_cny: Number(event.target.value) })}
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
                        onChange={(event) => updatePrice(price.id, { markup: Number(event.target.value) })}
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
