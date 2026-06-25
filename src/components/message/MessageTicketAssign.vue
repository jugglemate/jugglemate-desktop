<script setup>
// Ticket assign system notification.
// Displayed as a centered pill-like bubble (no avatar, no sender).
// assign_type: 0 = self-claim, 1 = assigned by others.

import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const content = computed(() => {
  try {
    return typeof props.message.content === 'string'
      ? JSON.parse(props.message.content)
      : props.message.content
  } catch {
    return null
  }
})

const isSelfClaim = computed(() => content.value?.assign_type === 0)

const text = computed(() => {
  if (!content.value) return ''
  const op = content.value.operator?.nickname || ''
  const ae = content.value.assignee?.nickname || ''
  if (isSelfClaim.value) {
    return ae ? `${ae} 认领了工单` : '已认领工单'
  }
  return `由 ${op} 分配给 ${ae}`
})
</script>

<template>
  <div class="msg-ticket-assign">
    <div class="msg-ticket-assign__bubble">
      <span class="msg-ticket-assign__icon">💼</span>
      <span class="msg-ticket-assign__text">{{ text }}</span>
    </div>
  </div>
</template>

<style scoped>
.msg-ticket-assign {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.msg-ticket-assign__bubble {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  background: #f5f5f5;
  border-radius: 20px;
  font-size: 13px;
  color: #666;
  max-width: 80%;
}

.msg-ticket-assign__icon {
  font-size: 14px;
  flex-shrink: 0;
}

.msg-ticket-assign__text {
  line-height: 1.4;
}
</style>
