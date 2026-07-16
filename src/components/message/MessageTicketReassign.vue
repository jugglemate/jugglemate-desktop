<script setup>
// Ticket reassign system notification.
// Displayed as one or two centered muted pills (no avatar, no sender), matching
// the visual language of MessageTicketAssign / MessageRecall.
//
// payload:
//   {
//     ticket_id,
//     from:  { id, name },
//     to:    { id, name },
//     note:  "" | string
//   }
//
// Visibility:
//   - "工单由 X 转给 Y" 一行对会话两端均可见。
//   - "备注：..." 灰条仅 payload.to.id 等于当前用户 id 时显示。

import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const content = computed(() => {
  const raw = props.message?.content
  if (!raw) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw
})

const reassignText = computed(() => {
  const from = content.value?.from?.name || ''
  const to = content.value?.to?.name || ''
  if (from && to) return `工单由 ${from} 转给 ${to}`
  if (to) return `工单已转给 ${to}`
  return '工单已转移'
})

const noteText = computed(() => {
  const note = (content.value?.note || '').trim()
  return note
})

</script>

<template>
  <div class="jm-msg-ticket-reassign">
    <span class="jm-msg-ticket-reassign__pill">{{ reassignText }}</span>
    <span v-if="noteText" class="jm-msg-ticket-reassign__pill jm-msg-ticket-reassign__pill--note">
      备注：{{ noteText }}
    </span>
  </div>
</template>

<style scoped>
.jm-msg-ticket-reassign {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.jm-msg-ticket-reassign__pill {
  max-width: 80%;
  padding: 2px 10px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-sm);
  word-break: break-word;
  text-align: center;
}
</style>
