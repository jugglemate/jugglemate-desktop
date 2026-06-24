// Time separator helpers for the chat timeline. Mirrors snailchat-web's
// chat-time-utils.js but trimmed to two responsibilities:
//   - getTimeSeparatorText: render a short human label for the divider row
//     (just now / HH:mm / 昨天 / M月D日 / 去年 M月D日)
//   - shouldShowTimeSeparator: decide whether to push a time divider before
//     the next message based on a 5-minute gap.

const pad2 = (n) => String(n).padStart(2, '0')

const isSameDay = (a, b) => {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

const isYesterday = (a, b) => {
  const y = new Date(b)
  y.setDate(b.getDate() - 1)
  return isSameDay(a, y)
}

const isSameYear = (a, b) => {
  return a.getFullYear() === b.getFullYear()
}

const getTimeSeparatorText = (timestamp) => {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const now = new Date()
  if (isSameDay(d, now)) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
  if (isYesterday(d, now)) {
    return '昨天'
  }
  if (isSameYear(d, now)) {
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// Insert a time divider if the gap between previousTime and currentTime is
// more than 5 minutes. The first message in a list always gets a divider.
const TIME_GAP_MS = 5 * 60 * 1000
const shouldShowTimeSeparator = (currentTime, previousTime) => {
  if (!previousTime) return true
  if (!currentTime) return false
  return Math.abs(currentTime - previousTime) >= TIME_GAP_MS
}

export default {
  getTimeSeparatorText,
  shouldShowTimeSeparator
}

export { getTimeSeparatorText, shouldShowTimeSeparator }
