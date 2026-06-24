<script setup>
// File bubble. Renders a card with file icon, name, size. Clicking opens the
// download URL in a new tab. The content shape is the SDK convention:
//   { url, name, type, size }

import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const url = computed(() => props.message?.content?.url || '')
const name = computed(() => props.message?.content?.name || '未命名文件')
const size = computed(() => Number(props.message?.content?.size) || 0)
const mime = computed(() => props.message?.content?.type || '')

const sizeLabel = computed(() => formatSize(size.value))

// Pick a small inline icon for the file's mime type. Avoids depending on
// iconfont — uses the `wr-*` class slot in jugglemate's existing CSS is
// not exposed here, so we render a Unicode glyph by type.
const icon = computed(() => {
  const t = mime.value
  if (!t) return '📄'
  if (t.startsWith('image/')) return '🖼️'
  if (t.startsWith('video/')) return '🎬'
  if (t.startsWith('audio/')) return '🎵'
  if (t.includes('pdf')) return '📕'
  if (t.includes('zip') || t.includes('rar') || t.includes('tar')) return '🗜️'
  if (t.includes('word') || t.includes('document')) return '📘'
  if (t.includes('sheet') || t.includes('excel')) return '📗'
  if (t.includes('presentation') || t.includes('powerpoint')) return '📙'
  return '📄'
})

function formatSize(n) {
  if (!n || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function onClick() {
  if (url.value) {
    window.open(url.value, '_blank', 'noopener')
  }
}
</script>

<template>
  <button
    class="jm-msg-file"
    type="button"
    :title="name"
    @click="onClick"
  >
    <div class="jm-msg-file__icon">{{ icon }}</div>
    <div class="jm-msg-file__info">
      <div class="jm-msg-file__name">{{ name }}</div>
      <div v-if="sizeLabel || mime" class="jm-msg-file__meta">
        <span v-if="sizeLabel">{{ sizeLabel }}</span>
        <span v-if="sizeLabel && mime"> · </span>
        <span v-if="mime">{{ mime }}</span>
      </div>
    </div>
    <div class="jm-msg-file__action" aria-hidden="true">↓</div>
  </button>
</template>

<style scoped>
.jm-msg-file {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: 320px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-sans);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.jm-msg-file:hover {
  background: var(--bg-hover);
  border-color: var(--accent-dim);
}

.jm-msg-file__icon {
  font-size: 24px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.jm-msg-file__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.jm-msg-file__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.jm-msg-file__meta {
  font-size: 11px;
  color: var(--text-tertiary);
}

.jm-msg-file__action {
  color: var(--text-tertiary);
  font-size: 14px;
  flex-shrink: 0;
}
</style>
