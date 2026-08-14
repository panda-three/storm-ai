"use client"

import { useRef, useState } from "react"
import { ImagePlus, Loader2, X } from "lucide-react"

interface ImageSlotProps {
  label: string
  hint?: string
  url: string | null
  busy?: boolean
  onPick: (file: File) => void
  onClear: () => void
}

export function ImageSlot({ busy = false, hint, label, onClear, onPick, url }: ImageSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (file && file.type.startsWith("image/")) onPick(file)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
      </div>

      <div
        className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition ${
          dragging ? "border-cyan-400 bg-cyan-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"
        }`}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          handleFiles(event.dataTransfer.files)
        }}
      >
        {url ? (
          <>
            <img alt={label} className="h-full w-full object-cover" src={url} />
            <button
              aria-label={`移除${label}`}
              className="absolute right-1.5 top-1.5 rounded-full bg-slate-900/70 p-1 text-white transition hover:bg-slate-900"
              onClick={onClear}
              type="button"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button
            className="flex flex-col items-center gap-1.5 px-3 py-4 text-slate-400 transition hover:text-cyan-600"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <ImagePlus className="h-6 w-6" />
            <span className="text-[11px] leading-relaxed">点击或拖入图片</span>
          </button>
        )}

        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
          </div>
        ) : null}
      </div>

      <input
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files)
          event.target.value = ""
        }}
        ref={inputRef}
        type="file"
      />
    </div>
  )
}
