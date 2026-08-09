"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Brush, Loader2, RefreshCw, Sparkles, Wand2, X } from "lucide-react"
import {
  getImageRatiosForSelection,
  imageModelOptions,
  imageModelSettings,
  manjuNanoBanana2ImageModelName,
} from "@/lib/model-options"
import {
  createImageGenerationTask,
  pollImageTask,
  uploadReferenceImageFile,
  uploadReferenceImageFromUrl,
} from "@/lib/digital-canvas/api"
import { composeRenderPrompt, type RenderMode } from "@/lib/digital-canvas/prompt-composer"
import {
  AUTO_VALUE,
  countActiveSelections,
  createDefaultSelection,
  getVisibleCategories,
  renderDisciplineOptions,
  type RenderDiscipline,
  type RenderParamSelection,
} from "@/lib/digital-canvas/render-params"
import type { StoredReferenceImage } from "@/lib/reference-images"
import { ImageSlot, type SlotImage } from "@/components/digital-canvas/panels/image-slot"
import { MaskEditor } from "@/components/digital-canvas/panels/mask-editor"

const defaultModel = imageModelOptions.includes(manjuNanoBanana2ImageModelName)
  ? manjuNanoBanana2ImageModelName
  : imageModelOptions[0]

interface QuickRenderPanelProps {
  onClose: () => void
  // 生成结果回填到画布（派生图片节点）
  onResults: (urls: string[]) => void
  // 从画布当前选中的图片类节点取图
  pickSelectedCanvasImage: () => string | null
}

export function QuickRenderPanel({ onClose, onResults, pickSelectedCanvasImage }: QuickRenderPanelProps) {
  const [discipline, setDiscipline] = useState<RenderDiscipline>("interior")
  const [selection, setSelection] = useState<RenderParamSelection>(() => createDefaultSelection())
  const [baseImage, setBaseImage] = useState<SlotImage | null>(null)
  const [referenceImage, setReferenceImage] = useState<SlotImage | null>(null)
  const [prompt, setPrompt] = useState("")
  const [promptDirty, setPromptDirty] = useState(false)
  const [maskOpen, setMaskOpen] = useState(false)

  const [model, setModel] = useState(defaultModel)
  const [quality, setQuality] = useState(() => imageModelSettings[defaultModel]?.qualities?.[0] ?? "1K")
  const [ratio, setRatio] = useState(() => getImageRatiosForSelection(defaultModel, quality)[0] ?? "默认")
  const [imageCount, setImageCount] = useState(1)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState("")
  const [results, setResults] = useState<string[]>([])

  const panelRef = useRef<HTMLElement | null>(null)

  const qualities = useMemo(() => imageModelSettings[model]?.qualities ?? ["1K"], [model])
  const ratios = useMemo(() => getImageRatiosForSelection(model, quality), [model, quality])
  const categories = useMemo(() => getVisibleCategories(discipline), [discipline])
  const activeCount = useMemo(() => countActiveSelections(discipline, selection), [discipline, selection])

  const composed = useMemo(
    () =>
      composeRenderPrompt({
        discipline,
        hasBaseImage: Boolean(baseImage),
        hasReferenceImage: Boolean(referenceImage),
        mode: "full",
        selection,
      }),
    [baseImage, discipline, referenceImage, selection]
  )

  // 参数变化时自动组装提示词；用户手动编辑后不再覆盖。
  useEffect(() => {
    if (promptDirty) return
    setPrompt(composed)
  }, [composed, promptDirty])

  // Ctrl+V 粘贴图片：优先填图1，图1 已有则填图2。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return
      if (!panelRef.current) return

      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"))
      if (!file) return
      event.preventDefault()
      const slot: SlotImage = { file, name: file.name, url: URL.createObjectURL(file) }
      if (!baseImage) setBaseImage(slot)
      else setReferenceImage(slot)
    }

    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [baseImage])

  const takeFromCanvas = useCallback(
    (target: "base" | "reference") => {
      const url = pickSelectedCanvasImage()
      if (!url) {
        setError("请先在画布上选中一个图片节点。")
        return
      }
      setError("")
      const slot: SlotImage = { url }
      if (target === "base") setBaseImage(slot)
      else setReferenceImage(slot)
    },
    [pickSelectedCanvasImage]
  )

  // 图槽 → 参考图存储（已上传过则复用）。
  const resolveStored = useCallback(async (slot: SlotImage) => {
    if (slot.stored) return slot.stored
    return slot.file ? uploadReferenceImageFile(slot.file) : uploadReferenceImageFromUrl(slot.url)
  }, [])

  const runGeneration = useCallback(
    async (mode: RenderMode, maskedBaseFile?: File) => {
      const finalPrompt = promptDirty
        ? prompt.trim()
        : composeRenderPrompt({
            discipline,
            hasBaseImage: Boolean(baseImage) || Boolean(maskedBaseFile),
            hasReferenceImage: Boolean(referenceImage),
            mode,
            selection,
          })

      if (!finalPrompt) {
        setError("提示词不能为空。")
        return
      }

      setRunning(true)
      setError("")
      setProgress(0)
      setResults([])

      try {
        const referenceImages: StoredReferenceImage[] = []

        // 图1：局部精修用涂选后的合成图替代原底图。
        if (maskedBaseFile) {
          referenceImages.push(await uploadReferenceImageFile(maskedBaseFile))
        } else if (baseImage) {
          const stored = await resolveStored(baseImage)
          setBaseImage((current) => (current ? { ...current, stored } : current))
          referenceImages.push(stored)
        }

        // 图2：参考图
        if (referenceImage) {
          const stored = await resolveStored(referenceImage)
          setReferenceImage((current) => (current ? { ...current, stored } : current))
          referenceImages.push(stored)
        }

        const task = await createImageGenerationTask({
          imageCount,
          model,
          prompt: finalPrompt,
          quality,
          ratio,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        })

        const result = await pollImageTask(task.taskId, {
          initialImageUrls: task.imageUrls ?? [],
          onProgress: setProgress,
        })

        if (result.imageUrls.length === 0) {
          setError("生成未返回图片，请稍后重试。")
          return
        }

        setResults(result.imageUrls)
        setProgress(100)
        onResults(result.imageUrls)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "生成失败，请稍后重试。")
      } finally {
        setRunning(false)
      }
    },
    [
      baseImage,
      discipline,
      imageCount,
      model,
      onResults,
      prompt,
      promptDirty,
      quality,
      ratio,
      referenceImage,
      resolveStored,
      selection,
    ]
  )

  const handleInpaint = useCallback(() => {
    if (!baseImage) {
      setError("局部精修需要先放入图1 底图。")
      return
    }
    setError("")
    setMaskOpen(true)
  }, [baseImage])

  return (
    <aside
      className="flex h-full w-[22rem] shrink-0 flex-col border-r border-slate-200 bg-white"
      ref={panelRef}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
        <Wand2 className="h-4 w-4 text-cyan-600" />
        <span className="text-sm font-semibold text-slate-800">快捷渲染</span>
        {activeCount > 0 ? (
          <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700">
            {activeCount} 项参数
          </span>
        ) : null}
        <button
          className="ml-auto rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <section className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <ImageSlot
              hint="图1 底图"
              label="图1 底图"
              onChange={setBaseImage}
              value={baseImage}
            />
            <button
              className="text-[11px] text-cyan-700 transition hover:text-cyan-900"
              onClick={() => takeFromCanvas("base")}
              type="button"
            >
              取选中节点
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <ImageSlot
              hint="图2 参考图"
              label="图2 参考图"
              onChange={setReferenceImage}
              value={referenceImage}
            />
            <button
              className="text-[11px] text-cyan-700 transition hover:text-cyan-900"
              onClick={() => takeFromCanvas("reference")}
              type="button"
            >
              取选中节点
            </button>
          </div>
        </section>

        <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-500">
          图1 提供空间结构，图2 提供光影材质参考。支持点击选择、拖入图片，或在面板内直接 Ctrl+V 粘贴。
        </p>

        <section className="space-y-2">
          <span className="text-[11px] font-medium text-slate-600">大类</span>
          <div className="flex gap-1.5">
            {renderDisciplineOptions.map((option) => (
              <button
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition ${
                  discipline === option.value
                    ? "border-cyan-300 bg-cyan-50 font-medium text-cyan-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                key={option.value}
                onClick={() => setDiscipline(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2.5">
          {categories.map((category) =>
            category.multiple ? (
              <div className="space-y-1.5" key={category.key}>
                <span className="text-[11px] font-medium text-slate-600">{category.label}</span>
                <div className="flex flex-wrap gap-1.5">
                  {category.options.map((option) => {
                    const current = selection[category.key]
                    const values = Array.isArray(current) ? current : []
                    const checked = values.includes(option.value)
                    return (
                      <button
                        className={`rounded-full border px-2 py-1 text-[11px] transition ${
                          checked
                            ? "border-cyan-300 bg-cyan-50 text-cyan-700"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                        key={option.value}
                        onClick={() =>
                          setSelection((current) => {
                            const list = Array.isArray(current[category.key])
                              ? (current[category.key] as string[])
                              : []
                            return {
                              ...current,
                              [category.key]: checked
                                ? list.filter((value) => value !== option.value)
                                : list.concat(option.value),
                            }
                          })
                        }
                        type="button"
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <label className="flex items-center gap-2 text-[11px] text-slate-600" key={category.key}>
                <span className="w-16 shrink-0">{category.label}</span>
                <select
                  className={`min-w-0 flex-1 rounded-lg border bg-white px-2 py-1.5 text-xs outline-none transition focus:border-cyan-300 ${
                    selection[category.key] === AUTO_VALUE
                      ? "border-slate-200 text-slate-500"
                      : "border-cyan-200 text-slate-900"
                  }`}
                  onChange={(event) =>
                    setSelection((current) => ({ ...current, [category.key]: event.target.value }))
                  }
                  value={(selection[category.key] as string) ?? AUTO_VALUE}
                >
                  {category.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )
          )}
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-600">提示词</span>
            <button
              className="flex items-center gap-1 text-[11px] text-cyan-700 transition hover:text-cyan-900"
              onClick={() => {
                setPromptDirty(false)
                setPrompt(composed)
              }}
              type="button"
            >
              <RefreshCw className="h-3 w-3" />
              重新组装
            </button>
          </div>
          <textarea
            className="h-28 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-xs leading-relaxed text-slate-900 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
            onChange={(event) => {
              setPrompt(event.target.value)
              setPromptDirty(true)
            }}
            value={prompt}
          />
          {promptDirty ? (
            <span className="text-[10px] text-amber-600">已手动编辑，参数变化不再自动覆盖</span>
          ) : null}
        </section>

        <section className="grid grid-cols-2 gap-2">
          <label className="col-span-2 flex flex-col gap-1 text-[11px] text-slate-500">
            模型
            <select
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-cyan-300"
              onChange={(event) => {
                const next = event.target.value
                const nextQualities = imageModelSettings[next]?.qualities ?? ["1K"]
                const nextRatios = getImageRatiosForSelection(next, nextQualities[0])
                setModel(next)
                setQuality(nextQualities[0])
                setRatio(nextRatios[0] ?? "默认")
              }}
              value={model}
            >
              {imageModelOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            画质
            <select
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-cyan-300"
              onChange={(event) => {
                const next = event.target.value
                const nextRatios = getImageRatiosForSelection(model, next)
                setQuality(next)
                if (!nextRatios.includes(ratio)) setRatio(nextRatios[0] ?? "默认")
              }}
              value={quality}
            >
              {qualities.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            比例
            <select
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-cyan-300"
              onChange={(event) => setRatio(event.target.value)}
              value={ratio}
            >
              {ratios.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            张数
            <select
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-cyan-300"
              onChange={(event) => setImageCount(Number(event.target.value))}
              value={imageCount}
            >
              {[1, 2, 3, 4].map((option) => (
                <option key={option} value={option}>
                  {option} 张
                </option>
              ))}
            </select>
          </label>
        </section>

        {error ? (
          <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-600">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {results.length > 0 ? (
          <section className="space-y-1.5">
            <span className="text-[11px] font-medium text-slate-600">本次结果</span>
            <div className="grid grid-cols-2 gap-2">
              {results.map((url) => (
                <div className="overflow-hidden rounded-lg border border-slate-200" key={url}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="渲染结果" className="h-24 w-full object-cover" src={url} />
                  <button
                    className="w-full bg-slate-50 py-1 text-[10px] text-slate-600 transition hover:bg-cyan-50 hover:text-cyan-700"
                    onClick={() => {
                      setBaseImage({ url })
                      setResults([])
                    }}
                    type="button"
                  >
                    设为底图
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <footer className="shrink-0 space-y-2 border-t border-slate-200 px-4 py-3">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={running}
          onClick={() => runGeneration("full")}
          type="button"
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              渲染中 {Math.round(progress)}%
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              整图重绘
            </>
          )}
        </button>
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={running}
          onClick={handleInpaint}
          type="button"
        >
          <Brush className="h-3.5 w-3.5" />
          局部精修
        </button>
      </footer>

      {maskOpen && baseImage ? (
        <MaskEditor
          imageUrl={baseImage.url}
          onCancel={() => setMaskOpen(false)}
          onConfirm={(file) => {
            setMaskOpen(false)
            void runGeneration("inpaint", file)
          }}
        />
      ) : null}
    </aside>
  )
}
