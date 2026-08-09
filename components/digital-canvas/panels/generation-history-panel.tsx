"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, History, Loader2, RefreshCw, X } from "lucide-react"
import { listGenerationHistory } from "@/lib/digital-canvas/api"
import type { ProjectItem } from "@/lib/project-history"

interface GenerationHistoryPanelProps {
  onClose: () => void
  // 把历史图片加入画布（派生图片节点）
  onInsert: (urls: string[]) => void
}

type HistoryFilter = "all" | "image" | "video"

export function GenerationHistoryPanel({ onClose, onInsert }: GenerationHistoryPanelProps) {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<HistoryFilter>("image")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setProjects(await listGenerationHistory())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成历史加载失败。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    if (filter === "all") return projects
    return projects.filter((project) => (filter === "image" ? project.type === "生图" : project.type === "视频"))
  }, [filter, projects])

  return (
    <aside className="flex h-full w-[20rem] shrink-0 flex-col border-r border-slate-200 bg-white">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
        <History className="h-4 w-4 text-cyan-600" />
        <span className="text-sm font-semibold text-slate-800">生成历史</span>
        <button
          className="ml-auto rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          disabled={loading}
          onClick={() => void load()}
          title="刷新"
          type="button"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex shrink-0 gap-1.5 border-b border-slate-100 px-4 py-2">
        {(
          [
            { label: "图片", value: "image" },
            { label: "视频", value: "video" },
            { label: "全部", value: "all" },
          ] as { label: string; value: HistoryFilter }[]
        ).map((option) => (
          <button
            className={`rounded-lg border px-2 py-1 text-[11px] transition ${
              filter === option.value
                ? "border-cyan-300 bg-cyan-50 font-medium text-cyan-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
            key={option.value}
            onClick={() => setFilter(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-600">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在加载历史...
          </div>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">暂无生成记录</p>
        ) : (
          <ul className="space-y-3">
            {visible.map((project) => {
              const images = (project.imageUrls ?? []).filter(Boolean)
              const preview = project.previewUrl || images[0] || ""

              return (
                <li className="rounded-xl border border-slate-200 p-2" key={project.id}>
                  <div className="flex items-start gap-2">
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={project.title || "历史结果"}
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                        src={preview}
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400">
                        无预览
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-800">
                        {project.title || (project.type === "视频" ? "视频项目" : "图片项目")}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-400">
                        {project.prompt || "无提示词"}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span
                          className={
                            project.status === "已完成"
                              ? "text-emerald-600"
                              : project.status === "失败"
                                ? "text-rose-600"
                                : "text-amber-600"
                          }
                        >
                          {project.status}
                        </span>
                        <span>{project.time}</span>
                      </p>
                    </div>
                  </div>

                  {images.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        className="rounded-lg bg-slate-950 px-2 py-1 text-[10px] text-white transition hover:bg-slate-800"
                        onClick={() => onInsert(images)}
                        type="button"
                      >
                        全部加入画布（{images.length}）
                      </button>
                      {images.length > 1
                        ? images.map((url, index) => (
                            <button
                              className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] text-slate-600 transition hover:bg-slate-50"
                              key={url}
                              onClick={() => onInsert([url])}
                              type="button"
                            >
                              图 {index + 1}
                            </button>
                          ))
                        : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
