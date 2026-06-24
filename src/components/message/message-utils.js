// Pure helpers used by the message rendering tree. Kept out of any component
// so they're easy to test and share between MessageItem and the right-click
// menu. Mirrors the small surface of snailchat-web's message-utils.js.

import im from '../../common/im'

const { ConversationType } = im

// Group conversations are PRIVATE=1, GROUP=2 in JuggleIM. Anything else
// (chatroom, custom) is treated as not-a-group for read-percentage purposes.
function isGroup(message) {
  if (!message) return false
  return message.conversationType === ConversationType.GROUP
}

// JuggleIM reports readCount/unreadCount for group messages. The convention is
// percent = read / (read + unread), returned as a 0-360 sweep angle so a CSS
// conic-gradient can render the progress ring.
function getGroupReadPercent(message) {
  const unread = message?.unreadCount || 0
  const read = message?.readCount || 0
  const total = unread + read
  if (total <= 0) return 0
  return Math.floor((read / total) * 360)
}

// Friendly label for a SentState value. Used by MessageBubble to render the
// spinner / failed / success icon next to outgoing messages.
const sentStateLabel = (state) => {
  const { SentState } = im
  switch (state) {
    case SentState.SENDING: return 'sending'
    case SentState.SUCCESS: return 'success'
    case SentState.FAILED: return 'failed'
    case SentState.UPLOADING: return 'uploading'
    default: return 'none'
  }
}

export default {
  isGroup,
  getGroupReadPercent,
  sentStateLabel
}

export { isGroup, getGroupReadPercent, sentStateLabel }
