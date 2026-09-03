// Shared protocol and resource helpers for `snl:sticker` messages.
// The wire payload deliberately contains only { path, name }; picker-only
// fields must never leak into stored messages.

export const composerEmojis = [
  '👌', '😄', '😆', '😅', '😂', '😭', '🥰', '🥳', '🫠', '😊', '🫡',
  '🤫', '🤗', '💔', '❤️', '🤨', '😮', '😴', '😡', '😥', '😇', '🥶',
  '🤧', '💩', '🔥', '🌪', '🌞', '💥', '😵', '😎', '🎉', '💯', '💪',
  '👏', '👍', '🤞', '🙏', '🌈', '🌍', '☕', '🎾', '🍻', '🏕'
]

const packNumbers = {
  '1': Array.from({ length: 30 }, (_, i) => i + 1),
  '2': Array.from({ length: 19 }, (_, i) => i + 1),
  '3': Array.from({ length: 19 }, (_, i) => i + 1),
  '4': Array.from({ length: 14 }, (_, i) => i + 1),
  '5': Array.from({ length: 27 }, (_, i) => i + 1)
}

export const stickerPacks = Object.entries(packNumbers).map(([id, numbers]) => ({
  id,
  items: numbers.map((number) => ({ path: id, name: String(number) }))
}))

export function normalizeStickerContent(raw) {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const path = String(value.path ?? '')
  const rawName = String(value.name ?? '')
  if (!/^\d+$/.test(rawName)) return null
  const nameNumber = Number(rawName)
  const allowed = packNumbers[path]
  if (!allowed || !allowed.includes(nameNumber)) return null
  return { path, name: String(nameNumber) }
}

export function getStickerAssetUrl(raw) {
  const content = normalizeStickerContent(raw)
  if (!content) return ''
  const base = import.meta.env.BASE_URL || './'
  return `${base}stickers/sticker_${content.path}/AnimatedSticker (${content.name}).tgs`
}
