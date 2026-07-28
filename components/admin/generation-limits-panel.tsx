"use client"

import { useEffect, useState } from "react"
import { Loader2, Save, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  defaultGenerationLimitsSettings,
  type GenerationLimitsSettings,
} from "@/lib/generation-limits"
import {
  loadGenerationLimitsSettings,
  saveGenerationLimitsSettings,
} from "@/lib/supabase"

export function GenerationLimitsPanel() {
  const [form, setForm] = useState<GenerationLimitsSettings>(defaultGenerationLimitsSettings)
  const [feedback, setFeedback] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadGenerationLimitsSettings()
      .then(setForm)
      .catch((error) => setFeedback(error instanceof Error ? error.message : "生成限制加载失败。"))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setFeedback("")

    try {
      const savedSettings = await saveGenerationLimitsSettings(form)
      if (savedSettings) setForm(savedSettings)
      setFeedback("生成限制已保存。")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "生成限制保存失败。")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-indigo-600" />
        <h2 className="text-base font-semibold">生成限制</h2>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载...
        </div>
      ) : (
        <div className="mt-5 grid max-w-xl gap-5">
          <label className="flex items-center justify-between gap-4 rounded-md border border-slate-200 p-4">
            <span>
              <span className="block text-sm font-medium text-slate-800">启用图片任务限制</span>
              <span className="mt-1 block text-xs text-slate-500">关闭后不检查在途任务数和每日任务数。</span>
            </span>
            <Switch
              checked={form.enabled}
              onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
            />
          </label>

          <GenerationLimitInput
            disabled={!form.enabled}
            label="每账号最多在途图片任务"
            onChange={(maxActiveImageTasks) => setForm((current) => ({ ...current, maxActiveImageTasks }))}
            value={form.maxActiveImageTasks}
          />
          <GenerationLimitInput
            disabled={!form.enabled}
            label="每账号每日最多图片任务"
            onChange={(maxDailyImageTasks) => setForm((current) => ({ ...current, maxDailyImageTasks }))}
            value={form.maxDailyImageTasks}
          />

          {feedback ? <p className="text-sm text-slate-600">{feedback}</p> : null}

          <Button className="w-fit bg-indigo-600 text-white hover:bg-indigo-700" disabled={saving} onClick={handleSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存生成限制
          </Button>
        </div>
      )}
    </div>
  )
}

function GenerationLimitInput({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean
  label: string
  onChange: (value: number) => void
  value: number
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        min="1"
        onChange={(event) => onChange(Number(event.target.value))}
        step="1"
        type="number"
        value={value}
      />
    </label>
  )
}
