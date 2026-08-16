"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, ImageIcon, ImagePlus, Loader2, X } from "lucide-react"

import {
  getImageRatiosForSelection,
} from "@/lib/model-options"
import { getAvailableQualities, getPreferredImageQuality } from "@/lib/studio-options"
import type { ModelConfig, PublicModelPricing } from "@/lib/supabase"
import {
  maxReferenceImageBytes,
  maxReferenceImages,
  supportedReferenceImageTypes,
} from "@/lib/reference-images"

export interface CustomRenderSubmit {
  prompt: string
  model: string
  ratio: string
  quality: string
  imageCount: number
  /** 多张参考图（最多 4 张） */
  files: File[]
}

interface CustomRenderPanelProps {
  open: boolean
  busy?: boolean
  imageModels: ModelConfig[]
  modelOptionsReady: boolean
  modelPricing: PublicModelPricing[]
  onClose: () => void
  onSubmit: (input: CustomRenderSubmit) => Promise<void> | void
}

interface PickedImage {
  id: string
  file: File
  previewUrl: string
}

const imageCountOptions = [1, 2, 3, 4]

export function CustomRenderPanel({
  busy = false,
  imageModels,
  modelOptionsReady,
  modelPricing,
  onClose,
  onSubmit,
  open,
}: CustomRenderPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<PickedImage[]>([])
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState("")
  const [quality, setQuality] = useState("")
  const [ratio, setRatio] = useState("")
  const [imageCount, setImageCount] = useState(1)
  const [error, setError] = useState("")
  const defaultModel = imageModels.find((item) => item.initial_selected)?.model ?? imageModels[0]?.model ?? ""

  const qualities = useMemo(() => getAvailableQualities(modelPricing, "image", model), [model, modelPricing])
  const ratios = useMemo(() => getImageRatiosForSelection(model, quality), [model, quality])
  const canSubmit = modelOptionsReady && imageModels.length > 0 && Boolean(model)

  useEffect(() => {
    if (!imageModels.some((item) => item.model === model)) {
      setModel(defaultModel)
    }
  }, [defaultModel, imageModels, model])

  useEffect(() => {
    if (!qualities.includes(quality)) setQuality(getPreferredImageQuality(model, qualities))
  }, [model, qualities, quality])

  useEffect(() => {
    if (ratios.length > 0 && !ratios.includes(ratio)) setRatio(ratios[0])
  }, [ratios, ratio])

  // 卸载时回收本地预览地址
  useEffect(() => {
    return () => {
      setImages((current) => {
        current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
        return []
      })
    }
  }, [])

  if (!open) return null

  function addFiles(fileList: FileList | null) {
    const incoming = Array.from(fileList ?? [])
    if (incoming.length === 0) return

    const slots = maxReferenceImages - images.length
    if (slots <= 0) {
      setError(`参考图最多上传 ${maxReferenceImages} 张。`)
      return
    }

    let nextError = ""
    const accepted: PickedImage[] = []
    for (const file of incoming) {
      if (accepted.length >= slots) {
        nextError = `参考图最多上传 ${maxReferenceImages} 张，已保留前 ${slots} 张。`
        break
      }
      if (!supportedReferenceImageTypes.includes(file.type)) {
        nextError = "参考图仅支持 JPG、PNG、WebP 格式。"
        continue
      }
      if (file.size > maxReferenceImageBytes) {
        nextError = "单张参考图不能超过 10MB。"
        continue
      }
      accepted.push({
        file,
        id: `${file.name}_${file.size}_${Math.random().toString(36).slice(2, 8)}`,
        previewUrl: URL.createObjectURL(file),
      })
    }

    if (accepted.length > 0) setImages((current) => current.concat(accepted))
    setError(nextError)
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((item) => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((item) => item.id !== id)
    })
  }

  async function submit() {
    if (!canSubmit) return
    const trimmed = prompt.trim()
    if (!trimmed) {
      setError("请填写图片描述。")
      return
    }
    const finalModel = imageModels.some((item) => item.model === model) ? model : defaultModel
    const finalQualities = getAvailableQualities(modelPricing, "image", finalModel)
    const finalQuality = finalQualities.includes(quality)
      ? quality
      : getPreferredImageQuality(finalModel, finalQualities)
    const finalRatios = getImageRatiosForSelection(finalModel, finalQuality)
    const finalRatio = finalRatios.includes(ratio) ? ratio : finalRatios[0] ?? ""
    setError("")
    await onSubmit({
      files: images.map((item) => item.file),
      imageCount,
      model: finalModel,
      prompt: trimmed,
      quality: finalQuality,
      ratio: finalRatio,
    })
  }

  return (
    <section
      className="absolute bottom-4 left-1/2 z-30 w-[min(58rem,calc(100%-6rem))] -translate-x-1/2 rounded-[28px] border border-slate-200 bg-white/97 p-4 shadow-[0_20px_50px_rgba(15,23,42,0.14)] backdrop-blur"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        addFiles(event.dataTransfer.files)
      }}
    >
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">自定义渲染</h2>
        <span className="text-[11px] text-slate-400">自由描述 + 多张参考图，直接在画布出图</span>
        <button
          aria-label="关闭自定义渲染"
          className="ml-auto rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex items-start gap-4">
        {/* 参考图列 */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <button
            className="grid h-[116px] w-[68px] place-items-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-slate-400 transition hover:border-cyan-200 hover:bg-cyan-50/70 hover:text-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || images.length >= maxReferenceImages}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <span className="grid justify-items-center gap-2 text-center text-xs">
              <ImagePlus className="h-5 w-5" />
              添加参考图
            </span>
          </button>
          <span className="text-[11px] text-slate-400">
            {images.length}/{maxReferenceImages} 张
          </span>
          <input
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            multiple
            onChange={(event) => {
              addFiles(event.target.files)
              event.target.value = ""
            }}
            ref={inputRef}
            type="file"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((image, index) => (
                <div
                  className="group relative h-14 w-14 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                  key={image.id}
                >
                  <img
                    alt={`参考图 ${index + 1}`}
                    className="h-full w-full object-cover"
                    src={image.previewUrl}
                  />
                  <button
                    aria-label={`移除参考图 ${index + 1}`}
                    className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-slate-950/85 text-white opacity-0 transition group-hover:opacity-100"
                    disabled={busy}
                    onClick={() => removeImage(image.id)}
                    type="button"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <textarea
            className="min-h-24 w-full resize-y border-b border-slate-200 bg-transparent pb-2 text-sm leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述你想生成的图片，例如：现代极简客餐厅，浅木色地板，隐藏灯带，适合小户型。"
            value={prompt}
          />

          <div className="flex flex-wrap items-center gap-2">
            <PillSelect
              icon={ImageIcon}
              onChange={setModel}
              options={
                imageModels.length > 0
                  ? imageModels.map((option) => ({ label: option.display_name, value: option.model }))
                  : [
                      {
                        label: modelOptionsReady ? "暂无可用图片模型" : "模型加载中...",
                        value: "",
                      },
                    ]
              }
              value={model}
            />
            <PillSelect
              onChange={setQuality}
              options={qualities.map((option) => ({ label: option, value: option }))}
              value={quality}
            />
            <PillSelect
              onChange={setRatio}
              options={ratios.map((option) => ({ label: option, value: option }))}
              value={ratio}
            />
            <PillSelect
              onChange={(value) => setImageCount(Number(value))}
              options={imageCountOptions.map((option) => ({
                label: `${option} 张`,
                value: String(option),
              }))}
              value={String(imageCount)}
            />

            <button
              className="ml-auto flex h-11 items-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy || !canSubmit}
              onClick={submit}
              type="button"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              {!modelOptionsReady ? "模型加载中" : imageModels.length === 0 ? "暂无可用模型" : "生成图片"}
            </button>
          </div>

          {error ? <p className="text-[11px] text-rose-500">{error}</p> : null}
        </div>
      </div>
    </section>
  )
}

function PillSelect({
  icon: Icon,
  onChange,
  options,
  value,
}: {
  icon?: React.ComponentType<{ className?: string }>
  onChange: (value: string) => void
  options: { label: string; value: string }[]
  value: string
}) {
  return (
    <label className="relative inline-flex h-11 max-w-56 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-800 transition hover:border-cyan-200 hover:bg-cyan-50/40">
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-slate-500" /> : null}
      <select
        className="min-w-0 max-w-40 cursor-pointer truncate bg-transparent pr-1 outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
