<script setup>
import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const content = computed(() => {
  const raw = props.message?.content
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) || {}
    } catch {
      return {}
    }
  }
  return raw
})

const options = computed(() => {
  const configured = content.value?.csat?.options
  if (Array.isArray(configured) && configured.length) return configured
  return [
    { value: 1, label: '1 很差' },
    { value: 2, label: '2 不满意' },
    { value: 3, label: '3 一般' },
    { value: 4, label: '4 满意' },
    { value: 5, label: '5 很满意' }
  ]
})

const text = computed(() =>
  content.value?.text || '您的会话已结束，请对本次服务做个评价。'
)
</script>

<template>
  <div class="jm-msg-csat">
    <div class="jm-msg-csat__title">服务评价</div>
    <div class="jm-msg-csat__text">{{ text }}</div>
    <div class="jm-msg-csat__options" aria-label="服务评分">
      <span
        v-for="option in options"
        :key="option.value"
        class="jm-msg-csat__option"
      >
        {{ option.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.jm-msg-csat {
  width: min(360px, 100%);
  /* color: var(--text-1); */
}

.jm-msg-csat__title {
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 600;
}

.jm-msg-csat__text {
  margin-bottom: 12px;
  white-space: pre-wrap;
  line-height: 1.55;
}

.jm-msg-csat__options {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
}

.jm-msg-csat__option {
  min-height: 30px;
  padding: 5px 3px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text-2);
  background: var(--bg-soft);
  font-size: 11px;
  line-height: 1.3;
  text-align: center;
}
</style>
