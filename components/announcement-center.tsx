"use client"

import { useEffect, useState } from "react"
import {
  AlertCircle,
  Download,
  Gift,
  Info,
  Link2,
  Megaphone,
  Phone,
  ReceiptText,
  Sparkles,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  defaultAnnouncementSettings,
  dismissAnnouncementForToday,
  dismissAnnouncementVersion,
  hasAnnouncementContent,
  shouldAutoOpenAnnouncement,
  splitAnnouncementText,
  type AnnouncementIcon,
  type AnnouncementSettings,
} from "@/lib/announcement"
import { loadAnnouncementSettings } from "@/lib/supabase"

const iconMap: Record<AnnouncementIcon, typeof Info> = {
  alert: AlertCircle,
  download: Download,
  gift: Gift,
  info: Info,
  link: Link2,
  megaphone: Megaphone,
  phone: Phone,
  receipt: ReceiptText,
  sparkles: Sparkles,
}

export function AnnouncementCenter() {
  const [settings, setSettings] = useState<AnnouncementSettings>(defaultAnnouncementSettings)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true

    loadAnnouncementSettings()
      .then((next) => {
        if (!active) return
        setSettings(next)
        if (shouldAutoOpenAnnouncement(next)) setOpen(true)
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [])

  if (!settings.enabled || !hasAnnouncementContent(settings)) return null

  return (
    <>
      <Button
        className="rounded-2xl border-cyan-200 bg-white text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800"
        onClick={() => setOpen(true)}
        size="sm"
        variant="outline"
      >
        <Megaphone className="h-4 w-4" />
        公告
      </Button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 py-10 backdrop-blur-sm">
          <section
            aria-labelledby="announcement-title"
            aria-modal="true"
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl"
            role="dialog"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-950" id="announcement-title">
                  {settings.title}
                </h2>
                {settings.subtitle ? (
                  <p className="mt-1 text-pretty text-sm text-slate-500">{settings.subtitle}</p>
                ) : null}
              </div>
              <Button
                aria-label="关闭公告"
                className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-700"
                onClick={() => setOpen(false)}
                size="icon"
                variant="ghost"
              >
                <X className="h-4 w-4" />
              </Button>
            </header>

            <div className="grid max-h-[60vh] gap-4 overflow-y-auto px-6 py-5">
              {settings.items.map((item) => {
                const Icon = iconMap[item.icon]

                return (
                  <article className="flex gap-3" key={item.id}>
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-700">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 text-sm leading-relaxed">
                      {item.title ? <div className="font-semibold text-slate-900">{item.title}</div> : null}
                      {item.content ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-pretty text-slate-600">
                          <AnnouncementText text={item.content} />
                        </p>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <Button
                onClick={() => {
                  dismissAnnouncementForToday()
                  setOpen(false)
                }}
                size="sm"
                variant="outline"
              >
                今日关闭
              </Button>
              <Button
                className="bg-slate-950 text-white hover:bg-slate-800"
                onClick={() => {
                  dismissAnnouncementVersion(settings.version)
                  setOpen(false)
                }}
                size="sm"
              >
                关闭公告
              </Button>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}

function AnnouncementText({ text }: { text: string }) {
  return (
    <>
      {splitAnnouncementText(text).map((part) =>
        part.isLink ? (
          <a
            className="break-all font-medium text-cyan-700 underline underline-offset-2 hover:text-cyan-800"
            href={part.value}
            key={part.key}
            rel="noreferrer noopener"
            target="_blank"
          >
            {part.value}
          </a>
        ) : (
          <span key={part.key}>{part.value}</span>
        )
      )}
    </>
  )
}
