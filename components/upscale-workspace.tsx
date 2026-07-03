"use client"

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, Download, ImageIcon, Loader2, ScanLine, Upload, Wand2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getSupabaseClient } from "@/lib/supabase"
import {
  maxUpscaleInputBytes,
  maxUpscaleOutputEdge,
  resolveUpscaleScale,
  type UpscaleScale,
  validateUpscaleFile,
} from "@/lib/upscale-policy"
import { cn } from "@/lib/utils"

interface SelectedUpscaleImage {
  file: File
  height: number
  name: string
  previewUrl: string
  size: number
  width: number
}

interface UpscaleResult {
  actualScale: UpscaleScale
  fileName: string
  imageUrl: string
  remainingToday: number
  requestedScale: UpscaleScale
  warning: string
}

interface UpscaleApiResponse {
  actualScale?: UpscaleScale
  error?: string
  fileName?: string
  imageUrl?: string
  ok: boolean
  remainingToday?: number
  requestedScale?: UpscaleScale
  warning?: string
}

const upscaleDailyLimit = 10

export function UpscaleWorkspace() {
  const [error, setError] = useState("")
  const [image, setImage] = useState<SelectedUpscaleImage | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [remainingToday, setRemainingToday] = useState<number | null>(null)
  const [requestedScale, setRequestedScale] = useState<UpscaleScale>(2)
  const [result, setResult] = useState<UpscaleResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlRef = useRef("")

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  const scaleResolution = useMemo(() => {
    if (!image) return null
    return resolveUpscaleScale({ height: image.height, requestedScale, width: image.width })
  }, [image, requestedScale])

  const canSubmit = Boolean(image && scaleResolution?.ok && !isSubmitting && remainingToday !== 0)
  const usedToday = remainingToday === null ? null : upscaleDailyLimit - remainingToday

  const acceptFile = async (file: File) => {
    const validation = validateUpscaleFile(file)
    if (!validation.ok) {
      setError(validation.error)
      return
    }

    const previewUrl = URL.createObjectURL(file)
    try {
      const dimensions = await readImageDimensions(previewUrl)
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = previewUrl
      setError("")
      setResult(null)
      setImage({
        file,
        height: dimensions.height,
        name: file.name || "upscale-source",
        previewUrl,
        size: file.size,
        width: dimensions.width,
      })
    } catch {
      URL.revokeObjectURL(previewUrl)
      setError("无法读取图片尺寸，请换一张图片。")
    }
  }

  const clearImage = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = ""
    setError("")
    setImage(null)
    setResult(null)
  }

  const submitUpscale = async () => {
    if (!image || !scaleResolution?.ok || isSubmitting) return

    try {
      setError("")
      setIsSubmitting(true)
      const accessToken = await getCurrentAccessToken()
      const formData = new FormData()
      formData.append("image", image.file)
      formData.append("scale", String(requestedScale))

      const response = await fetch("/api/upscale", {
        body: formData,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: "POST",
      })
      const data = (await response.json().catch(() => null)) as UpscaleApiResponse | null
      if (!response.ok || !data?.ok || !data.imageUrl || !data.actualScale) {
        throw new Error(data?.error || "高清放大失败，请稍后重试。")
      }

      setRemainingToday(typeof data.remainingToday === "number" ? data.remainingToday : null)
      setResult({
        actualScale: data.actualScale,
        fileName: data.fileName || buildResultFilename(image.name),
        imageUrl: data.imageUrl,
        remainingToday: typeof data.remainingToday === "number" ? data.remainingToday : 0,
        requestedScale: data.requestedScale || requestedScale,
        warning: data.warning || "",
      })
    } catch (submitError) {
      setError(submitError instanceof Error && submitError.message ? submitError.message : "高清放大失败，请稍后重试。")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragActive(false)
    const file = event.dataTransfer.files[0]
    if (file) void acceptFile(file)
  }

  const downloadResult = () => {
    if (!result) return
    const url = `/api/download?url=${encodeURIComponent(result.imageUrl)}&filename=${encodeURIComponent(buildResultFilename(result.fileName))}`
    const link = document.createElement("a")
    link.href = url
    link.download = buildResultFilename(result.fileName)
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <section className="mx-auto grid w-full max-w-[1180px] gap-5">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="rounded-full border-cyan-200 bg-cyan-50 text-cyan-700" variant="outline">
            临时结果图
          </Badge>
          <Badge className="rounded-full border-slate-200 bg-white text-slate-600" variant="outline">
            每日 {upscaleDailyLimit} 次成功使用
          </Badge>
        </div>
        <h2 className="text-xl font-semibold text-slate-950">高清放大器</h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          上传一张本地图片，使用 AI 超分放大生成临时结果。结果只在当前页面预览和下载，不进入历史项目。
        </p>
      </div>

      <div className="sticky top-0 z-10 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_12px_32px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {[2, 4].map((scale) => (
              <button
                key={scale}
                className={cn(
                  "h-10 rounded-xl border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                  requestedScale === scale
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
                onClick={() => setRequestedScale(scale as UpscaleScale)}
                type="button"
              >
                {scale}x
              </button>
            ))}
            {usedToday !== null && (
              <span className="text-sm text-slate-500">
                今日已用 {usedToday}/{upscaleDailyLimit}
              </span>
            )}
          </div>
          <Button
            className="h-10 rounded-xl bg-slate-950 text-white hover:bg-slate-800"
            disabled={!canSubmit}
            onClick={submitUpscale}
            type="button"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {remainingToday === 0 ? "今日额度已用完" : isSubmitting ? "处理中" : "开始放大"}
          </Button>
        </div>
      </div>

      {(error || scaleResolution?.warning || (scaleResolution && !scaleResolution.ok) || result?.warning) && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm",
            error || (scaleResolution && !scaleResolution.ok)
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-amber-200 bg-amber-50 text-amber-800"
          )}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error || (scaleResolution && !scaleResolution.ok ? scaleResolution.error : result?.warning || scaleResolution?.warning)}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <PreviewPane imageUrl={image?.previewUrl ?? ""} label="原图" placeholder="上传图片后显示原图" />
        <PreviewPane
          imageUrl={result?.imageUrl ?? ""}
          label="放大结果"
          placeholder={isSubmitting ? "正在生成放大结果..." : "处理完成后显示结果"}
          processing={isSubmitting}
          scale={result?.actualScale}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div
          className={cn(
            "grid min-h-[180px] place-items-center rounded-2xl border border-dashed bg-white p-5 text-center transition",
            isDragActive ? "border-cyan-400 bg-cyan-50" : "border-slate-300"
          )}
          onDragEnter={(event) => {
            event.preventDefault()
            setIsDragActive(true)
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void acceptFile(file)
              event.target.value = ""
            }}
            type="file"
          />
          {image ? (
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3 text-left">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                  <ImageIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950">{image.name}</p>
                  <p className="text-xs text-slate-500">
                    {image.width} x {image.height}px · {formatBytes(image.size)}
                  </p>
                </div>
              </div>
              <Button className="rounded-xl" onClick={clearImage} type="button" variant="outline">
                <X className="h-4 w-4" />
                移除
              </Button>
            </div>
          ) : (
            <div className="grid justify-items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-white">
                <Upload className="h-5 w-5" />
              </div>
              <div className="grid gap-1">
                <p className="text-sm font-semibold text-slate-950">拖入图片或点击上传</p>
                <p className="text-xs text-slate-500">JPG、PNG、WebP，单张不超过 {formatBytes(maxUpscaleInputBytes)}</p>
              </div>
              <Button className="rounded-xl" onClick={() => fileInputRef.current?.click()} type="button" variant="outline">
                选择图片
              </Button>
            </div>
          )}
        </div>

        <div className="grid content-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <ScanLine className="h-4 w-4 text-cyan-600" />
            处理参数
          </div>
          <DetailRow label="输出限制" value={`最长边 ${maxUpscaleOutputEdge}px`} />
          <DetailRow label="请求倍率" value={`${requestedScale}x`} />
          <DetailRow label="实际倍率" value={scaleResolution?.ok ? `${scaleResolution.actualScale}x` : "-"} />
          <DetailRow label="结果保存" value="仅当前会话" />
          {result && (
            <Button className="mt-2 rounded-xl bg-cyan-600 text-white hover:bg-cyan-700" onClick={downloadResult} type="button">
              <Download className="h-4 w-4" />
              下载结果
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

function PreviewPane({
  imageUrl,
  label,
  placeholder,
  processing = false,
  scale,
}: {
  imageUrl: string
  label: string
  placeholder: string
  processing?: boolean
  scale?: UpscaleScale
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex h-8 items-center justify-between">
        <span className="text-sm font-semibold text-slate-950">{label}</span>
        {scale && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {scale}x 完成
          </span>
        )}
      </div>
      <div className="relative grid aspect-[4/3] min-h-[260px] place-items-center overflow-hidden rounded-xl bg-slate-100">
        {imageUrl ? (
          <img alt={label} className="h-full w-full object-contain" src={imageUrl} />
        ) : (
          <div className="grid justify-items-center gap-2 px-4 text-center text-sm text-slate-500">
            {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
            <span>{placeholder}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-950">{value}</span>
    </div>
  )
}

async function getCurrentAccessToken() {
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new Error("登录状态已失效，请重新登录。")
  }
  const { data, error } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (error || !token) {
    throw new Error("登录状态已失效，请重新登录。")
  }

  return token
}

function readImageDimensions(src: string): Promise<{ height: number; width: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ height: image.naturalHeight, width: image.naturalWidth })
    image.onerror = () => reject(new Error("image load failed"))
    image.src = src
  })
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

function buildResultFilename(filename: string) {
  const clean = filename.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n]+/g, "-").trim() || "upscaled"
  return `${clean}-upscaled.png`
}
