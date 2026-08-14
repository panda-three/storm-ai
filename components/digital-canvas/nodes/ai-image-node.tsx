"use client"

import { memo, useCallback, useMemo, useState } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import {
  AlertCircle,
  Brush,
  Download,
  Loader2,
  Maximize2,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react"
import {
  getImageRatiosForSelection,
  imageModelOptions,
  imageModelSettings,
} from "@/lib/model-options"
import {
  createImageGenerationTask,
  pollImageTask,
  uploadReferenceImageFile,
  uploadReferenceImageFromUrl,
} from "@/lib/digital-canvas/api"
import { NodeDeleteButton } from "@/components/digital-canvas/nodes/node-delete-button"
import { MaskEditor } from "@/components/digital-canvas/panels/mask-editor"
import type {
  DigitalCanvasAiImageNodeData,
  DigitalCanvasImageNodeData,
  DigitalCanvasTextNodeData,
} from "@/lib/digital-canvas/types"

function AiImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as DigitalCanvasAiImageNodeData
  const { setNodes, getNodes, getEdges } = useReactFlow()
  const [expanded, setExpanded] = useState(true)
  const [maskOpen, setMaskOpen] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const qualities = useMemo(
    () => imageModelSettings[nodeData.model]?.qualities ?? ["1K", "2K", "4K"],
    [nodeData.model]
  )
  const ratios = useMemo(
    () => getImageRatiosForSelection(nodeData.model, nodeData.quality),
    [nodeData.model, nodeData.quality]
  )

  const patch = useCallback(
    (partial: Partial<DigitalCanvasAiImageNodeData>) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...partial } } : node
        )
      )
    },
    [id, setNodes]
  )

  // 从上游连线节点收集提示词与参考图。
  const collectInputs = useCallback(() => {
    const edges = getEdges().filter((edge) => edge.target === id)
    const nodes = getNodes()
    const upstreamTexts: string[] = []
    const upstreamImageUrls: string[] = []

    for (const edge of edges) {
      const source = nodes.find((node) => node.id === edge.source)
      if (!source) continue
      if (source.type === "text") {
        const text = (source.data as unknown as DigitalCanvasTextNodeData).text?.trim()
        if (text) upstreamTexts.push(text)
      } else if (source.type === "image") {
        const image = (source.data as unknown as DigitalCanvasImageNodeData).image
        if (image?.url) upstreamImageUrls.push(image.url)
      } else if (source.type === "ai-image") {
        const outputs = (source.data as unknown as DigitalCanvasAiImageNodeData).outputs
        if (outputs?.[0]?.url) upstreamImageUrls.push(outputs[0].url)
      }
    }

    return { upstreamImageUrls, upstreamTexts }
  }, [getEdges, getNodes, id])

  const handleGenerate = useCallback(async () => {
    const { upstreamImageUrls, upstreamTexts } = collectInputs()
    const prompt = [nodeData.prompt?.trim(), ...upstreamTexts].filter(Boolean).join("\n")

    if (!prompt) {
      patch({ error: "请填写提示词或连接一个文字节点。", status: "error" })
      return
    }

    patch({ error: undefined, progress: 0, status: "running" })

    try {
      // 上游图片作为参考图（图生图 / 编辑）。
      const referenceImages = []
      for (const url of upstreamImageUrls.slice(0, 4)) {
        referenceImages.push(await uploadReferenceImageFromUrl(url))
      }

      const task = await createImageGenerationTask({
        imageCount: nodeData.imageCount || 1,
        model: nodeData.model,
        prompt,
        quality: nodeData.quality,
        ratio: nodeData.ratio,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      })

      patch({ taskId: task.taskId })

      const result = await pollImageTask(task.taskId, {
        initialImageUrls: task.imageUrls ?? [],
        onProgress: (progress) => patch({ progress }),
      })

      if (result.imageUrls.length === 0) {
        patch({ error: "生成未返回图片。", status: "error" })
        return
      }

      patch({
        outputs: result.imageUrls.map((url) => ({ url })),
        progress: 100,
        status: "done",
      })
    } catch (error) {
      patch({
        error: error instanceof Error ? error.message : "生成失败，请稍后重试。",
        status: "error",
      })
    }
  }, [collectInputs, nodeData, patch])

  // 局部精修：把涂选后的合成图作为参考图，只重绘涂抹区域。
  const handleRefine = useCallback(
    async (masked: File) => {
      patch({ error: undefined, progress: 0, status: "running" })
      try {
        const reference = await uploadReferenceImageFile(masked)
        const basePrompt = nodeData.prompt?.trim()
        const prompt = [
          basePrompt,
          "Refine only the region covered by the semi-transparent pink mask in the reference image; keep everything outside the mask pixel-identical, and remove the mask color itself.",
        ]
          .filter(Boolean)
          .join(" ")

        const task = await createImageGenerationTask({
          imageCount: 1,
          model: nodeData.model,
          prompt,
          quality: nodeData.quality,
          ratio: nodeData.ratio,
          referenceImages: [reference],
        })

        patch({ taskId: task.taskId })

        const result = await pollImageTask(task.taskId, {
          initialImageUrls: task.imageUrls ?? [],
          onProgress: (progress) => patch({ progress }),
        })

        if (result.imageUrls.length === 0) {
          patch({ error: "局部精修未返回图片。", status: "error" })
          return
        }

        patch({
          outputs: result.imageUrls.map((url) => ({ url })),
          progress: 100,
          status: "done",
        })
      } catch (error) {
        patch({
          error: error instanceof Error ? error.message : "局部精修失败，请稍后重试。",
          status: "error",
        })
      }
    },
    [nodeData.model, nodeData.prompt, nodeData.quality, nodeData.ratio, patch]
  )

  const running = nodeData.status === "running"
  const resultUrl = nodeData.outputs?.[0]?.url
  // 通过下载代理读取，避免跨域导致 canvas 被污染 / 无法下载原图。
  const proxiedResultUrl = resultUrl
    ? `/api/download?url=${encodeURIComponent(resultUrl)}&filename=${encodeURIComponent("kaka-result.png")}`
    : ""

  return (
    <div
      className={`group relative w-72 rounded-2xl border bg-white shadow-md transition ${
        selected ? "border-cyan-400 ring-2 ring-cyan-100" : "border-slate-200"
      }`}
    >
      <NodeDeleteButton id={id} label="删除 AI 绘图节点" />
      <div className="flex items-center gap-2 rounded-t-2xl border-b border-slate-100 bg-gradient-to-r from-cyan-50 to-white px-3 py-2">
        <Wand2 className="h-3.5 w-3.5 text-cyan-600" />
        <span className="text-xs font-semibold text-slate-700">AI 绘图</span>
        <button
          type="button"
          className="nodrag ml-auto text-xs text-slate-400 hover:text-slate-600"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>

      <div className="space-y-3 p-3">
        <textarea
          className="nodrag h-20 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-sm leading-relaxed text-slate-900 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
          onChange={(event) => patch({ prompt: event.target.value })}
          placeholder="描述你想生成的画面（上游文字节点会自动拼接）..."
          value={nodeData.prompt}
        />

        {expanded ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 flex flex-col gap-1 text-[11px] text-slate-500">
              模型
              <select
                className="nodrag rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-cyan-300"
                onChange={(event) => {
                  const model = event.target.value
                  const nextQualities = imageModelSettings[model]?.qualities ?? ["1K"]
                  const nextRatios = getImageRatiosForSelection(model, nextQualities[0])
                  patch({ model, quality: nextQualities[0], ratio: nextRatios[0] })
                }}
                value={nodeData.model}
              >
                {imageModelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              比例
              <select
                className="nodrag rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-cyan-300"
                onChange={(event) => patch({ ratio: event.target.value })}
                value={nodeData.ratio}
              >
                {ratios.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              清晰度
              <select
                className="nodrag rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-cyan-300"
                onChange={(event) => {
                  const quality = event.target.value
                  const nextRatios = getImageRatiosForSelection(nodeData.model, quality)
                  patch({
                    quality,
                    ratio: nextRatios.includes(nodeData.ratio) ? nodeData.ratio : nextRatios[0],
                  })
                }}
                value={nodeData.quality}
              >
                {qualities.map((quality) => (
                  <option key={quality} value={quality}>
                    {quality}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {nodeData.status === "error" && nodeData.error ? (
          <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-600">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{nodeData.error}</span>
          </div>
        ) : null}

        {resultUrl ? (
          <button
            className="nodrag block w-full overflow-hidden rounded-lg border border-slate-200"
            onClick={() => setLightboxOpen(true)}
            title="点击查看大图"
            type="button"
          >
            <img alt="AI 生成结果" className="h-auto w-full" src={resultUrl} />
          </button>
        ) : null}

        {resultUrl && !running ? (
          // 出图后把主按钮换成 4 个后续动作
          <div className="grid grid-cols-2 gap-1.5">
            <ActionButton icon={RefreshCw} label="重新生成" onClick={handleGenerate} />
            <ActionButton icon={Maximize2} label="查看大图" onClick={() => setLightboxOpen(true)} />
            <a
              className="nodrag flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              download
              href={proxiedResultUrl}
              rel="noreferrer"
              target="_blank"
            >
              <Download className="h-3 w-3" />
              下载原图
            </a>
            <ActionButton
              accent
              icon={Brush}
              label="局部精修"
              onClick={() => setMaskOpen(true)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="nodrag flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 py-2 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={running}
            onClick={handleGenerate}
          >
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                生成中 {Math.round(nodeData.progress || 0)}%
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                生成
              </>
            )}
          </button>
        )}
      </div>

      {maskOpen && proxiedResultUrl ? (
        <MaskEditor
          busy={running}
          imageUrl={proxiedResultUrl}
          onCancel={() => setMaskOpen(false)}
          onConfirm={async (composited) => {
            setMaskOpen(false)
            await handleRefine(composited)
          }}
        />
      ) : null}

      {lightboxOpen && resultUrl ? (
        <div
          className="nodrag nowheel fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 p-6"
          onClick={() => setLightboxOpen(false)}
          role="presentation"
        >
          <img
            alt="AI 生成结果大图"
            className="max-h-full max-w-full rounded-xl shadow-2xl"
            src={resultUrl}
          />
          <button
            aria-label="关闭大图"
            className="absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-700 transition hover:bg-white"
            onClick={() => setLightboxOpen(false)}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-cyan-500"
      />
    </div>
  )
}

function ActionButton({
  accent,
  icon: Icon,
  label,
  onClick,
}: {
  accent?: boolean
  icon: typeof RefreshCw
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`nodrag flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium transition ${
        accent
          ? "border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
          : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}

export const AiImageNode = memo(AiImageNodeComponent)
