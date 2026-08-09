"use client"

import { memo, useCallback, useMemo, useState } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import { AlertCircle, Loader2, Sparkles, Wand2 } from "lucide-react"
import {
  getImageRatiosForSelection,
  imageModelOptions,
  imageModelSettings,
} from "@/lib/model-options"
import {
  createImageGenerationTask,
  pollImageTask,
  uploadReferenceImageFromUrl,
} from "@/lib/digital-canvas/api"
import type {
  DigitalCanvasAiImageNodeData,
  DigitalCanvasImageNodeData,
  DigitalCanvasTextNodeData,
} from "@/lib/digital-canvas/types"

function AiImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as DigitalCanvasAiImageNodeData
  const { setNodes, getNodes, getEdges } = useReactFlow()
  const [expanded, setExpanded] = useState(true)

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

  const running = nodeData.status === "running"

  return (
    <div
      className={`w-72 rounded-2xl border bg-white shadow-md transition ${
        selected ? "border-cyan-400 ring-2 ring-cyan-100" : "border-slate-200"
      }`}
    >
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

        {nodeData.outputs?.[0]?.url ? (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="AI 生成结果" className="h-auto w-full" src={nodeData.outputs[0].url} />
          </div>
        ) : null}

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
      </div>

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

export const AiImageNode = memo(AiImageNodeComponent)
