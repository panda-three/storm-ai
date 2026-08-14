"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Eraser, Loader2, RotateCcw } from "lucide-react"

interface MaskEditorProps {
  imageUrl: string
  /** 节点上原本的提示词，作为精修提示词的初始值 */
  initialPrompt?: string
  onCancel: () => void
  /** 返回叠加了涂选高亮的图片文件 + 针对该区域的新提示词 */
  onConfirm: (composited: File, prompt: string) => void
  busy?: boolean
}

const MASK_RGB = [255, 64, 129] as const
const MASK_ALPHA = 0.5

export function MaskEditor({
  busy = false,
  imageUrl,
  initialPrompt = "",
  onCancel,
  onConfirm,
}: MaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  // 独立的遮罩图层，与底图分离，方便清除与闭合填充
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [brush, setBrush] = useState(4)
  const [fillEnclosed, setFillEnclosed] = useState(true)
  const [prompt, setPrompt] = useState(initialPrompt)
  const [ready, setReady] = useState(false)
  const [hasMask, setHasMask] = useState(false)
  const [loadError, setLoadError] = useState("")

  // 载入底图：先抓成同源 blob，避免跨域污染 canvas 导致无法导出
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

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    const mask = maskCanvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx || !image) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    if (mask) {
      ctx.save()
      ctx.globalAlpha = MASK_ALPHA
      ctx.drawImage(mask, 0, 0)
      ctx.restore()
    }
  }, [])

  // canvas 需要先挂载才能取到 ref，因此在图片就绪后单独初始化
  useEffect(() => {
    const image = imageRef.current
    const canvas = canvasRef.current
    if (!ready || !image || !canvas) return

    // 限制最长边，避免超大图导致卡顿
    const maxEdge = 1600
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)

    const mask = document.createElement("canvas")
    mask.width = canvas.width
    mask.height = canvas.height
    maskCanvasRef.current = mask

    setHasMask(false)
    redraw()
  }, [ready, redraw])

  const toCanvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      scale: canvas.width / rect.width,
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }, [])

  // 用连续线条绘制，支持极细的圈线
  const paint = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const mask = maskCanvasRef.current
      const ctx = mask?.getContext("2d")
      const point = toCanvasPoint(event)
      if (!mask || !ctx || !point) return

      const width = Math.max(1, brush * point.scale)
      ctx.strokeStyle = `rgb(${MASK_RGB[0]}, ${MASK_RGB[1]}, ${MASK_RGB[2]})`
      ctx.fillStyle = ctx.strokeStyle
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.lineWidth = width

      const last = lastPointRef.current
      if (last) {
        ctx.beginPath()
        ctx.moveTo(last.x, last.y)
        ctx.lineTo(point.x, point.y)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(point.x, point.y, width / 2, 0, Math.PI * 2)
        ctx.fill()
      }

      lastPointRef.current = { x: point.x, y: point.y }
      setHasMask(true)
      redraw()
    },
    [brush, redraw, toCanvasPoint]
  )

  function reset() {
    const mask = maskCanvasRef.current
    const ctx = mask?.getContext("2d")
    if (!mask || !ctx) return
    ctx.clearRect(0, 0, mask.width, mask.height)
    lastPointRef.current = null
    setHasMask(false)
    redraw()
  }

  // 把闭合圈线的内部一并填充成遮罩：从画布边缘做洪水填充，未被访问且未涂抹的像素即为闭合区域内部
  function buildFilledMask(source: HTMLCanvasElement) {
    const { height, width } = source
    const ctx = source.getContext("2d")
    if (!ctx) return source
    const data = ctx.getImageData(0, 0, width, height)
    const alpha = data.data
    const outside = new Uint8Array(width * height)
    const stack: number[] = []

    const push = (index: number) => {
      if (outside[index]) return
      if (alpha[index * 4 + 3] > 96) return
      outside[index] = 1
      stack.push(index)
    }

    for (let x = 0; x < width; x += 1) {
      push(x)
      push((height - 1) * width + x)
    }
    for (let y = 0; y < height; y += 1) {
      push(y * width)
      push(y * width + width - 1)
    }

    while (stack.length > 0) {
      const index = stack.pop() as number
      const x = index % width
      const y = (index - x) / width
      if (x > 0) push(index - 1)
      if (x < width - 1) push(index + 1)
      if (y > 0) push(index - width)
      if (y < height - 1) push(index + width)
    }

    for (let index = 0; index < width * height; index += 1) {
      if (outside[index]) continue
      const offset = index * 4
      alpha[offset] = MASK_RGB[0]
      alpha[offset + 1] = MASK_RGB[1]
      alpha[offset + 2] = MASK_RGB[2]
      alpha[offset + 3] = 255
    }

    const filled = document.createElement("canvas")
    filled.width = width
    filled.height = height
    filled.getContext("2d")?.putImageData(data, 0, 0)
    return filled
  }

  function confirm() {
    const image = imageRef.current
    const mask = maskCanvasRef.current
    if (!image || !mask) return

    const output = document.createElement("canvas")
    output.width = mask.width
    output.height = mask.height
    const ctx = output.getContext("2d")
    if (!ctx) return

    ctx.drawImage(image, 0, 0, output.width, output.height)
    ctx.save()
    ctx.globalAlpha = MASK_ALPHA
    ctx.drawImage(fillEnclosed ? buildFilledMask(mask) : mask, 0, 0)
    ctx.restore()

    output.toBlob((blob) => {
      if (!blob) return
      onConfirm(new File([blob], "masked-reference.png", { type: "image/png" }), prompt.trim())
    }, "image/png")
  }

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4 sm:p-8">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col gap-3 overflow-hidden rounded-2xl bg-white p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-slate-900">圈选要精修的区域</h3>
            <p className="text-xs leading-relaxed text-slate-500">
              用细画笔圈出要重绘的局部（闭合圈线内部会自动计入），再填写新的关键词只重画这一块。
            </p>
          </div>
          <button
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition hover:bg-slate-100"
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
              className="max-h-[58vh] w-auto max-w-full cursor-crosshair rounded-lg shadow-sm"
              onPointerDown={(event) => {
                drawingRef.current = true
                lastPointRef.current = null
                event.currentTarget.setPointerCapture(event.pointerId)
                paint(event)
              }}
              onPointerMove={(event) => {
                if (drawingRef.current) paint(event)
              }}
              onPointerUp={(event) => {
                drawingRef.current = false
                lastPointRef.current = null
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

        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          该区域的新关键词
          <textarea
            className="h-16 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-sm leading-relaxed text-slate-900 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：把书架换成一盆更大的绿植，材质保持木质"
            value={prompt}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <Eraser className="h-3.5 w-3.5" />
            画笔
            <input
              className="w-32 accent-cyan-600"
              max={40}
              min={1}
              onChange={(event) => setBrush(Number(event.target.value))}
              step={1}
              type="range"
              value={brush}
            />
            <span className="w-8 text-right tabular-nums text-slate-400">{brush}</span>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              checked={fillEnclosed}
              className="accent-cyan-600"
              onChange={(event) => setFillEnclosed(event.target.checked)}
              type="checkbox"
            />
            填充闭合圈线内部
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
              className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!hasMask || !prompt.trim() || busy}
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

  // 节点位于 React Flow 的 transform 容器内，fixed 定位会被缩放，必须挂到 body
  if (typeof document === "undefined") return null
  return createPortal(modal, document.body)
}
