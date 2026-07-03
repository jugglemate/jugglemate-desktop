<script setup>
// Fallback renderer. The IM server can hand us any custom message name (or a
// new built-in that the client doesn't know about yet). Instead of failing or
// rendering nothing, we display a one-line "[未知消息]" pill with the raw
// `name` underneath for debugging. Lives at the bottom of the MessageItem
// dispatcher chain.

import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const raw = computed(() => {
  try {
    return JSON.stringify(props.message?.content ?? null)
  } catch (e) {
    return String(props.message?.content ?? '')
  }
})
</script>

<template>
  <div class="jm-msg-unknown" :title="raw">
    <span class="jm-msg-unknown__icon">?</span>
    <span>未知消息</span>
    <span v-if="message?.name" class="jm-msg-unknown__name">{{ message.name }}</span>
  </div>
</template>

<style scoped>
.jm-msg-unknown {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px dashed var(--border);
  border-radius: var(--r);
  font-size: 12px;
  color: var(--text-3);
  background: var(--bg-soft);
  max-width: 320px;
}

.jm-msg-unknown__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--bg);
  color: var(--text-2);
  font-weight: 600;
  font-size: 11px;
}

.jm-msg-unknown__name {
  margin-left: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  opacity: 0.7;
}
</style>
