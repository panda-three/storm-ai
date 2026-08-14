"use client"

import { useCallback } from "react"
import { useReactFlow } from "@xyflow/react"
import { Trash2 } from "lucide-react"

/**
 * 节点右上角的删除按钮：默认隐藏，鼠标悬浮或节点被选中时出现。
 * 需要在节点根元素上加 `group` 与 `relative`。
 */
export function NodeDeleteButton({ id, label = "删除节点" }: { id: string; label?: string }) {
  const { deleteElements } = useReactFlow()

  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      void deleteElements({ nodes: [{ id }] })
    },
    [deleteElements, id]
  )

  return (
    <button
      aria-label={label}
      className="nodrag nopan absolute -right-2.5 -top-2.5 z-10 grid h-7 w-7 place-items-center rounded-full border border-rose-200 bg-white text-rose-500 opacity-0 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
      onClick={handleDelete}
      title={label}
      type="button"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}
