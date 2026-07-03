import type { GenerationKind } from "@/lib/generation-types"

interface GenerationLedgerContext {
  model: string
  provider: string
  type: GenerationKind
}

interface PartialFailureRefundContext extends GenerationLedgerContext {
  failedCount: number
  expectedCount: number
}

const providerLabels: Record<string, string> = {
  apimart: "APIMart",
  grsai: "GrsAi",
  manju: "Manju",
  toapis: "ToAPIs",
  vectorengine: "VectorEngine",
  yunwu: "yw",
}

export function formatGenerationProviderForLedger(provider: string) {
  const normalized = provider.trim().toLowerCase()
  return providerLabels[normalized] ?? provider.trim()
}

export function buildGenerationFailureRefundReason({
  error,
  model,
  provider,
  type,
}: GenerationLedgerContext & {
  error?: string
}) {
  const parts = [
    `AI ${getGenerationTypeLabel(type)}失败退款`,
    `渠道：${formatGenerationProviderForLedger(provider)}`,
    `模型：${model}`,
    error ? `失败原因：${error}` : "",
  ].filter(Boolean)

  return parts.join(" · ")
}

export function buildGenerationSubmitFailureRefundReason({
  error,
  model,
  provider,
  type,
}: GenerationLedgerContext & {
  error: string
}) {
  return [
    `AI ${getGenerationTypeLabel(type)}提交失败退款`,
    `渠道：${formatGenerationProviderForLedger(provider)}`,
    `模型：${model}`,
    `失败原因：${error}`,
  ].join(" · ")
}

export function buildGenerationPartialFailureRefundReason({
  expectedCount,
  failedCount,
  model,
  provider,
  type,
}: PartialFailureRefundContext) {
  return [
    `AI ${getGenerationTypeLabel(type)}部分失败退款`,
    `渠道：${formatGenerationProviderForLedger(provider)}`,
    `模型：${model}`,
    `失败：${failedCount}/${expectedCount} 张`,
  ].join(" · ")
}

function getGenerationTypeLabel(type: GenerationKind) {
  return type === "video" ? "视频" : "生图"
}
