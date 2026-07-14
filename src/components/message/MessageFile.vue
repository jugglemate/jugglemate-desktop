<script setup>
// File bubble. Renders a card with file icon, name, size. Clicking opens the
// download URL in a new tab. The content shape is the SDK convention:
//   { url, name, type, size }

import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  // 消息方向：true=收件人(客户/incoming)，false=发件人(客服/outgoing)
  // 决定卡片底色 + 文字色 + 图标底色。
  incoming: {
    type: Boolean,
    default: true
  }
})

const url = computed(() => props.message?.content?.url || '')
const name = computed(() => props.message?.content?.name || '未命名文件')
const size = computed(() => Number(props.message?.content?.size) || 0)
const mime = computed(() => props.message?.content?.type || '')

const sizeLabel = computed(() => formatSize(size.value))

// 根据 mime 返回文件类型 key，用于模板里挑 SVG。
const fileType = computed(() => {
  const t = mime.value
  if (!t) return 'file'
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (t.includes('pdf')) return 'pdf'
  if (t.includes('zip') || t.includes('rar') || t.includes('tar')) return 'archive'
  if (t.includes('word') || t.includes('document')) return 'doc'
  if (t.includes('sheet') || t.includes('excel')) return 'sheet'
  if (t.includes('presentation') || t.includes('powerpoint')) return 'ppt'
  return 'file'
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
  <div
    :class="['jm-msg-file', incoming ? 'jm-msg-file--incoming' : 'jm-msg-file--outgoing']"
    :title="name"
    role="button"
    tabindex="0"
    @click="onClick"
    @keydown.enter.prevent="onClick"
  >
    <div class="jm-msg-file__icon" aria-hidden="true">
      <!-- PDF -->
      <svg v-if="fileType === 'pdf'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></svg>
      <!-- 图片 -->
      <svg v-else-if="fileType === 'image'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
      <!-- 视频 -->
      <svg v-else-if="fileType === 'video'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
      <!-- 音频 -->
      <svg v-else-if="fileType === 'audio'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <!-- 压缩包 -->
      <svg v-else-if="fileType === 'archive'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
      <!-- 文档/表格/PPT 通用 -->
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
    </div>
    <div class="jm-msg-file__info">
      <div class="jm-msg-file__name">{{ name }}</div>
      <div v-if="sizeLabel" class="jm-msg-file__meta">
        <span>{{ sizeLabel }}</span>
        <span v-if="mime"> · {{ mime }}</span>
      </div>
    </div>
    <button class="jm-msg-file__download" type="button" :title="'下载 ' + name" @click.stop="onClick">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </button>
  </div>
</template>

<style scoped>
/* 对齐 module-4.html 中 .msg .bubble .msg-file
   结构: icon(36) + info(name + meta) + download 按钮
   两套变体：
     - incoming (客户/收件人): 白底卡片 + 1px 边 + primary-soft 图标底
     - outgoing (客服/发件人): 透明 + 白字 + 半透明白图标底（hover 微亮） */
.jm-msg-file {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: 320px;
  padding: 10px;
  border: 0;
  border-radius: var(--r);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast);
  outline: none;
}

/* 客户/收件人 —— 白底 + 1px 边 + primary-soft 图标底 + hover 加深边 */
.jm-msg-file--incoming {
  background: #fff;
  border: 1px solid var(--border);
  color: var(--text-1);
}

.jm-msg-file--incoming:hover {
  border-color: var(--primary-soft);
  box-shadow: 0 2px 6px rgba(15, 23, 42, .04);
}

.jm-msg-file--incoming:focus-visible {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-glow);
}

.jm-msg-file--incoming .jm-msg-file__icon {
  background: var(--primary-soft);
  color: var(--primary);
}

.jm-msg-file--incoming .jm-msg-file__name {
  color: var(--text-1);
}

.jm-msg-file--incoming .jm-msg-file__meta {
  color: var(--text-3);
}

.jm-msg-file--incoming .jm-msg-file__download {
  color: var(--text-3);
}

.jm-msg-file--incoming .jm-msg-file__download:hover {
  background: var(--bg-mute);
  color: var(--primary);
}

/* 客服/发件人 —— 透明 + 白字 + 半透明白图标底 + hover 微亮 */
.jm-msg-file--outgoing {
  background: transparent;
  color: #fff;
}

/* .jm-msg-file--outgoing:hover {
  background: rgba(255, 255, 255, .06);
} */

.jm-msg-file--outgoing:focus-visible {
  background: rgba(255, 255, 255, .12);
}

.jm-msg-file--outgoing .jm-msg-file__icon {
  background: rgba(255, 255, 255, .22);
  color: #fff;
}

.jm-msg-file--outgoing .jm-msg-file__name {
  color: #fff;
}

.jm-msg-file--outgoing .jm-msg-file__meta {
  color: rgba(255, 255, 255, .78);
}

.jm-msg-file--outgoing .jm-msg-file__download {
  color: rgba(255, 255, 255, .85);
}

.jm-msg-file--outgoing .jm-msg-file__download:hover {
  background: rgba(255, 255, 255, .22);
  color: #fff;
}

.jm-msg-file__icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: background var(--t-fast), color var(--t-fast);
}

.jm-msg-file__icon svg {
  width: 18px;
  height: 18px;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.35;
}

.jm-msg-file__meta {
  font-size: 11px;
  line-height: 1.3;
}

.jm-msg-file__download {
  padding: 5px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
  flex-shrink: 0;
}

.jm-msg-file__download svg {
  width: 14px;
  height: 14px;
}
</style>
