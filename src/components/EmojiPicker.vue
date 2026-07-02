<script setup>
// Quick emoji picker for the message reaction flow. Renders a small panel
// with a few common emojis; clicking one emits `select`. Positioned by the
// parent (typically near the message menu).

import { computed } from 'vue'

const props = defineProps({
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 }
})

const emit = defineEmits(['select', 'close'])

// A small but expressive default set. Larger palettes live in a later phase.
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👏']

const style = computed(() => {
  const W = 280
  const H = 44
  const M = 8
  let x = props.x
  let y = props.y
  if (typeof window !== 'undefined') {
    if (x + W > window.innerWidth) x = window.innerWidth - W - M
    if (y + H > window.innerHeight) y = Math.max(M, y - H)
  }
  return { left: `${x}px`, top: `${y}px` }
})

function pick(emoji) {
  emit('select', { name: emoji })
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="jm-emoji-picker" :style="style" @click.stop>
      <button
        v-for="e in EMOJIS"
        :key="e"
        type="button"
        class="jm-emoji-picker__btn"
        @click="pick(e)"
      >
        {{ e }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.jm-emoji-picker {
  position: fixed;
  z-index: 1001;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(var(--bg));
  border: 1px solid var(--border);
  border-radius: var(--r);
  box-shadow: var(--shadow-lg);
  animation: jm-emojiIn 120ms ease-out;
}

.jm-emoji-picker__btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background var(--t-fast);
}

.jm-emoji-picker__btn:hover {
  background: var(--primary-hover);
}

@keyframes jm-emojiIn {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
</style>
