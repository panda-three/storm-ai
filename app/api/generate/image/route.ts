import { NextResponse } from "next/server"
import {
  createGenerationJobWithBilling,
  failGenerationJobWithRefund,
  getGenerationJobExpiresAt,
  updateGenerationJob,
  updateActiveGenerationJob,
  type GenerationJobStatus,
} from "@/lib/generation-jobs"
import {
  createYunwuGeminiImage,
  createYunwuGrokImagineImages,
  createYunwuGptImages,
  createYunwuSeedreamImages,
  type YunwuGeneratedImage,
} from "@/lib/yunwu"
import {
  assertVectorEngineConfigured,
  createVectorEngineGeminiImage,
  type VectorEngineGeneratedImage,
} from "@/lib/vectorengine"
import {
  calculatePricingCredits,
  type ModelPricing,
} from "@/lib/supabase"
import {
  getSupabaseServerClient,
  describeServerError,
  getServerErrorStatus,
  deleteGeneratedImageByPublicUrl,
  refundGenerationCredits,
  requireAuthenticatedUser,
  persistRemoteGeneratedImage,
  uploadGeneratedImage,
} from "@/lib/server-supabase"
import {
  apimartImageProviderName,
  gptImage2Supported4KRatios,
  imageModelSettings,
  isApimartImageModel,
  isGrokImagineImageModel,
  isSelectableImageModel,
  isToapisImageModel,
  isVectorEngineGeminiImageModel,
  isVectorEngineImageModel,
  isYunwuGeminiImageModel,
  isYunwuGptImageModel,
  isYunwuImageModel,
  isYunwuSeedream5ImageModel,
  isValidImageRatioForQuality,
  toapisImageProviderName,
  vectorEngineImageProviderName,
  yunwuGeminiImageModelName,
} from "@/lib/model-options"
import {
  getReferenceImageBucket,
  getReferenceImagePathPrefix,
  maxReferenceImages,
  type ProjectReferenceImage,
  type StoredReferenceImage,
  validateReferenceImageMetadata,
} from "@/lib/reference-images"
import { assertApimartConfigured, createApimartGptImage2Task } from "@/lib/apimart"
import { assertToapisConfigured, createToapisGptImageTask } from "@/lib/toapis"
import {
  buildGenerationPartialFailureRefundReason,
  buildGenerationSubmitFailureRefundReason,
} from "@/lib/generation-ledger"

interface PreparedReferenceImage {
  buffer: Buffer
  mimeType: string
  name: string
  path?: string
  bucket?: string
  publicUrl?: string
}

export async function POST(request: Request) {
  let clientRequestId = ""
  let jobId = ""
  let jobModel = ""
  let jobProvider = ""
  let stage = "authenticate"
  let upstreamTaskId = ""
  let userId = ""
  let preparedReferenceImages: PreparedReferenceImage[] = []
  let cleanupPreparedReferenceImages = true

  try {
    const auth = await requireAuthenticatedUser(request)
    userId = auth.userId
    stage = "parse_input"
    const contentType = request.headers.get("content-type") ?? ""
    const body = contentType.includes("multipart/form-data") ? await request.formData() : await request.json()
    const getValue = (key: string) => (body instanceof FormData ? body.get(key) : body[key])
    const prompt = String(getValue("prompt") ?? "").trim()

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "请先输入生图提示词。" }, { status: 400 })
    }

    const model = String(getValue("model") ?? yunwuGeminiImageModelName)
    jobModel = model
    const quality = String(getValue("quality") ?? "2K")
    const ratio = String(getValue("ratio") ?? "1:1")
    const imageCount = parseImageCount(getValue("imageCount"))
    clientRequestId = String(getValue("clientRequestId") ?? "").trim()
    const referenceFiles = body instanceof FormData ? body.getAll("referenceImages").filter(isImageFile) : []
    const storedReferenceImages = body instanceof FormData ? [] : parseStoredReferenceImages(getValue("referenceImages"))
    const modelSettings = imageModelSettings[model]

    if (!isSelectableImageModel(model) || !modelSettings) {
      return NextResponse.json({ ok: false, error: "请选择有效图片模型。" }, { status: 400 })
    }

    if (!modelSettings.qualities.includes(quality)) {
      return NextResponse.json({ ok: false, error: "请选择当前模型支持的图片清晰度。" }, { status: 400 })
    }

    if (!isValidImageRatioForQuality(model, quality, ratio)) {
      return NextResponse.json(
        {
          ok: false,
          error: `GPT-Image-2 选择 4K 时仅支持这些图片比例：${gptImage2Supported4KRatios.join(" / ")}。`,
        },
        { status: 400 }
      )
    }

    if (!modelSettings.ratios.includes(ratio)) {
      return NextResponse.json({ ok: false, error: "请选择当前模型支持的图片比例。" }, { status: 400 })
    }

    stage = "validate_reference_images"
    validateReferenceFiles(referenceFiles)
    validateStoredReferenceImages(storedReferenceImages, userId)

    if (referenceFiles.length > 0 && storedReferenceImages.length > 0) {
      return NextResponse.json(
        { ok: false, error: "请不要同时提交参考图文件和参考图存储地址。" },
        { status: 400 }
      )
    }

    if (isGrokImagineImageModel(model) && referenceFiles.length + storedReferenceImages.length !== 1) {
      return NextResponse.json({ ok: false, error: "Grok Imagine Image 必须且只能提交 1 张参考图。" }, { status: 400 })
    }

    stage = "load_pricing"
    const pricing = await loadImagePricing({ model, quality })
    if (!pricing) {
      return NextResponse.json({ ok: false, error: "当前模型参数未配置价格，请联系管理员配置后再生成。" }, { status: 400 })
    }

    let billingAmount = calculatePricingCredits(pricing) * imageCount
    const billingReference = `generate_image_${Date.now()}_${crypto.randomUUID()}`
    let billingReason = `AI 生图 · ${model} · ${quality} · ${imageCount} 张`
    stage = "load_membership"
    const membershipCoversQuality = await hasActiveImageMembership({
      quality,
      userId,
    })

    logGenerateImage("input", {
      contentType: body instanceof FormData ? "multipart/form-data" : "application/json",
      promptLength: prompt.length,
      model,
      quality,
      ratio,
      imageCount,
      clientRequestId,
      referenceImages: [
        ...referenceFiles.map(toFileLog),
        ...storedReferenceImages.map((image) => ({
          path: image.path,
          size: image.size,
          type: image.type,
        })),
      ],
      userId: maskId(userId),
    })

    const isFree = membershipCoversQuality
    if (isFree) {
      billingAmount = 0
      billingReason = `${billingReason} · 会员免费`
    }

    const isYunwuImage = isYunwuImageModel(model)
    const isApimartImage = isApimartImageModel(model)
    const isToapisImage = isToapisImageModel(model)
    const isVectorEngineImage = isVectorEngineImageModel(model)
    const provider = isApimartImage
      ? apimartImageProviderName
      : isToapisImage
        ? toapisImageProviderName
        : isVectorEngineImage
          ? vectorEngineImageProviderName
          : "yunwu"
    jobProvider = provider
    logGenerateImage("provider route", {
      isApimartImage,
      isToapisImage,
      isVectorEngineImage,
      isYunwuImage,
      model,
      provider,
    })
    if (!isYunwuImage && !isToapisImage && !isApimartImage && !isVectorEngineImage) {
      return NextResponse.json({ ok: false, error: "当前图片模型暂不支持该上游。" }, { status: 400 })
    }

    if (isApimartImage && imageCount !== 1) {
      return NextResponse.json({ ok: false, error: "image2-M通道暂时仅支持单张生成。" }, { status: 400 })
    }

    if (isApimartImage) {
      stage = "check_apimart_config"
      assertApimartConfigured()
    }

    if (isToapisImage) {
      stage = "check_toapis_config"
      assertToapisConfigured()
    }

    if (isVectorEngineImage) {
      stage = "check_vectorengine_config"
      assertVectorEngineConfigured()
    }

    stage = "prepare_reference_images"
    preparedReferenceImages = await prepareReferenceImages({
      referenceFiles,
      storedReferenceImages,
      userId,
    })
    const referenceBuffers = isYunwuGeminiImageModel(model)
      ? await prepareYunwuGeminiReferenceImages(preparedReferenceImages, () => {
          stage = "prepare_yunwu_gemini_references"
        })
      : []
    const vectorEngineReferenceBuffers = isVectorEngineGeminiImageModel(model)
      ? await prepareYunwuGeminiReferenceImages(preparedReferenceImages, () => {
          stage = "prepare_vectorengine_gemini_references"
        })
      : []
    const yunwuReferenceImageUrls = isYunwuGptImageModel(model)
      ? await prepareYunwuReferenceImageUrls(preparedReferenceImages, userId, () => {
          stage = "prepare_yunwu_gpt_references"
        })
      : []
    const yunwuSeedreamReferenceImageUrls = isYunwuSeedream5ImageModel(model)
      ? await prepareYunwuReferenceImageUrls(preparedReferenceImages, userId, () => {
          stage = "prepare_yunwu_seedream_references"
        })
      : []
    const grokImagineReferenceImage = isGrokImagineImageModel(model)
      ? preparedReferenceImages[0]
        ? {
            buffer: preparedReferenceImages[0].buffer,
            mimeType: preparedReferenceImages[0].mimeType,
          }
        : undefined
      : undefined
    const toapisReferenceImageUrls = isToapisImage
      ? await prepareToapisReferenceImageUrls(preparedReferenceImages, () => {
          stage = "prepare_toapis_references"
        })
      : []
    const apimartReferenceImageUrls = isApimartImage
      ? await prepareApimartReferenceImageUrls(preparedReferenceImages, () => {
          stage = "prepare_apimart_references"
        })
      : []
    const inputReferenceImages = buildInputReferenceImages(preparedReferenceImages)

    stage = "create_generation_job_with_billing"
    const job = await createGenerationJobWithBilling({
      amount: billingAmount,
      clientRequestId,
      expectedResultCount: imageCount,
      isFree,
      model,
      prompt,
      provider,
      quality,
      aspectRatio: ratio,
      reason: billingReason,
      reference: billingReference,
      type: "image",
      userId,
      inputReferenceImages,
    })
    jobId = job.id

    if (job.already_exists) {
      if (job.status === "failed") {
        return NextResponse.json({
          ok: false,
          error: job.task_error ?? "该生图任务已失败。",
          taskId: job.id,
          clientRequestId: job.client_request_id ?? clientRequestId,
        })
      }

      return NextResponse.json({
        ok: true,
        mode: provider,
        taskId: job.id,
        status: job.status,
        type: "image",
        imageUrls: job.result_urls,
        clientRequestId: job.client_request_id ?? clientRequestId,
        progress: job.status === "completed" || job.status === "partial_completed" ? 100 : 0,
        taskError: job.task_error ?? "",
      })
    }
    cleanupPreparedReferenceImages = false

    if (isToapisImage) {
      stage = "submit_toapis_generation"
      const result = await createToapisGptImageTask({
        imageCount,
        prompt,
        quality,
        ratio,
        referenceImages: toapisReferenceImageUrls,
      })
      upstreamTaskId = result.taskId
      cleanupPreparedReferenceImages = false

      stage = "record_toapis_task"
      const nextJob = await updateActiveGenerationJob(job.id, {
        next_check_at: new Date(Date.now() + 5000).toISOString(),
        status: result.status === "submitted" ? "submitted" : "processing",
        storage_urls: toapisReferenceImageUrls,
        upstream_task_id: result.taskId,
      })

      if (!nextJob) {
        throw new Error("生成任务已结束，不能提交 ToAPIs 上游任务。")
      }

      logGenerateImage("toapis output", {
        jobId: job.id,
        status: nextJob.status,
        upstreamTaskId: result.taskId,
      })

      return NextResponse.json({
        ok: true,
        mode: "toapis",
        taskId: job.id,
        upstreamTaskId: result.taskId,
        status: nextJob.status,
        type: "image",
        imageUrls: [],
        clientRequestId,
        progress: 0,
        taskError: "",
      })
    }

    if (isApimartImage) {
      stage = "submit_apimart_generation"
      const result = await createApimartGptImage2Task({
        prompt,
        quality,
        ratio,
        referenceImages: apimartReferenceImageUrls,
      })
      upstreamTaskId = result.taskId
      cleanupPreparedReferenceImages = false

      stage = "record_apimart_task"
      const nextJob = await updateActiveGenerationJob(job.id, {
        next_check_at: new Date(Date.now() + 5000).toISOString(),
        status: result.status === "submitted" ? "submitted" : "processing",
        storage_urls: apimartReferenceImageUrls,
        upstream_task_id: result.taskId,
      })

      if (!nextJob) {
        throw new Error("生成任务已结束，不能提交 APIMart 上游任务。")
      }

      logGenerateImage("apimart output", {
        jobId: job.id,
        status: nextJob.status,
        upstreamTaskId: result.taskId,
      })

      return NextResponse.json({
        ok: true,
        mode: "apimart",
        taskId: job.id,
        upstreamTaskId: result.taskId,
        status: nextJob.status,
        type: "image",
        imageUrls: [],
        clientRequestId,
        progress: 0,
        taskError: "",
      })
    }

    stage = isVectorEngineImage ? "submit_vectorengine_generation" : "submit_yunwu_generation"
    const generatedResults: PromiseSettledResult<string>[] = isVectorEngineGeminiImageModel(model)
      ? await Promise.allSettled(
          Array.from({ length: imageCount }, async () => {
            const generated: VectorEngineGeneratedImage = await createVectorEngineGeminiImage({
              model,
              prompt,
              quality,
              ratio,
              referenceImages: vectorEngineReferenceBuffers,
            })
            const uploaded = await uploadGeneratedImage({
              buffer: generated.buffer,
              contentType: generated.mimeType,
              userId,
            })
            return uploaded.publicUrl
          })
        )
      : isYunwuGeminiImageModel(model)
      ? await Promise.allSettled(
          Array.from({ length: imageCount }, async () => {
            const generated: YunwuGeneratedImage = await createYunwuGeminiImage({
              model,
              prompt,
              quality,
              ratio,
              referenceImages: referenceBuffers,
            })
            const uploaded = await uploadGeneratedImage({
              buffer: generated.buffer,
              contentType: generated.mimeType,
              userId,
            })
            return uploaded.publicUrl
          })
        )
      : isGrokImagineImageModel(model)
        ? await Promise.allSettled(
            (
              grokImagineReferenceImage
                ? await createYunwuGrokImagineImages({
                    imageCount,
                    model,
                    prompt,
                    quality,
                    ratio,
                    referenceImage: grokImagineReferenceImage,
                  })
                : []
            ).map((url) =>
              persistRemoteGeneratedImage({
                sourceUrl: url,
                userId,
              }).catch((error) => {
                console.warn("[Generate Image] yunwu remote image mirror failed", {
                  error: describeServerError(error, "生成图片转存失败。"),
                  url,
                })
                return url
              })
            )
          )
        : await Promise.allSettled(
          (
            isYunwuSeedream5ImageModel(model)
              ? await createYunwuSeedreamImages({
                  imageUrls: yunwuSeedreamReferenceImageUrls,
                  imageCount,
                  model,
                  prompt,
                  quality,
                  ratio,
                })
              : await createYunwuGptImages({
                  imageUrls: yunwuReferenceImageUrls,
                  imageCount,
                  model,
                  prompt,
                  ratio,
                })
          ).map((url) =>
            persistRemoteGeneratedImage({
              sourceUrl: url,
              userId,
            }).catch((error) => {
              console.warn("[Generate Image] yunwu remote image mirror failed", {
                error: describeServerError(error, "生成图片转存失败。"),
                url,
              })
              return url
            })
          )
        )
    const imageUrls = generatedResults
      .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter(Boolean)

    if (imageUrls.length === 0) {
      throw new Error(buildAllSettledFailureMessage(generatedResults, "未收到可用图片结果。"))
    }

    const status: GenerationJobStatus = imageUrls.length < imageCount ? "partial_completed" : "completed"
    const upstreamErrors = summarizeSettledErrors(generatedResults)
    const taskError =
      status === "partial_completed"
        ? buildPartialImageMessage({
            amount: billingAmount,
            expectedResultCount: imageCount,
            successCount: imageUrls.length,
            upstreamErrors,
          })
        : upstreamErrors.length > 0
          ? upstreamErrors.join("；")
          : null
    const completedAt = new Date().toISOString()

    stage = isVectorEngineImage ? "complete_vectorengine_job" : "complete_yunwu_job"
    const nextJob = await updateActiveGenerationJob(job.id, {
      completed_at: completedAt,
      expires_at: getGenerationJobExpiresAt(completedAt),
      last_checked_at: completedAt,
      result_urls: imageUrls,
      status,
      storage_urls: imageUrls,
      task_error: taskError,
    })

    if (!nextJob) {
      await Promise.all(imageUrls.map((url) => deleteGeneratedImageByPublicUrl(url)))
      throw new Error("生成任务已结束，迟到结果已丢弃。")
    }

    if (status === "partial_completed") {
      const partialRefundAmount = calculatePartialRefundAmount(billingAmount, imageUrls.length, imageCount)
      await refundImageGenerationCredits({
        amount: partialRefundAmount,
        reason: buildGenerationPartialFailureRefundReason({
          expectedCount: imageCount,
          failedCount: imageCount - imageUrls.length,
          model,
          provider,
          type: "image",
        }),
        reference: buildPartialRefundReference(billingReference, imageUrls.length, imageCount),
        userId,
      })
    }

    return NextResponse.json({
      ok: true,
      mode: provider,
      taskId: job.id,
      status,
      type: "image",
      imageUrls,
      clientRequestId,
      progress: 100,
      taskError: taskError ?? "",
    })
  } catch (error) {
    const message = describeServerError(error, "生图任务提交失败。")
    const failureMessage = buildFailureMessage({ message, stage })
    logGenerateImage("error", {
      cause: error instanceof Error && error.cause ? describeServerError(error.cause, "") : "",
      jobId,
      message: failureMessage,
      stage,
      userId: maskId(userId),
    })

    if (jobId) {
      if (upstreamTaskId) {
        const recoveredJob = await recoverSubmittedImageJob({
          failureMessage,
          jobId,
          upstreamTaskId,
        }).catch(() => null)

        if (recoveredJob) {
          return NextResponse.json({
            ok: true,
            mode: getImageResponseMode(recoveredJob.provider),
            taskId: recoveredJob.id,
            upstreamTaskId,
            status: recoveredJob.status,
            type: "image",
            imageUrls: recoveredJob.result_urls,
            clientRequestId,
            progress: 0,
            taskError: failureMessage,
          })
        }
      }

      await failGenerationJobWithRefund({
        jobId,
        reason: buildGenerationSubmitFailureRefundReason({
          error: failureMessage,
          model: jobModel || "unknown",
          provider: jobProvider || "unknown",
          type: "image",
        }),
      }).catch(() => undefined)
    }

    return NextResponse.json(
      {
        ok: false,
        error: failureMessage,
      },
      { status: getServerErrorStatus(error) }
    )
  } finally {
    if (cleanupPreparedReferenceImages) {
      await cleanupStoredReferenceImages(preparedReferenceImages)
    }
  }
}

function parseImageCount(value: FormDataEntryValue | unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "1"), 10)

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
    throw new Error("生成张数只能选择 1 到 4 张。")
  }

  return parsed
}

function calculatePartialRefundAmount(amount: number, successCount: number, expectedResultCount: number) {
  if (amount <= 0 || expectedResultCount <= 0) return 0
  const failedCount = Math.max(0, expectedResultCount - successCount)
  return Math.floor((amount * failedCount) / expectedResultCount)
}

function buildPartialRefundReference(reference: string, successCount: number, expectedResultCount: number) {
  return `${reference}_partial_${successCount}_of_${expectedResultCount}`
}

function buildPartialImageMessage({
  amount,
  expectedResultCount,
  successCount,
  upstreamErrors = [],
}: {
  amount: number
  expectedResultCount: number
  successCount: number
  upstreamErrors?: string[]
}) {
  const failedCount = Math.max(0, expectedResultCount - successCount)
  const refundAmount = calculatePartialRefundAmount(amount, successCount, expectedResultCount)
  const refundText = refundAmount > 0 ? `已退还 ${refundAmount.toLocaleString()} 点。` : "本次未扣点，无需退款。"
  const errorText = upstreamErrors.length > 0 ? `失败原因：${upstreamErrors.join("；")}` : ""
  return [`已生成 ${successCount}/${expectedResultCount} 张，失败 ${failedCount} 张，${refundText}`, errorText]
    .filter(Boolean)
    .join(" ")
}

async function prepareYunwuGeminiReferenceImages(referenceImages: PreparedReferenceImage[], setStage: () => void) {
  if (referenceImages.length === 0) return []

  setStage()
  return referenceImages.map((image) => ({
    buffer: image.buffer,
    mimeType: image.mimeType,
  }))
}

function buildAllSettledFailureMessage<T>(results: PromiseSettledResult<T>[], fallback: string) {
  const errors = summarizeSettledErrors(results)
  if (errors.length === 0) return fallback
  return `${fallback} ${errors.join("；")}`
}

function summarizeSettledErrors<T>(results: PromiseSettledResult<T>[]) {
  return Array.from(
    new Set(
      results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => describeServerError(result.reason, "上游生成失败。"))
        .filter(Boolean)
    )
  ).slice(0, 3)
}

function buildFailureMessage({
  message,
  stage,
}: {
  message: string
  stage: string
}) {
  return `${getFailureStageLabel(stage)}：${message}`
}

function getFailureStageLabel(stage: string) {
  if (stage === "submit_yunwu_generation") return "yw 图片生成失败"
  if (stage === "submit_vectorengine_generation") return "VectorEngine 图片生成失败"
  if (
    stage === "prepare_yunwu_gemini_references" ||
    stage === "prepare_yunwu_gpt_references" ||
    stage === "prepare_yunwu_seedream_references"
  ) return "yw 参考图处理失败"
  if (stage === "prepare_vectorengine_gemini_references") return "VectorEngine 参考图处理失败"
  if (stage === "complete_yunwu_job") return "yw 图片任务结算失败"
  if (stage === "complete_vectorengine_job") return "VectorEngine 图片任务结算失败"
  if (stage === "check_vectorengine_config") return "VectorEngine 配置检查失败"
  if (stage === "check_apimart_config") return "APIMart 配置检查失败"
  if (stage === "submit_apimart_generation") return "APIMart 图片生成提交失败"
  if (stage === "record_apimart_task") return "APIMart 图片任务记录失败"
  if (stage === "prepare_apimart_references") return "APIMart 参考图处理失败"
  if (stage === "check_toapis_config") return "ToAPIs 配置检查失败"
  if (stage === "submit_toapis_generation") return "ToAPIs 图片生成提交失败"
  if (stage === "record_toapis_task") return "ToAPIs 图片任务记录失败"
  if (stage === "prepare_toapis_references") return "ToAPIs 参考图处理失败"
  if (stage === "prepare_reference_images" || stage === "validate_reference_images") return "参考图处理失败"
  if (stage === "parse_input") return "图片参数处理失败"
  if (stage === "load_pricing") return "价格读取失败"
  if (stage === "load_membership") return "会员权益读取失败"
  if (stage === "create_generation_job_with_billing") return "图片任务创建失败"
  return "图片生成失败"
}

function getImageResponseMode(provider: string) {
  if (provider === "apimart") return "apimart"
  if (provider === "toapis") return "toapis"
  if (provider === "vectorengine") return "vectorengine"
  return "yunwu"
}

async function refundImageGenerationCredits({
  amount,
  reason,
  reference,
  userId,
}: {
  amount: number
  reason: string
  reference: string
  userId: string
}) {
  if (amount <= 0) return

  await refundGenerationCredits({
    amount,
    reason,
    reference,
    userId,
  })
}

async function recoverSubmittedImageJob({
  failureMessage,
  jobId,
  upstreamTaskId,
}: {
  failureMessage: string
  jobId: string
  upstreamTaskId: string
}) {
  return updateGenerationJob(jobId, {
    last_sync_error: failureMessage,
    next_check_at: new Date(Date.now() + 5000).toISOString(),
    status: "processing",
    upstream_task_id: upstreamTaskId,
  })
}

async function loadImagePricing({ model, quality }: { model: string; quality: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from("model_pricing")
    .select("id, model, type, quality, duration_seconds, aspect_ratio, cost_cny, markup, enabled")
    .eq("enabled", true)
    .eq("type", "image")
    .eq("model", model)
    .eq("quality", quality)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(describeServerError(error, "读取图片模型价格失败。"), { cause: error })
  }
  return (data?.[0] ?? null) as ModelPricing | null
}

async function hasActiveImageMembership({ quality, userId }: { quality: string; userId: string }) {
  const { data, error } = await getSupabaseServerClient()
    .from("user_accounts")
    .select("membership_tier, membership_expires_at, membership_free_image_qualities")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeServerError(error, "读取会员权益失败。"), { cause: error })
  }

  const expiresAt = typeof data?.membership_expires_at === "string" ? data.membership_expires_at : ""
  const qualities = Array.isArray(data?.membership_free_image_qualities) ? data.membership_free_image_qualities : []

  return Boolean(
    data?.membership_tier &&
      expiresAt &&
      new Date(expiresAt).getTime() > Date.now() &&
      qualities.includes(quality)
  )
}

function parseStoredReferenceImages(value: unknown): StoredReferenceImage[] {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {}

    return {
      bucket: String(record.bucket ?? ""),
      name: String(record.name ?? "reference-image"),
      path: String(record.path ?? ""),
      size: Number(record.size),
      type: String(record.type ?? ""),
    }
  })
}

function validateReferenceFiles(referenceImages: File[]) {
  if (referenceImages.length > maxReferenceImages) {
    throw new Error(`参考图最多上传 ${maxReferenceImages} 张。`)
  }

  for (const image of referenceImages) {
    validateReferenceImageMetadata({ size: image.size, type: image.type })
  }
}

function validateStoredReferenceImages(referenceImages: StoredReferenceImage[], userId: string) {
  if (referenceImages.length > maxReferenceImages) {
    throw new Error(`参考图最多上传 ${maxReferenceImages} 张。`)
  }

  const expectedBucket = getReferenceImageBucket()
  const expectedPrefix = getReferenceImagePathPrefix(userId)

  for (const image of referenceImages) {
    validateReferenceImageMetadata({ size: image.size, type: image.type })

    if (image.bucket !== expectedBucket) {
      throw new Error("参考图存储位置无效。")
    }

    if (!image.path || !image.path.startsWith(expectedPrefix) || image.path.includes("..")) {
      throw new Error("参考图路径无效。")
    }
  }
}

async function prepareReferenceImages({
  referenceFiles,
  storedReferenceImages,
  userId,
}: {
  referenceFiles: File[]
  storedReferenceImages: StoredReferenceImage[]
  userId: string
}): Promise<PreparedReferenceImage[]> {
  if (referenceFiles.length > 0) {
    return Promise.all(
      referenceFiles.map(async (image) => ({
        buffer: Buffer.from(await image.arrayBuffer()),
        mimeType: image.type,
        name: image.name,
      }))
    )
  }

  if (storedReferenceImages.length === 0) return []

  validateStoredReferenceImages(storedReferenceImages, userId)
  const supabase = getSupabaseServerClient()

  return Promise.all(
    storedReferenceImages.map(async (image) => {
      const { data, error } = await supabase.storage.from(image.bucket).download(image.path)

      if (error) {
        throw new Error(describeServerError(error, "读取参考图失败。"), { cause: error })
      }

      const buffer = Buffer.from(await data.arrayBuffer())
      validateReferenceImageMetadata({ size: buffer.byteLength, type: image.type })
      const { data: publicData } = supabase.storage.from(image.bucket).getPublicUrl(image.path)

      return {
        bucket: image.bucket,
        buffer,
        mimeType: image.type,
        name: image.name,
        path: image.path,
        publicUrl: publicData.publicUrl,
      }
    })
  )
}

async function prepareYunwuReferenceImageUrls(referenceImages: PreparedReferenceImage[], userId: string, setStage: () => void) {
  if (referenceImages.length === 0) return []

  setStage()
  const urls: string[] = []

  for (const image of referenceImages) {
    if (image.publicUrl) {
      urls.push(image.publicUrl)
      continue
    }

    const uploaded = await uploadGeneratedImage({
      buffer: image.buffer,
      contentType: image.mimeType,
      userId,
    })
    image.bucket = uploaded.bucket
    image.path = uploaded.path
    image.publicUrl = uploaded.publicUrl
    urls.push(uploaded.publicUrl)
  }

  return urls
}

async function prepareToapisReferenceImageUrls(referenceImages: PreparedReferenceImage[], setStage: () => void) {
  if (referenceImages.length === 0) return []

  setStage()
  const urls = referenceImages.map((image) => image.publicUrl).filter((url): url is string => Boolean(url))

  if (urls.length !== referenceImages.length) {
    throw new Error("ToAPIs 参考图必须先上传为可访问 URL。")
  }

  return urls
}

async function prepareApimartReferenceImageUrls(referenceImages: PreparedReferenceImage[], setStage: () => void) {
  if (referenceImages.length === 0) return []

  setStage()
  const urls = referenceImages.map((image) => image.publicUrl).filter((url): url is string => Boolean(url))

  if (urls.length !== referenceImages.length) {
    throw new Error("APIMart 参考图必须先上传为可访问 URL。")
  }

  return urls
}

async function cleanupStoredReferenceImages(referenceImages: PreparedReferenceImage[]) {
  const storedImages = referenceImages.filter((image) => image.bucket && image.path)
  if (storedImages.length === 0) return

  const pathsByBucket = new Map<string, string[]>()
  storedImages.forEach((image) => {
    if (!image.bucket || !image.path) return
    pathsByBucket.set(image.bucket, [...(pathsByBucket.get(image.bucket) ?? []), image.path])
  })

  await Promise.all(
    Array.from(pathsByBucket.entries()).map(async ([bucket, paths]) => {
      const { error } = await getSupabaseServerClient().storage.from(bucket).remove(paths)
      if (error) {
        console.warn("[Supabase Storage] reference image cleanup failed", {
          bucket,
          error: describeServerError(error, "清理参考图失败。"),
          paths,
        })
      }
    })
  )
}

function isImageFile(value: FormDataEntryValue): value is File {
  return typeof value !== "string" && value.size > 0
}

function toFileLog(file: File) {
  return {
    type: file.type,
    size: file.size,
  }
}

function buildInputReferenceImages(referenceImages: PreparedReferenceImage[]): ProjectReferenceImage[] {
  return referenceImages
    .map((image) => {
      if (!image.bucket || !image.path || !image.publicUrl) return null

      return {
        bucket: image.bucket,
        name: image.name,
        path: image.path,
        publicUrl: image.publicUrl,
        size: image.buffer.byteLength,
        type: image.mimeType,
      } satisfies ProjectReferenceImage
    })
    .filter((image): image is ProjectReferenceImage => image !== null)
}

function logGenerateImage(label: string, value: unknown) {
  if (label === "error") {
    console.error(`[Generate Image] ${label}`, value)
    return
  }

  if (process.env.LOG_GENERATION_DEBUG !== "1") return
  console.log(`[Generate Image] ${label}`, value)
}

function maskId(value: string) {
  if (!value) return ""
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}
