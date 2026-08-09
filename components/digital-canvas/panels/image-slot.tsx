"use client"

import { useCallback, useRef, useState } from "react"
import { ImagePlus, X } from "lucide-react"
import type { StoredReferenceImage } from "@/lib/reference-images"

export interface SlotImage {
  // 预览用地址：本地文件为 objectURL，画布/历史取图为远端 URL
  url: string
  file?: File
  name?: string
  // 已上传到参考图存储后的结果，避免重复上传
  stored?: StoredReferenceImage
}

interface ImageSlotProps {
  label: string
  hint: string
  value: SlotImage | null
  onChange: (next: SlotImage | null) => void
}

export function ImageSlot({ hint, label, onChange, value }: ImageSlotProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const acceptFile = useCallback(
    (file: File | null | undefined) => {
      if (!file || !file.type.startsWith("image/")) return
      onChange({ file, name: file.name, url: URL.createObjectURL(file) })
    },
    [onChange]
  )

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-slate-600">{label}</span>
        {value ? (
          <button
            className="text-[11px] text-slate-400 transition hover:text-rose-500"
            onClick={() => onChange(null)}
            type="button"
          >
            清除
          </button>
        ) : null}
      </div>

      <button
        className={`relative flex h-28 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition ${
          dragging
            ? "border-cyan-400 bg-cyan-50"
            : value
              ? "border-transparent bg-slate-100"
              : "border-slate-200 bg-slate-50 hover:border-cyan-300 hover:bg-cyan-50/40"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          acceptFile(event.dataTransfer.files?.[0])
        }}
        type="button"
      >
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={label} className="h-full w-full object-cover" src={value.url} />
            <span
              className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/60 text-white transition hover:bg-rose-500"
              onClick={(event) => {
                event.stopPropagation()
                onChange(null)
              }}
              role="presentation"
            >
              <X className="h-3 w-3" />
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11px] text-slate-400">
            <ImagePlus className="h-5 w-5" />
            {hint}
          </span>
        )}
      </button>

      <input
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          acceptFile(event.target.files?.[0])
          event.target.value = ""
        }}
        ref={inputRef}
        type="file"
      />
    </div>
  )
}
