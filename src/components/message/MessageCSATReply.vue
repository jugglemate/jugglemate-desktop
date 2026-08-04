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

const rating = computed(() => {
  const value = Number(content.value?.rating)
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : null
})

const comment = computed(() => String(content.value?.comment || '').trim())
</script>

<template>
  <div class="jm-msg-csat-reply">
    <div class="jm-msg-csat-reply__title">服务评价已提交</div>
    <div v-if="rating !== null" class="jm-msg-csat-reply__rating">
      {{ rating }} 分
    </div>
    <div v-if="comment" class="jm-msg-csat-reply__comment">{{ comment }}</div>
  </div>
</template>

<style scoped>
.jm-msg-csat-reply {
  min-width: 150px;
  /* color: var(--text-1); */
}

.jm-msg-csat-reply__title {
  font-size: 12px;
  font-weight: 600;
}

.jm-msg-csat-reply__rating {
  margin-top: 4px;
  color: var(--primary);
  font-size: 16px;
  font-weight: 600;
}

.jm-msg-csat-reply__comment {
  margin-top: 6px;
  color: var(--text-2);
  font-size: 12px;
  white-space: pre-wrap;
}
</style>
