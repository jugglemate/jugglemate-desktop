<script setup>
// Video bubble with a custom full-size play/pause overlay and remaining time.

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
const remainingSeconds = ref(0)

const remainingTime = computed(() => {
  const seconds = Math.max(0, remainingSeconds.value)
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
})

const STYLE = computed(() => {
  if (width.value > 0 && height.value > 0) {
    const maxW = 320
    const maxH = 360
    const ratio = width.value / height.value
    let w = width.value
    let h = height.value
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

function updateRemainingTime() {
  if (!videoEl.value || !Number.isFinite(videoEl.value.duration)) return
  remainingSeconds.value = Math.max(
    0,
    Math.ceil(videoEl.value.duration - videoEl.value.currentTime)
  )
}

async function togglePlay() {
  if (!videoEl.value) return
  if (videoEl.value.paused) {
    try {
      await videoEl.value.play()
    } catch {
      isPlaying.value = false
    }
  } else {
    videoEl.value.pause()
  }
}
</script>

<template>
  <div class="jm-msg-video" :style="STYLE">
    <video
      v-if="url"
      ref="videoEl"
      class="jm-msg-video__el"
      :src="url"
      preload="metadata"
      playsinline
      @loadedmetadata="updateRemainingTime"
      @durationchange="updateRemainingTime"
      @timeupdate="updateRemainingTime"
      @play="isPlaying = true"
      @pause="isPlaying = false"
      @ended="isPlaying = false; updateRemainingTime()"
    ></video>
    <div v-else class="jm-msg-video__placeholder">视频加载失败</div>
    <button
      v-if="url"
      class="jm-msg-video__overlay"
      :class="{ 'jm-msg-video__overlay--playing': isPlaying }"
      type="button"
      :aria-label="isPlaying ? '暂停视频' : '播放视频'"
      @click="togglePlay"
    >
      <span v-if="!isPlaying" class="jm-msg-video__play" aria-hidden="true">▶</span>
      <span class="jm-msg-video__duration">{{ remainingTime }}</span>
    </button>
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

.jm-msg-video__overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  background: rgba(0, 0, 0, 0.25);
  cursor: pointer;
  transition: background var(--t-fast);
}

.jm-msg-video__overlay--playing {
  background: transparent;
}

.jm-msg-video__overlay:focus-visible {
  outline: 2px solid white;
  outline-offset: -3px;
}

.jm-msg-video__play {
  display: flex;
  width: 52px;
  height: 52px;
  align-items: center;
  justify-content: center;
  padding-left: 4px;
  border-radius: 50%;
  font-size: 28px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.95);
  background: rgba(0, 0, 0, 0.45);
}

.jm-msg-video__duration {
  position: absolute;
  left: 10px;
  bottom: 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: white;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}
</style>
