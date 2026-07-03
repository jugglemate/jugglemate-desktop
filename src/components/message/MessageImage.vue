<script setup>
// Image bubble. Sizing follows the pattern in
// snailchat-web/src/common/common.js#calcSize: cap by the dominant axis,
// preserve aspect ratio, and reserve a `patch` of extra height for the
// time / sent-status row that lives inside the same bubble.
//
// The lightbox (P1-3) is provided by the parent. Click events forward
// up via the `preview` emit so the parent can show one shared overlay.

import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  // 消息方向：true=收件人, false=发件人 —— 决定背景色
  incoming: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['preview'])

// Prefer the uploaded `content.url` (OSS), fall back to the optimistic
// `localUrl` (blob URL) seeded by the sender while the upload is in flight.
const url = computed(() => {
  return (
    props.message?.content?.url ||
    props.message?.localUrl ||
    ''
  )
})

const fileName = computed(() => props.message?.content?.name || 'image')

// ---------------------------------------------------------------------------
// Sizing — see common.js#calcSize in snailchat-web. The dominant-axis rule
// + single ratio preserves the image's natural aspect ratio.
//
// We do NOT add the `patch` (extra height for the in-bubble time/status
// row that snailchat renders). In jugglemate-web the time/ticks row is
// rendered OUTSIDE the bubble (MessageBubble's `<div class="jm-msg__meta">`),
// so the 20px patch would be unused empty space at the bottom of every
// image, showing the bubble's `--bg-root` background as a dark bar.
// ---------------------------------------------------------------------------
const MAX_W = 240
const MAX_H = 240

const STYLE = computed(() => {
  const rawW = Number(props.message?.content?.width) || 0
  const rawH = Number(props.message?.content?.height) || 0
  if (!rawW || !rawH) {
    return { width: `${MAX_W}px`, height: `${Math.round(MAX_H * 0.66)}px` }
  }
  const isWidthDominant = rawW >= rawH
  let ratio = 1
  if (isWidthDominant && rawW > MAX_W) {
    ratio = MAX_W / rawW
  } else if (!isWidthDominant && rawH > MAX_H) {
    ratio = MAX_H / rawH
  }
  let w = Math.round(rawW * ratio)
  let h = Math.round(rawH * ratio)
  if (w < 60) w = 60
  if (h < 40) h = 40
  return { width: `${w}px`, height: `${h}px` }
})

function onClick() {
  emit('preview', { url: url.value })
}
</script>

<template>
  <div
    :class="['jm-msg-image', incoming ? 'jm-msg-image--incoming' : 'jm-msg-image--outgoing']"
    :style="STYLE"
    :title="fileName"
    @click="onClick"
  >
    <img v-if="url" :src="url" :alt="fileName" loading="lazy" draggable="false" />
    <div v-else class="jm-msg-image__placeholder">
      <span>图片加载失败</span>
    </div>
  </div>
</template>

<style scoped>
/* 对齐 module-4.html 中 .msg .bubble .msg-image —— 240×240 缩略图
   incoming: 浅底 + 8px padding 卡片感
   outgoing: 透明 + 无 padding，直接铺到气泡 */
.jm-msg-image {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  cursor: zoom-in;
  display: inline-block;
  line-height: 0;
}

.jm-msg-image--incoming {
  padding: 4px;
  background: var(--bg-soft);
}

.jm-msg-image--outgoing {
  padding: 0;
  background: transparent;
}

.jm-msg-image img {
  display: block;
  /* Fill the bubble exactly. `object-fit: contain` is a safety net for
     any sub-pixel mismatch between the reported `content.width/height`
     and the actual image data; the result is consistent with snailchat. */
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: var(--bg-soft);
  transition: transform var(--t);
}

.jm-msg-image:hover img {
  transform: scale(1.02);
}

.jm-msg-image__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 12px;
}
</style>
