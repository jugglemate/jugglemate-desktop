<script setup>
// Ticket assign system notification.
// Displayed as a centered muted pill (no avatar, no sender), matching the
// visual language of MessageRecall / MessageTimeline system rows.
// assign_type: 0 = self-claim, 1 = assigned by others,
// 3 = human takeover, 4 = ticket restarted.

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

const assignType = computed(() => content.value?.assign_type)

const text = computed(() => {
  if (!content.value) return ''
  const op = content.value.operator?.nickname || ''
  const ae = content.value.assignee?.nickname || ''
  if (assignType.value === 0) {
    // 自助接单
    return ae ? `${ae} 认领了工单` : '已认领工单'
  }
  if (assignType.value === 1) {
    // 转单给其他客服
    if (op && ae) return `工单由 ${op} 转给 ${ae}`
    if (ae) return `工单已转给 ${ae}`
    return '工单已转移'
  }
  if (assignType.value === 3) {
    // 已转为人工接待
    return '已转为人工接待'
  }
  if (assignType.value === 4) {
    // 工单重新打开；该类型不携带 operator / assignee。
    return '工单已重启'
  }
  // 其他未知类型兜底
  if (op && ae) return `由 ${op} 分配给 ${ae}`
  if (ae) return `已分配给 ${ae}`
  return '[工单分配]'
})
</script>

<template>
  <div class="jm-msg-ticket-assign">
    <span class="jm-msg-ticket-assign__pill">{{ text }}</span>
  </div>
</template>

<style scoped>
.jm-msg-ticket-assign {
  display: flex;
  justify-content: center;
  padding: 4px 0;
}

.jm-msg-ticket-assign__pill {
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
