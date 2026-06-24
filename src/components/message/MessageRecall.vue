<script setup>
// "X 撤回了一条消息" placeholder. The IM server replaces the original
// message in-place with a `RECALL_INFO` message whose `content` carries the
// recalled `messageId` plus the operator. We render a centered dim label.

import { computed } from 'vue'
import im from '../../common/im'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const storage = null // placeholder — we read the current user from im.getCurrent()
void storage

const label = computed(() => {
  const operatorName = props.message?.sender?.name || props.message?.sender?.id || ''
  // The recalled message's original sender is at message.content.messageId /
  // operator — but for the placeholder the standard convention is "operator
  // 撤回了一条消息". If `isSender` is true we substitute "你".
  if (props.message?.isSender) {
    return '你 撤回了一条消息'
  }
  if (operatorName) {
    return `${operatorName} 撤回了一条消息`
  }
  return '撤回了一条消息'
})

// Touch im to keep the bundler aware of the import (used in future phases when
// we cross-reference the operator's user record).
const _im = im
void _im
</script>

<template>
  <div class="jm-msg-recall">
    <span>{{ label }}</span>
  </div>
</template>

<style scoped>
.jm-msg-recall {
  display: flex;
  align-self: center;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  margin: 6px 0;
}
</style>
