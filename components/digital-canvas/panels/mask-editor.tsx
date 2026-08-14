"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Eraser, Loader2, RotateCcw } from "lucide-react"

interface MaskEditorProps {
  imageUrl: string
  onCancel: () => void
  /** 返回叠加了涂选高亮的图片文件，作为局部精修的参考图 */
  onConfirm: (composited: File) => void
  busy?: boolean
}

const MASK_COLOR = "rgba(255, 64, 129, 0.55)"

export function MaskEditor({ busy = false, imageUrl, onCancel, onConfirm }: MaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const drawingRef = useRef(false)
  const [brush, setBrush] = useState(48)
  const [ready, setReady] = useState(false)
  const [hasMask, setHasMask] = useState(false)
  const [loadError, setLoadError] = useState("")

  // 载入底图并铺满画布：先把图片抓成同源 blob，避免跨域污染 canvas 导致无法导出
  useEffect(() => {
    let cancelled = false
    let objectUrl = ""
    const image = new Image()

    setReady(false)
    setHasMask(false)
    setLoadError("")

    async function load() {
      try {
        const response = await fetch(imageUrl)
        if (!response.ok) throw new Error(`图片载入失败（${response.status}）`)
        const blob = await response.blob()
        if (cancelled) return

        objectUrl = URL.createObjectURL(blob)
        image.onload = () => {
          if (cancelled) return
          imageRef.current = image
          setReady(true)
        }
        image.onerror = () => {
          if (!cancelled) setLoadError("图片解码失败，请重试。")
        }
        image.src = objectUrl
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "图片载入失败，请重试。")
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageUrl])

  // canvas 需要先挂载才能取到 ref，因此在图片就绪后单独绘制底图
  useEffect(() => {
    const image = imageRef.current
    const canvas = canvasRef.current
    if (!ready || !image || !canvas) return

    // 限制最长边，避免超大图导致卡顿
    const maxEdge = 1280
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    const ctx = canvas.getContext("2d")
    if (ctx) ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    setHasMask(false)
  }, [ready])

  const paint = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return

      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * canvas.width
      const y = ((event.clientY - rect.top) / rect.height) * canvas.height

      ctx.fillStyle = MASK_COLOR
      ctx.beginPath()
      ctx.arc(x, y, (brush / rect.width) * canvas.width, 0, Math.PI * 2)
      ctx.fill()
      setHasMask(true)
    },
    [brush]
  )

  function reset() {
    const canvas = canvasRef.current
    const image = imageRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx || !image) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    setHasMask(false)
  }

  function confirm() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      onConfirm(new File([blob], "masked-reference.png", { type: "image/png" }))
    }, "image/png")
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-hidden rounded-2xl bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-slate-900">涂选要精修的区域</h3>
            <p className="text-xs leading-relaxed text-slate-500">
              用画笔涂抹需要重绘的部分，未涂抹的区域会尽量保持不变。
            </p>
          </div>
          <button
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition hover:bg-slate-100"
            onClick={reset}
            type="button"
          >
            <RotateCcw className="mr-1 inline h-3 w-3" />
            清除涂选
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl bg-slate-100 p-2">
          {ready ? (
            <canvas
              className="max-h-[52vh] w-auto max-w-full cursor-crosshair rounded-lg shadow-sm"
              onPointerDown={(event) => {
                drawingRef.current = true
                event.currentTarget.setPointerCapture(event.pointerId)
                paint(event)
              }}
              onPointerMove={(event) => {
                if (drawingRef.current) paint(event)
              }}
              onPointerUp={(event) => {
                drawingRef.current = false
                event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              ref={canvasRef}
            />
          ) : loadError ? (
            <div className="py-12 text-center text-sm text-red-500">{loadError}</div>
          ) : (
            <div className="flex items-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              载入图片中...
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <Eraser className="h-3.5 w-3.5" />
            画笔
            <input
              className="w-28 accent-cyan-600"
              max={120}
              min={8}
              onChange={(event) => setBrush(Number(event.target.value))}
              type="range"
              value={brush}
            />
            <span className="w-8 text-right tabular-nums text-slate-400">{brush}</span>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-100"
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!hasMask || busy}
              onClick={confirm}
              type="button"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              开始精修
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
