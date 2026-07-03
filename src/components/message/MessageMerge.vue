<script setup>
// Merge-forwarded message card. Shows a title and a short preview of the
// merged messages. Click to open the detail view; the parent
// (ChatMain) handles loading the full message list via
// juggle.getMergeMessages(message.content) when wired up in a later phase —
// for P3 we render the card and surface an `open` event with the message
// so the parent can decide what to do.

import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['open'])

const title = computed(() => props.message?.content?.title || '聊天记录')
const previews = computed(() => {
  const list = props.message?.content?.previewList || []
  return list.slice(0, 4)
})
const total = computed(() => {
  const list = props.message?.content?.previewList || []
  // SDK stores the full message count under `message.content.messages.length`
  // for the sender-side payload, but the receiver only sees the preview
  // list. We display the preview-list length plus a hint.
  return list.length
})

function onClick() {
  emit('open', props.message)
}
</script>

<template>
  <button
    class="jm-msg-merge"
    type="button"
    @click="onClick"
  >
    <div class="jm-msg-merge__title">
      <span class="jm-msg-merge__icon" aria-hidden="true">📚</span>
      <span>{{ title }}</span>
    </div>
    <ul class="jm-msg-merge__list">
      <li v-for="(p, i) in previews" :key="i" class="jm-msg-merge__item">
        <span class="jm-msg-merge__name">{{ p.userName || p.userId }}：</span>
        <span class="jm-msg-merge__snippet">{{ p.content }}</span>
      </li>
      <li v-if="total > previews.length" class="jm-msg-merge__more">
        …共 {{ total }} 条
      </li>
    </ul>
  </button>
</template>

<style scoped>
.jm-msg-merge {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 240px;
  max-width: 320px;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--r);
  text-align: left;
  cursor: pointer;
  font-family: var(--font-sans);
  color: var(--text-1);
  transition: all var(--t-fast);
}

.jm-msg-merge:hover {
  background: var(--primary-hover);
  border-color: var(--primary-active);
}

.jm-msg-merge__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.jm-msg-merge__icon {
  font-size: 14px;
}

.jm-msg-merge__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text-2);
  max-height: 84px;
  overflow: hidden;
  position: relative;
}

.jm-msg-merge__item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.jm-msg-merge__name {
  color: var(--text-3);
  margin-right: 2px;
}

.jm-msg-merge__more {
  color: var(--text-3);
  font-style: italic;
}
</style>
