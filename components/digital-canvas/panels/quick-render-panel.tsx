"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Loader2, RotateCcw, Sparkles, Wand2, X } from "lucide-react"

import {
  getImageRatiosForSelection,
  imageModelOptions,
  imageModelSettings,
} from "@/lib/model-options"
import {
  AUTO_VALUE,
  countActiveParams,
  createDefaultParamValues,
  groupsForScene,
  renderSceneOptions,
  type RenderParamValues,
  type RenderSceneKind,
} from "@/lib/digital-canvas/render-params"
import { composePrompt, type RenderMode } from "@/lib/digital-canvas/prompt-composer"

import { ImageSlot } from "./image-slot"
import { MaskEditor } from "./mask-editor"

export interface QuickRenderSubmit {
  prompt: string
  model: string
  ratio: string
  quality: string
  mode: RenderMode
  /** 底图（整图重绘/局部精修时使用） */
  baseFile: File | null
  /** 风格参考图 */
  styleFile: File | null
}

interface QuickRenderPanelProps {
  open: boolean
  onClose: () => void
  onSubmit: (input: QuickRenderSubmit) => Promise<void> | void
  busy?: boolean
}

export function QuickRenderPanel({ busy = false, onClose, onSubmit, open }: QuickRenderPanelProps) {
  const [scene, setScene] = useState<RenderSceneKind>("interior")
  const [values, setValues] = useState<RenderParamValues>(() => createDefaultParamValues())
  const [description, setDescription] = useState("")
  const [model, setModel] = useState(imageModelOptions[0] ?? "")
  const [ratio, setRatio] = useState("")
  const [quality, setQuality] = useState("")
  const [showPrompt, setShowPrompt] = useState(false)
  const [maskOpen, setMaskOpen] = useState(false)

  const [baseFile, setBaseFile] = useState<File | null>(null)
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [styleFile, setStyleFile] = useState<File | null>(null)
  const [styleUrl, setStyleUrl] = useState<string | null>(null)

  const groups = useMemo(() => groupsForScene(scene), [scene])
  const activeCount = useMemo(() => countActiveParams(values, scene), [values, scene])

  // 清晰度与比例随模型联动，避免出现该模型不支持的组合
  const qualities = useMemo(
    () => imageModelSettings[model]?.qualities ?? ["1K", "2K", "4K"],
    [model]
  )
  const ratios = useMemo(() => getImageRatiosForSelection(model, quality), [model, quality])

  useEffect(() => {
    if (!qualities.includes(quality)) setQuality(qualities[0] ?? "")
  }, [qualities, quality])

  useEffect(() => {
    if (ratios.length > 0 && !ratios.includes(ratio)) setRatio(ratios[0])
  }, [ratios, ratio])

  const mode: RenderMode = baseFile ? "redraw" : "text-to-image"
  const composed = useMemo(
    () => composePrompt({ description, mode, scene, values }),
    [description, mode, scene, values]
  )

  // 释放本地预览 URL
  useEffect(() => {
    return () => {
      if (baseUrl) URL.revokeObjectURL(baseUrl)
    }
  }, [baseUrl])
  useEffect(() => {
    return () => {
      if (styleUrl) URL.revokeObjectURL(styleUrl)
    }
  }, [styleUrl])

  if (!open) return null

  function pickBase(file: File) {
    if (baseUrl) URL.revokeObjectURL(baseUrl)
    setBaseFile(file)
    setBaseUrl(URL.createObjectURL(file))
  }

  function clearBase() {
    if (baseUrl) URL.revokeObjectURL(baseUrl)
    setBaseFile(null)
    setBaseUrl(null)
  }

  function pickStyle(file: File) {
    if (styleUrl) URL.revokeObjectURL(styleUrl)
    setStyleFile(file)
    setStyleUrl(URL.createObjectURL(file))
  }

  function clearStyle() {
    if (styleUrl) URL.revokeObjectURL(styleUrl)
    setStyleFile(null)
    setStyleUrl(null)
  }

  function resetParams() {
    setValues(createDefaultParamValues())
    setDescription("")
  }

  async function submit(submitMode: RenderMode, overrideBase?: File) {
    const finalBase = overrideBase ?? baseFile
    const finalPrompt = composePrompt({
      description,
      mode: submitMode,
      scene,
      values,
    }).prompt

    await onSubmit({
      baseFile: finalBase,
      mode: submitMode,
      model,
      prompt: finalPrompt,
      quality,
      ratio,
      styleFile,
    })
  }

  return (
    <>
      <aside className="absolute bottom-3 left-3 top-3 z-20 flex w-[19rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2.5">
          <Wand2 className="h-4 w-4 shrink-0 text-cyan-600" />
          <h2 className="text-sm font-semibold text-slate-900">快捷渲染</h2>
          {activeCount > 0 ? (
            <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[11px] font-medium text-cyan-700">
              {activeCount} 项
            </span>
          ) : null}
          <button
            aria-label="关闭快捷渲染面板"
            className="ml-auto rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
          {/* 图片双槽 */}
          <div className="grid grid-cols-2 gap-2">
            <ImageSlot
              hint="可选"
              label="底图"
              onClear={clearBase}
              onPick={pickBase}
              url={baseUrl}
            />
            <ImageSlot
              hint="可选"
              label="风格参考"
              onClear={clearStyle}
              onPick={pickStyle}
              url={styleUrl}
            />
          </div>

          {baseUrl ? (
            <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] leading-relaxed text-slate-500">
              已放入底图，将按「整图重绘」保留原构图；也可点下方「局部精修」只改涂选区域。
            </p>
          ) : null}

          {/* 场景切换 */}
          <Field label="场景">
            <div className="flex flex-wrap gap-1">
              {renderSceneOptions.map((option) => (
                <button
                  className={`rounded-lg border px-2 py-1 text-[11px] transition ${
                    scene === option.value
                      ? "border-cyan-300 bg-cyan-50 text-cyan-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  key={option.value}
                  onClick={() => setScene(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          {/* 补充描述 */}
          <Field label="补充描述">
            <textarea
              className="min-h-16 w-full resize-y rounded-lg border border-slate-200 px-2 py-1.5 text-xs leading-relaxed text-slate-700 outline-none transition focus:border-cyan-400"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="补充画面重点，例如：靠窗有一张长木餐桌"
              value={description}
            />
          </Field>

          {/* 参数体系 */}
          <div className="flex flex-col gap-2">
            {groups.map((group) => (
              <Field key={group.key} label={group.label}>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-cyan-400"
                  onChange={(event) =>
                    setValues((previous) => ({ ...previous, [group.key]: event.target.value }))
                  }
                  value={values[group.key] ?? AUTO_VALUE}
                >
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>

          {/* 出图设置 */}
          <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-2">
            <Field label="模型">
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-cyan-400"
                onChange={(event) => setModel(event.target.value)}
                value={model}
              >
                {imageModelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="比例">
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-cyan-400"
                  onChange={(event) => setRatio(event.target.value)}
                  value={ratio}
                >
                  {ratios.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="清晰度">
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-cyan-400"
                  onChange={(event) => setQuality(event.target.value)}
                  value={quality}
                >
                  {qualities.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {/* 提示词预览 */}
          <div className="rounded-xl border border-slate-200">
            <button
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
              onClick={() => setShowPrompt((previous) => !previous)}
              type="button"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition ${showPrompt ? "rotate-0" : "-rotate-90"}`}
              />
              查看组装后的提示词
            </button>
            {showPrompt ? (
              <p className="max-h-32 overflow-y-auto border-t border-slate-100 px-2 py-1.5 text-[11px] leading-relaxed text-slate-500">
                {composed.prompt}
              </p>
            ) : null}
          </div>
        </div>

        {/* 底部操作 */}
        <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-100 px-3 py-2.5">
          <button
            className="flex items-center justify-center gap-1.5 rounded-xl bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => submit(mode)}
            type="button"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {baseFile ? "整图重绘" : "生成效果图"}
          </button>

          <div className="flex items-center gap-2">
            <button
              className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!baseUrl || busy}
              onClick={() => setMaskOpen(true)}
              title={baseUrl ? "涂选局部区域重绘" : "请先放入底图"}
              type="button"
            >
              局部精修
            </button>
            <button
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600 transition hover:bg-slate-50"
              onClick={resetParams}
              type="button"
            >
              <RotateCcw className="mr-1 inline h-3 w-3" />
              重置
            </button>
          </div>
        </footer>
      </aside>

      {maskOpen && baseUrl ? (
        <MaskEditor
          busy={busy}
          imageUrl={baseUrl}
          onCancel={() => setMaskOpen(false)}
          onConfirm={async (composited) => {
            setMaskOpen(false)
            await submit("inpaint", composited)
          }}
        />
      ) : null}
    </>
  )
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}
