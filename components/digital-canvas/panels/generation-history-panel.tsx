"use client"

import { useEffect, useState } from "react"
import { History, Loader2, Plus, RefreshCw, X } from "lucide-react"

import { listGenerationHistory } from "@/lib/digital-canvas/api"
import type { ProjectItem } from "@/lib/project-history"

interface GenerationHistoryPanelProps {
  open: boolean
  onClose: () => void
  /** 把历史图片作为图片节点放到画布 */
  onInsert: (url: string) => void
}

export function GenerationHistoryPanel({ onClose, onInsert, open }: GenerationHistoryPanelProps) {
  const [items, setItems] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setItems(await listGenerationHistory())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "历史加载失败。")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  if (!open) return null

  // 摊平成单张图片，便于逐张插入画布
  const images = items.flatMap((item) =>
    (item.imageUrls ?? []).map((url) => ({ prompt: item.prompt ?? "", url }))
  )

  return (
    <aside className="absolute bottom-3 right-3 top-3 z-20 flex w-[17rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <History className="h-4 w-4 shrink-0 text-cyan-600" />
        <h2 className="text-sm font-semibold text-slate-900">生成历史</h2>
        <button
          aria-label="刷新历史"
          className="ml-auto rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          aria-label="关闭生成历史"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {loading && images.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            载入中...
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] leading-relaxed text-rose-600">{error}</p>
        ) : null}

        {!loading && !error && images.length === 0 ? (
          <p className="px-1 py-8 text-center text-[11px] leading-relaxed text-slate-400">
            还没有生成记录。用左侧快捷渲染出图后会显示在这里。
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          {images.map((image, index) => (
            <button
              className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 transition hover:border-cyan-400"
              key={`${image.url}-${index}`}
              onClick={() => onInsert(image.url)}
              title={image.prompt || "加入画布"}
              type="button"
            >
              <img
                alt={image.prompt || "生成结果"}
                className="h-full w-full object-cover"
                loading="lazy"
                src={image.url}
              />
              <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-white opacity-0 transition group-hover:bg-slate-900/45 group-hover:opacity-100">
                <Plus className="h-5 w-5" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
