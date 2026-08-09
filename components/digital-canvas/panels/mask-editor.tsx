"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Brush, Eraser, Loader2 } from "lucide-react"

// 局部精修涂选：在底图上涂出要重绘的区域。
// 现阶段生成接口尚无独立 mask 参数，因此把「底图 + 半透明标注」合成一张图作为图1 传给模型，
// 并配合提示词「只重绘我在图1中标注的区域」实现局部精修；待后端开放 mask 参数后可直接替换。

const maskColor = "rgba(255, 0, 128, 0.45)"
const maxLongSide = 1536

// 远端图片经同源代理加载，避免 canvas 被跨域污染导致无法导出。
function resolveDrawableSrc(url: string) {
  if (url.startsWith("blob:") || url.startsWith("data:")) return url
  return `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent("mask-base.png")}`
}

interface MaskEditorProps {
  imageUrl: string
  onCancel: () => void
  onConfirm: (file: File) => void
}

export function MaskEditor({ imageUrl, onCancel, onConfirm }: MaskEditorProps) {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)

  const [brushSize, setBrushSize] = useState(48)
  const [erasing, setErasing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [hasStrokes, setHasStrokes] = useState(false)

  // 载入底图并按长边限制缩放，两层 canvas 尺寸保持一致。
  useEffect(() => {
    let active = true
    const image = new Image()
    image.crossOrigin = "anonymous"

    image.onload = () => {
      if (!active) return
      const scale = Math.min(1, maxLongSide / Math.max(image.naturalWidth, image.naturalHeight))
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))

      for (const canvas of [baseCanvasRef.current, maskCanvasRef.current]) {
        if (!canvas) continue
        canvas.width = width
        canvas.height = height
      }

      const context = baseCanvasRef.current?.getContext("2d")
      context?.drawImage(image, 0, 0, width, height)
      imageRef.current = image
      setLoading(false)
    }

    image.onerror = () => {
      if (!active) return
      setError("底图加载失败，无法涂选。")
      setLoading(false)
    }

    image.src = resolveDrawableSrc(imageUrl)
    return () => {
      active = false
    }
  }, [imageUrl])

  const getCanvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }, [])

  const drawTo = useCallback(
    (point: { x: number; y: number }) => {
      const canvas = maskCanvasRef.current
      const context = canvas?.getContext("2d")
      if (!canvas || !context) return

      // 画笔半径按显示比例换算到 canvas 实际像素。
      const rect = canvas.getBoundingClientRect()
      const ratio = rect.width > 0 ? canvas.width / rect.width : 1
      context.globalCompositeOperation = erasing ? "destination-out" : "source-over"
      context.strokeStyle = maskColor
      context.fillStyle = maskColor
      context.lineCap = "round"
      context.lineJoin = "round"
      context.lineWidth = brushSize * ratio

      const last = lastPointRef.current
      if (last) {
        context.beginPath()
        context.moveTo(last.x, last.y)
        context.lineTo(point.x, point.y)
        context.stroke()
      } else {
        context.beginPath()
        context.arc(point.x, point.y, (brushSize * ratio) / 2, 0, Math.PI * 2)
        context.fill()
      }

      lastPointRef.current = point
      if (!erasing) setHasStrokes(true)
    },
    [brushSize, erasing]
  )

  const clearMask = useCallback(() => {
    const canvas = maskCanvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
  }, [])

  // 合成「底图 + 标注」并导出为 PNG 文件。
  const handleConfirm = useCallback(() => {
    const base = baseCanvasRef.current
    const mask = maskCanvasRef.current
    if (!base || !mask) return

    const output = document.createElement("canvas")
    output.width = base.width
    output.height = base.height
    const context = output.getContext("2d")
    if (!context) return

    context.drawImage(base, 0, 0)
    context.drawImage(mask, 0, 0)

    output.toBlob((blob) => {
      if (!blob) {
        setError("涂选结果导出失败，请重试。")
        return
      }
      onConfirm(new File([blob], "masked-base.png", { type: "image/png" }))
    }, "image/png")
  }, [onConfirm])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Brush className="h-4 w-4 text-cyan-600" />
          <span className="text-sm font-semibold text-slate-800">涂选要重绘的区域</span>
          <span className="text-[11px] text-slate-400">涂抹处会被重绘，其余部分保持不变</span>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100 p-4">
          {loading ? (
            <span className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              底图加载中...
            </span>
          ) : error ? (
            <span className="text-sm text-rose-600">{error}</span>
          ) : (
            <div className="relative max-h-full">
              <canvas className="max-h-[60vh] w-auto rounded-lg" ref={baseCanvasRef} />
              <canvas
                className="absolute inset-0 h-full w-full cursor-crosshair rounded-lg"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  drawingRef.current = true
                  lastPointRef.current = null
                  const point = getCanvasPoint(event)
                  if (point) drawTo(point)
                }}
                onPointerMove={(event) => {
                  if (!drawingRef.current) return
                  const point = getCanvasPoint(event)
                  if (point) drawTo(point)
                }}
                onPointerUp={() => {
                  drawingRef.current = false
                  lastPointRef.current = null
                }}
                ref={maskCanvasRef}
              />
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
          <label className="flex items-center gap-2 text-[11px] text-slate-500">
            画笔
            <input
              className="w-28 accent-cyan-600"
              max={160}
              min={8}
              onChange={(event) => setBrushSize(Number(event.target.value))}
              type="range"
              value={brushSize}
            />
            <span className="w-8 tabular-nums text-slate-600">{brushSize}</span>
          </label>

          <button
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
              erasing
                ? "border-cyan-200 bg-cyan-50 text-cyan-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            onClick={() => setErasing((value) => !value)}
            type="button"
          >
            <Eraser className="h-3.5 w-3.5" />
            橡皮
          </button>

          <button
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
            onClick={clearMask}
            type="button"
          >
            清除涂选
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              disabled={loading || Boolean(error) || !hasStrokes}
              onClick={handleConfirm}
              type="button"
            >
              确认涂选并生成
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
