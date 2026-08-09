"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

const DigitalCanvasShell = dynamic(
  () => import("@/components/digital-canvas/digital-canvas-shell").then((module) => module.DigitalCanvasShell),
  {
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在加载数字画布...
      </div>
    ),
    ssr: false,
  }
)

export default function DigitalCanvasPage() {
  return <DigitalCanvasShell />
}
