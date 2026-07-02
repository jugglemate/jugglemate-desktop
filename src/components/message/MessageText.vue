<script setup>
// Plain text message. Renders message.content.content with `white-space:
// pre-wrap` so newlines are preserved. URL detection is intentionally a TODO
// for a later phase — snailchat uses a regex pass to convert links to <a>
// tags, but we don't have the safe-html sanitizer wiring in jugglemate-web
// yet, so we ship the text-only rendering first.

import { computed } from 'vue'
import im from '../../common/im'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const text = computed(() => {
  const { content } = props.message || {}
  if (!content) return ''
  if (typeof content === 'string') return content
  if (typeof content.content === 'string') return content.content
  return ''
})

// Mark the "updated" tag for edited messages. JuggleIM sets `isUpdated` on
// the message object after a successful juggle.updateMessage call.
const isUpdated = computed(() => !!props.message?.isUpdated)

const _im = im
void _im
</script>

<template>
  <div class="jm-msg-text">
    <span>{{ text }}</span>
    <span v-if="isUpdated" class="jm-msg-text__updated" title="已编辑">已编辑</span>
  </div>
</template>

<style scoped>
.jm-msg-text {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
}

.jm-msg-text__updated {
  margin-left: 6px;
  font-size: 10px;
  color: var(--text-3);
  font-style: italic;
}
</style>
