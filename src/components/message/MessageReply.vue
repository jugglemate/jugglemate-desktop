<script setup>
// Inline reply-quote chip rendered inside the bubble.
//
// JuggleIM carries the quoted message under message.referMsg (sometimes
// also .refer). The shape is the same as a regular message — we only
// need a short preview + the original sender's name + an icon that hints
// at the source type. We DON'T render the full quoted content; that's
// what scroll-into-view is for when the user clicks the chip.

import { computed } from 'vue'
import im from '../../common/im'
import { MSG_NAME } from '../../common/enum'

const props = defineProps({
  // The current message, whose `referMsg` (or `refer`) field carries the
  // quoted payload. We read it here so the template stays simple.
  message: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['navigate'])

const { MessageType } = im

// Resolve the actual referenced message. SDK puts it under either field
// depending on the version; we accept both so older messages still render.
const refer = computed(() => props.message?.referMsg || props.message?.refer || null)

const senderName = computed(() => {
  const r = refer.value
  if (!r) return ''
  return r?.sender?.name || r?.sender?.id || ''
})

// Pick a short text preview for the source message based on its type. The
// goal is to surface what the user is replying to, not the full payload.
const preview = computed(() => {
  const r = refer.value
  if (!r) return ''
  const c = r.content
  const name = r.name
  if (name === MessageType.TEXT || name === MessageType.STREAM_TEXT) {
    const text = (c && typeof c === 'object' ? c.content : c) || ''
    return String(text).slice(0, 80)
  }
  if (name === MessageType.IMAGE) return '[图片]'
  if (name === MessageType.VIDEO) return '[视频]'
  if (name === MessageType.VOICE) return '[语音]'
  if (name === MessageType.FILE) {
    const fname = c && typeof c === 'object' ? c.name : ''
    return fname ? `[文件] ${fname}` : '[文件]'
  }
  if (name === MessageType.MERGE) return '[合并转发]'
  if (name === MSG_NAME.CONTACT_CARD) return '[名片]'
  if (name === MSG_NAME.ANIMATION_STICKER) return '[表情]'
  return '[消息]'
})

// Lightweight icon per source type — keeps the chip scannable in a long
// thread where reply-after-reply after reply happens.
const iconKind = computed(() => {
  const r = refer.value
  if (!r) return 'text'
  const n = r.name
  if (n === MessageType.IMAGE) return 'image'
  if (n === MessageType.VIDEO) return 'video'
  if (n === MessageType.VOICE) return 'voice'
  if (n === MessageType.FILE) return 'file'
  if (n === MessageType.MERGE) return 'merge'
  if (n === MSG_NAME.CONTACT_CARD) return 'card'
  if (n === MSG_NAME.ANIMATION_STICKER) return 'sticker'
  return 'text'
})

// Click the chip → ask the parent to scroll the original message into view.
// The parent (ChatMain / scroll controller) knows how to find the message
// by id; we just bubble the intent up.
function onClick() {
  if (!refer.value) return
  emit('navigate', { messageId: refer.value.messageId || refer.value.id, refer: refer.value })
}
</script>

<template>
  <div
    v-if="refer"
    class="jm-msg-reply"
    :class="`jm-msg-reply--${iconKind}`"
    role="button"
    tabindex="0"
    :title="`跳转到 ${senderName} 的消息`"
    @click="onClick"
    @keydown.enter.prevent="onClick"
  >
    <span class="jm-msg-reply__bar" aria-hidden="true"></span>
    <div class="jm-msg-reply__body">
      <div class="jm-msg-reply__sender">{{ senderName }}</div>
      <div class="jm-msg-reply__preview">
        <svg
          v-if="iconKind === 'image'"
          class="jm-msg-reply__icon"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
        <svg
          v-else-if="iconKind === 'video'"
          class="jm-msg-reply__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        <svg
          v-else-if="iconKind === 'voice'"
          class="jm-msg-reply__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>
        <svg
          v-else-if="iconKind === 'file'"
          class="jm-msg-reply__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
        <svg
          v-else-if="iconKind === 'merge'"
          class="jm-msg-reply__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <svg
          v-else-if="iconKind === 'card'"
          class="jm-msg-reply__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M15 9h3M15 12h3M7 16h10"/></svg>
        <svg
          v-else-if="iconKind === 'sticker'"
          class="jm-msg-reply__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>
        <span class="jm-msg-reply__text">{{ preview }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jm-msg-reply {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 6px 8px;
  margin-bottom: 6px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  line-height: 1.4;
  transition: background 120ms ease, transform 80ms ease;
  outline: none;
}

.jm-msg-reply:hover {
  transform: translateY(-1px);
}

.jm-msg-reply:focus-visible {
  box-shadow: 0 0 0 2px var(--primary-glow);
}

/* incoming 走白底 + 左边 3px 主色线；outgoing 走半透白底 + 1px 白边 */
.jm-msg-reply {
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid transparent;
}

:global(.jm-msg--incoming) .jm-msg-reply {
  background: rgba(15, 23, 42, 0.04);
}
:global(.jm-msg--incoming) .jm-msg-reply:hover {
  background: rgba(0, 128, 255, 0.06);
}

:global(.jm-msg--outgoing) .jm-msg-reply {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.18);
}
:global(.jm-msg--outgoing) .jm-msg-reply:hover {
  background: rgba(255, 255, 255, 0.18);
}

.jm-msg-reply__bar {
  width: 3px;
  border-radius: 2px;
  background: var(--primary);
  flex-shrink: 0;
}

:global(.jm-msg--outgoing) .jm-msg-reply__bar {
  background: #ffffff;
}

.jm-msg-reply__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.jm-msg-reply__sender {
  font-weight: 600;
  font-size: 11.5px;
  color: var(--primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:global(.jm-msg--outgoing) .jm-msg-reply__sender {
  color: rgba(255, 255, 255, 0.92);
}

.jm-msg-reply__preview {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
}

:global(.jm-msg--outgoing) .jm-msg-reply__preview {
  color: rgba(255, 255, 255, 0.80);
}

.jm-msg-reply__icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--text-3);
  margin-top: 1px;
}

:global(.jm-msg--outgoing) .jm-msg-reply__icon {
  color: rgba(255, 255, 255, 0.70);
}

.jm-msg-reply__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
</style>
