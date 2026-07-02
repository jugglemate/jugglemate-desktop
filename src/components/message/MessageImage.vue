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
const MAX_W = 270
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
    class="jm-msg-image"
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
.jm-msg-image {
  position: relative;
  border-radius: var(--r);
  overflow: hidden;
  cursor: zoom-in;
  background: var(var(--bg));
  /* The img's intrinsic aspect ratio drives the box. We use
     `inline-block` + `line-height: 0` so the container shrinks to fit
     and the bottom of the <img> sits flush with the container. */
  display: inline-block;
  line-height: 0;
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
