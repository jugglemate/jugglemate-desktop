<script setup>
// Video bubble. Inline player with poster-less controls; the cover is the
// first frame. Click-to-play toggle keeps it lightweight — full-screen via
// the native video controls.

import { computed, ref } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const url = computed(() => {
  return (
    props.message?.content?.url ||
    props.message?.localUrl ||
    ''
  )
})
const width = computed(() => Number(props.message?.content?.width) || 0)
const height = computed(() => Number(props.message?.content?.height) || 0)

const isPlaying = ref(false)
const videoEl = ref(null)

const STYLE = computed(() => {
  if (width > 0 && height > 0) {
    const maxW = 320
    const maxH = 360
    const ratio = width / height
    let w = width
    let h = height
    if (w > maxW) {
      w = maxW
      h = Math.round(w / ratio)
    }
    if (h > maxH) {
      h = maxH
      w = Math.round(h * ratio)
    }
    return { width: `${w}px`, height: `${h}px` }
  }
  return { width: '240px', height: '180px' }
})

function togglePlay(e) {
  // Don't toggle when the user clicks the native control bar.
  if (e?.target?.controls || e?.target?.tagName === 'VIDEO') return
  if (!videoEl.value) return
  if (videoEl.value.paused) {
    videoEl.value.play()
    isPlaying.value = true
  } else {
    videoEl.value.pause()
    isPlaying.value = false
  }
}
</script>

<template>
  <div class="jm-msg-video" :style="STYLE" @click="togglePlay">
    <video
      v-if="url"
      ref="videoEl"
      class="jm-msg-video__el"
      :src="url"
      preload="metadata"
      playsinline
      controls
    ></video>
    <div v-else class="jm-msg-video__placeholder">视频加载失败</div>
    <div v-if="!isPlaying && url" class="jm-msg-video__play" aria-hidden="true">
      ▶
    </div>
  </div>
</template>

<style scoped>
.jm-msg-video {
  position: relative;
  border-radius: var(--r);
  overflow: hidden;
  background: black;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.jm-msg-video__el {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: black;
}

.jm-msg-video__placeholder {
  color: var(--text-3);
  font-size: 12px;
}

.jm-msg-video__play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.25);
  pointer-events: none;
  transition: opacity var(--t-fast);
}

.jm-msg-video:hover .jm-msg-video__play {
  opacity: 0.9;
}
</style>
