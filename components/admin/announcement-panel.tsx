"use client"

import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Loader2, Megaphone, Plus, Save, Trash2 } from "lucide-react"
import { AdminInput } from "@/components/admin/admin-form-controls"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  announcementIconOptions,
  createAnnouncementItem,
  defaultAnnouncementSettings,
  type AnnouncementIcon,
  type AnnouncementItem,
  type AnnouncementSettings,
} from "@/lib/announcement"
import { loadAnnouncementSettings, saveAnnouncementSettings } from "@/lib/supabase"

export function AnnouncementPanel() {
  const [form, setForm] = useState<AnnouncementSettings>(defaultAnnouncementSettings)
  const [feedback, setFeedback] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadAnnouncementSettings()
      .then(setForm)
      .catch((error) => setFeedback(error instanceof Error ? error.message : "公告加载失败。"))
      .finally(() => setLoading(false))
  }, [])

  const updateItem = (id: string, patch: Partial<AnnouncementItem>) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }))
  }

  const moveItem = (index: number, offset: number) => {
    setForm((current) => {
      const target = index + offset
      if (target < 0 || target >= current.items.length) return current

      const items = [...current.items]
      const [moved] = items.splice(index, 1)
      items.splice(target, 0, moved)
      return { ...current, items }
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setFeedback("")

    try {
      const saved = await saveAnnouncementSettings(form)
      setForm(saved)
      setFeedback("公告已保存，用户下次进入工作台会重新弹出。")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "公告保存失败。")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载公告...
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-5">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-indigo-600" />
          <h2 className="text-base font-semibold">公告设置</h2>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="flex items-center justify-between gap-4 rounded-md border border-slate-200 p-4">
            <span>
              <span className="block text-sm font-medium text-slate-800">启用公告</span>
              <span className="mt-1 block text-xs text-slate-500">
                关闭后用户端不显示公告按钮，也不会自动弹出。
              </span>
            </span>
            <Switch
              checked={form.enabled}
              onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <AdminInput
              label="公告标题"
              onChange={(title) => setForm((current) => ({ ...current, title }))}
              placeholder="系统公告"
              value={form.title}
            />
            <AdminInput
              label="副标题（可选）"
              onChange={(subtitle) => setForm((current) => ({ ...current, subtitle }))}
              placeholder="例如：平台最新动态与充值说明"
              value={form.subtitle}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">公告条目</h2>
            <p className="mt-1 text-xs text-slate-500">
              每条包含图标、标题和内容，内容中的网址会自动变成可点击链接。
            </p>
          </div>
          <Button
            onClick={() => setForm((current) => ({ ...current, items: [...current.items, createAnnouncementItem()] }))}
            size="sm"
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            新增条目
          </Button>
        </div>

        <div className="mt-4 grid gap-4">
          {form.items.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              暂无公告条目，点击“新增条目”开始编辑。
            </div>
          ) : (
            form.items.map((item, index) => (
              <div className="rounded-md border border-slate-200 p-4" key={item.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">第 {index + 1} 条</span>
                  <div className="flex items-center gap-1">
                    <Button
                      aria-label="上移"
                      className="h-8 w-8"
                      disabled={index === 0}
                      onClick={() => moveItem(index, -1)}
                      size="icon"
                      variant="ghost"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label="下移"
                      className="h-8 w-8"
                      disabled={index === form.items.length - 1}
                      onClick={() => moveItem(index, 1)}
                      size="icon"
                      variant="ghost"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label="删除条目"
                      className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          items: current.items.filter((existing) => existing.id !== item.id),
                        }))
                      }
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <label className="grid gap-1">
                    <span className="text-sm font-medium text-slate-700">图标</span>
                    <select
                      className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                      onChange={(event) => updateItem(item.id, { icon: event.target.value as AnnouncementIcon })}
                      value={item.icon}
                    >
                      {announcementIconOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <AdminInput
                    label="条目标题"
                    onChange={(title) => updateItem(item.id, { title })}
                    placeholder="例如：对公转账与开票说明"
                    value={item.title}
                  />
                </div>

                <label className="mt-3 grid gap-1">
                  <span className="text-sm font-medium text-slate-700">条目内容</span>
                  <textarea
                    className="min-h-24 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                    onChange={(event) => updateItem(item.id, { content: event.target.value })}
                    placeholder="支持多行文本，粘贴的网址会自动识别为链接。"
                    value={item.content}
                  />
                </label>
              </div>
            ))
          )}
        </div>

        {feedback ? <p className="mt-4 text-sm text-slate-600">{feedback}</p> : null}

        <Button
          className="mt-4 w-fit bg-indigo-600 text-white hover:bg-indigo-700"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存公告
        </Button>
      </div>
    </div>
  )
}
