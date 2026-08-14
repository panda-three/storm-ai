export type AnnouncementIcon =
  | "megaphone"
  | "sparkles"
  | "info"
  | "receipt"
  | "phone"
  | "download"
  | "link"
  | "gift"
  | "alert"

export interface AnnouncementItem {
  content: string
  icon: AnnouncementIcon
  id: string
  title: string
}

export interface AnnouncementSettings {
  enabled: boolean
  items: AnnouncementItem[]
  subtitle: string
  title: string
  version: string
}

export const announcementIconOptions: { label: string; value: AnnouncementIcon }[] = [
  { label: "喇叭", value: "megaphone" },
  { label: "亮点", value: "sparkles" },
  { label: "说明", value: "info" },
  { label: "票据", value: "receipt" },
  { label: "联系", value: "phone" },
  { label: "下载", value: "download" },
  { label: "链接", value: "link" },
  { label: "礼包", value: "gift" },
  { label: "注意", value: "alert" },
]

const announcementIconValues = announcementIconOptions.map((option) => option.value)

export const defaultAnnouncementSettings: AnnouncementSettings = {
  enabled: false,
  items: [],
  subtitle: "",
  title: "系统公告",
  version: "",
}

function normalizeIcon(value: unknown): AnnouncementIcon {
  return announcementIconValues.includes(value as AnnouncementIcon) ? (value as AnnouncementIcon) : "info"
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

export function createAnnouncementItem(): AnnouncementItem {
  return {
    content: "",
    icon: "info",
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
  }
}

export function normalizeAnnouncementSettings(value: unknown): AnnouncementSettings {
  const raw = (value ?? {}) as Partial<AnnouncementSettings>
  const items = Array.isArray(raw.items) ? raw.items : []

  return {
    enabled: raw.enabled === true,
    items: items
      .map((item, index) => ({
        content: normalizeText((item as AnnouncementItem)?.content),
        icon: normalizeIcon((item as AnnouncementItem)?.icon),
        id: normalizeText((item as AnnouncementItem)?.id) || `item-${index}`,
        title: normalizeText((item as AnnouncementItem)?.title),
      }))
      .filter((item) => item.title.trim() || item.content.trim()),
    subtitle: normalizeText(raw.subtitle),
    title: normalizeText(raw.title).trim() || defaultAnnouncementSettings.title,
    version: normalizeText(raw.version),
  }
}

export function hasAnnouncementContent(settings: AnnouncementSettings) {
  return settings.items.length > 0
}

const dismissedVersionKey = "storm-announcement-dismissed-version"
const dismissedDateKey = "storm-announcement-dismissed-date"

function getToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function shouldAutoOpenAnnouncement(settings: AnnouncementSettings) {
  if (!settings.enabled || !hasAnnouncementContent(settings)) return false
  if (typeof window === "undefined") return false

  try {
    if (window.localStorage.getItem(dismissedVersionKey) === settings.version) return false
    if (window.localStorage.getItem(dismissedDateKey) === getToday()) return false
  } catch {
    return true
  }

  return true
}

export function dismissAnnouncementForToday() {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(dismissedDateKey, getToday())
  } catch {
    // 忽略本地存储不可用的情况
  }
}

export function dismissAnnouncementVersion(version: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(dismissedVersionKey, version)
  } catch {
    // 忽略本地存储不可用的情况
  }
}

const urlSplitPattern = /(https?:\/\/[^\s，。；、）)】]+)/g

export function splitAnnouncementText(text: string) {
  return text
    .split(urlSplitPattern)
    .filter((part) => part.length > 0)
    .map((part, index) => ({
      isLink: part.startsWith("http://") || part.startsWith("https://"),
      key: `${index}-${part.slice(0, 12)}`,
      value: part,
    }))
}
