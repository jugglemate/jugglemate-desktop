<script setup>
// Voice message. Renders a horizontal pill with a play/pause icon and the
// duration. We don't decode the audio inline — just use an HTML <audio>
// element and toggle play/pause.

import { computed, ref } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const url = computed(() => props.message?.content?.url || '')
// SDK stores duration in milliseconds. We render a friendly "0:00" label.
const duration = computed(() => {
  const ms = Number(props.message?.content?.duration) || 0
  if (!ms) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
})

const isPlaying = ref(false)
const audioEl = ref(null)

function toggle() {
  const el = audioEl.value
  if (!el) return
  if (el.paused) {
    el.play()
    isPlaying.value = true
  } else {
    el.pause()
    isPlaying.value = false
  }
}

function onEnded() {
  isPlaying.value = false
}
</script>

<template>
  <button
    class="jm-msg-voice"
    type="button"
    @click="toggle"
  >
    <span class="jm-msg-voice__icon" :class="{ 'is-playing': isPlaying }">▶</span>
    <span class="jm-msg-voice__waveform" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span>
      <span></span><span></span><span></span>
    </span>
    <span v-if="duration" class="jm-msg-voice__duration">{{ duration }}</span>
    <audio
      v-if="url"
      ref="audioEl"
      :src="url"
      preload="metadata"
      @ended="onEnded"
    ></audio>
  </button>
</template>

<style scoped>
.jm-msg-voice {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  cursor: pointer;
  font-family: var(--font-sans);
  color: var(--text-1);
  transition: all var(--t-fast);
  min-width: 140px;
}

.jm-msg-voice:hover {
  background: var(--primary-hover);
  border-color: var(--primary-active);
}

.jm-msg-voice__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--primary);
  color: var(--bg-soft);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.jm-msg-voice__icon.is-playing {
  background: var(--danger);
}

.jm-msg-voice__waveform {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
}

.jm-msg-voice__waveform span {
  display: block;
  width: 2px;
  background: var(--text-2);
  border-radius: 1px;
  animation: jm-wave 1.2s ease-in-out infinite;
}

.jm-msg-voice__waveform span:nth-child(1) { height: 6px; animation-delay: 0s; }
.jm-msg-voice__waveform span:nth-child(2) { height: 12px; animation-delay: 0.1s; }
.jm-msg-voice__waveform span:nth-child(3) { height: 8px; animation-delay: 0.2s; }
.jm-msg-voice__waveform span:nth-child(4) { height: 16px; animation-delay: 0.3s; }
.jm-msg-voice__waveform span:nth-child(5) { height: 10px; animation-delay: 0.4s; }
.jm-msg-voice__waveform span:nth-child(6) { height: 14px; animation-delay: 0.5s; }
.jm-msg-voice__waveform span:nth-child(7) { height: 6px; animation-delay: 0.6s; }
.jm-msg-voice__waveform span:nth-child(8) { height: 12px; animation-delay: 0.7s; }

.jm-msg-voice:not(:hover) .jm-msg-voice__waveform span {
  animation: none;
}

.jm-msg-voice__duration {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

@keyframes jm-wave {
  0%, 100% { transform: scaleY(0.5); }
  50% { transform: scaleY(1); }
}
</style>
