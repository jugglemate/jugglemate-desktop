<script setup>
// Reply banner. Shown above the composer when the user clicks "引用" on a
// message. Captures the source message and exposes a `cancel` event.
//
// Content is the short text preview of the source message, with the sender's
// name prefixed. The parent passes it down to MessageSender so the
// `juggle.sendMessage` call can include the `referMsg` field.

import { computed } from 'vue'
import im from '../common/im'

const props = defineProps({
  message: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['cancel'])

const { MessageType } = im

const preview = computed(() => {
  const m = props.message
  if (!m) return ''
  const senderName = m?.sender?.name || m?.sender?.id || ''
  const c = m?.content
  if (!c) return senderName
  if (m.name === MessageType.TEXT) {
    const text = typeof c === 'string' ? c : c.content || ''
    return `${senderName}：${String(text).slice(0, 60)}`
  }
  if (m.name === MessageType.IMAGE) return `${senderName}：[图片]`
  if (m.name === MessageType.FILE) return `${senderName}：[文件] ${c.name || ''}`
  if (m.name === MessageType.VIDEO) return `${senderName}：[视频]`
  if (m.name === MessageType.VOICE) return `${senderName}：[语音]`
  return senderName
})
</script>

<template>
  <div v-if="message" class="jm-reply-quote">
    <div class="jm-reply-quote__line"></div>
    <div class="jm-reply-quote__content">
      <div class="jm-reply-quote__label">引用</div>
      <div class="jm-reply-quote__preview">{{ preview }}</div>
    </div>
    <button
      class="jm-reply-quote__cancel"
      type="button"
      aria-label="取消引用"
      @click="emit('cancel')"
    >✕</button>
  </div>
</template>

<style scoped>
.jm-reply-quote {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 6px 20px 4px;
  background: var(--bg);
  border-top: 1px solid var(--border-soft);
  font-family: var(--font-sans);
}

.jm-reply-quote__line {
  width: 3px;
  background: var(--primary);
  border-radius: 2px;
  flex-shrink: 0;
}

.jm-reply-quote__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
}

.jm-reply-quote__label {
  font-size: 11px;
  color: var(--primary);
  font-weight: 600;
}

.jm-reply-quote__preview {
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.jm-reply-quote__cancel {
  background: transparent;
  border: none;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
  padding: 0 4px;
  align-self: center;
}

.jm-reply-quote__cancel:hover {
  color: var(--text-1);
}
</style>
