"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

const CanvasLabShell = dynamic(
  () => import("@/components/canvas-lab/canvas-lab-shell").then((module) => module.CanvasLabShell),
  {
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在加载无限画布...
      </div>
    ),
    ssr: false,
  }
)

export default function CanvasLabPage() {
  return <CanvasLabShell />
}
