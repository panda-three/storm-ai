"use client"

import { useMemo, useState, type DragEvent } from "react"
import Image from "next/image"
import { Download, ExternalLink, ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const generatedImagePathPrefixes = [
  "/supabase/storage/v1/object/public/generated-images/",
  "/storage/v1/object/public/generated-images/",
]

function getConfiguredSupabaseHostname() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!value) return "www.zlaction.online"

  try {
    return new URL(value).hostname
  } catch {
    return "www.zlaction.online"
  }
}

export function isOptimizableGeneratedImageUrl(src: string) {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return false

  try {
    const parsed = new URL(src, typeof window === "undefined" ? "https://www.zlaction.online" : window.location.href)
    if (parsed.protocol !== "https:") return false

    const allowedHosts = new Set([getConfiguredSupabaseHostname(), "www.zlaction.online"])
    if (!allowedHosts.has(parsed.hostname)) return false

    return generatedImagePathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix))
  } catch {
    return false
  }
}

export function GeneratedImage({
  alt,
  className,
  fallbackClassName,
  fallbackIconClassName = "h-8 w-8",
  fill = false,
  height,
  loading = "lazy",
  onError,
  priority = false,
  quality = 78,
  showMessage = false,
  sizes,
  src,
  width,
}: {
  alt: string
  className: string
  fallbackClassName: string
  fallbackIconClassName?: string
  fill?: boolean
  height?: number
  loading?: "eager" | "lazy"
  onError?: () => void
  priority?: boolean
  quality?: number
  showMessage?: boolean
  sizes: string
  src: string
  width?: number
}) {
  const [hasError, setHasError] = useState(false)
  const canOptimize = useMemo(() => isOptimizableGeneratedImageUrl(src), [src])

  if (hasError) {
    return (
      <div className={cn("flex items-center justify-center", fallbackClassName)}>
        <div className="grid justify-items-center gap-2 px-4 text-center text-white/85">
          <ImageIcon className={cn("drop-shadow-sm", fallbackIconClassName)} />
          {showMessage && <div className="text-xs font-medium">图片地址不可访问</div>}
        </div>
      </div>
    )
  }

  const handleError = () => {
    setHasError(true)
    onError?.()
  }
  const handleDragStart = (event: DragEvent<HTMLImageElement>) => {
    event.preventDefault()
  }
  const imageClassName = cn("select-none", className)

  if (canOptimize) {
    return fill ? (
      <Image
        alt={alt}
        className={imageClassName}
        decoding="async"
        draggable={false}
        fill
        loading={priority ? undefined : loading}
        onDragStart={handleDragStart}
        onError={handleError}
        priority={priority}
        quality={quality}
        sizes={sizes}
        src={src}
      />
    ) : (
      <Image
        alt={alt}
        className={imageClassName}
        decoding="async"
        draggable={false}
        height={height ?? 900}
        loading={priority ? undefined : loading}
        onDragStart={handleDragStart}
        onError={handleError}
        priority={priority}
        quality={quality}
        sizes={sizes}
        src={src}
        width={width ?? 900}
      />
    )
  }

  return (
    <img
      alt={alt}
      className={imageClassName}
      decoding="async"
      draggable={false}
      loading={loading}
      onDragStart={handleDragStart}
      onError={handleError}
      src={src}
    />
  )
}

export function ResultImageViewer({
  alt,
  downloadLabel = "下载原图",
  onDownload,
  onOpenChange,
  open,
  src,
  title = "查看结果",
}: {
  alt: string
  downloadLabel?: string
  onDownload?: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  src: string
  title?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[min(96vw,1200px)] gap-3 border-slate-200 bg-white p-3 sm:p-4">
        <DialogHeader className="px-1 text-left">
          <DialogTitle className="text-base text-slate-950">{title}</DialogTitle>
          <DialogDescription>默认显示快速预览，原图仍可打开或下载。</DialogDescription>
        </DialogHeader>
        <div className="relative flex h-[72vh] min-h-[320px] items-center justify-center overflow-hidden rounded-lg bg-slate-950">
          {src ? (
            <GeneratedImage
              alt={alt}
              className="object-contain"
              fallbackClassName="h-full w-full bg-slate-900 text-slate-300"
              fill
              priority
              quality={82}
              showMessage
              sizes="(max-width: 768px) 96vw, 1200px"
              src={src}
            />
          ) : (
            <div className="grid justify-items-center gap-2 text-sm text-slate-300">
              <ImageIcon className="h-8 w-8" />
              暂无图片
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            className="bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950"
            disabled={!src}
            onClick={() => src && window.open(src, "_blank", "noopener,noreferrer")}
            type="button"
            variant="outline"
          >
            <ExternalLink className="h-4 w-4" />
            打开原图
          </Button>
          <Button
            className="bg-slate-950 text-white hover:bg-slate-800"
            disabled={!src || !onDownload}
            onClick={onDownload}
            type="button"
          >
            <Download className="h-4 w-4" />
            {downloadLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
