<script setup>
// Time-divider row. Renders a thin horizontal rule with a centered label like
// "14:32" or "昨天". Used by MessageItem to push a divider between messages
// whose sentTime gap exceeds 5 minutes (see chat-time-utils.shouldShowTimeSeparator).
import { getTimeSeparatorText } from '../../common/chat-time-utils'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const label = getTimeSeparatorText(props.message?.sentTime)
</script>

<template>
  <div class="jm-msg-timeline">
    <span class="jm-msg-timeline__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.jm-msg-timeline {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 0 6px;
  position: relative;
}

/* .jm-msg-timeline::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: var(--border-soft);
  z-index: 0;
} */

.jm-msg-timeline__label {
  position: relative;
  z-index: 1;
  padding: 2px 10px;
  /* background: var(--bg); */
  /* border-radius: var(--r-sm); */
  font-size: 11px;
  color: var(--text-3);
}
</style>
