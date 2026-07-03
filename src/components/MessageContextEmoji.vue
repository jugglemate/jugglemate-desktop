<script setup>
// Floating "quick reaction" pill that lives above the right-click menu.
//
// Replaces the older EmojiPicker flow: in the .fig-aligned design the
// emoji bar is *always* shown together with the menu (it's a sibling
// overlay, not a sub-menu) — so the user gets a one-click reaction
// without first having to click "表情回复".
//
// Position: parent provides clientX / clientY (the right-click point).
// The pill flips above the click when there isn't enough room below.
//
// The 8 default emojis mirror the Figma reference + module-4.html
// design. The trailing "···" button emits `more` so a later phase can
// pop a full palette without re-plumbing this component.

import { computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    default: null
  },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  align: {
    type: String,
    default: 'left',
    validator: (v) => v === 'left' || v === 'right'
  },
  emojis: {
    type: Array,
    default: () => ['👍', '👎', '😂', '👌', '❤️', '🧡', '💩', '🎉']
  }
})

const emit = defineEmits(['select', 'more', 'close'])

// Sizing — same numbers as module-4.html `.ctx-emoji` for parity. We
// pre-measure on mount and adjust if we overflow the viewport. 30px
// buttons + 6/10 padding + 2px gap × 8 + 1 trailing "more" button.
const PILL_W = 7 * 30 + 1 * 30 + 9 * 2 + 20
const PILL_H = 30 + 12

// The bar sits 12px above the menu's top edge, so the two overlays
// form a single visual block (emoji on top, menu below). The bar
// doesn't compute its own y — the parent passes `menuTop` so the
// bar and menu are always vertically aligned.
const GAP = 12

const style = computed(() => {
  const M = 8
  // Horizontal: dock the pill to the same edge as the menu so the
  // pair reads as one column. We use the same 8px dock offset as
  // MessageMenu so emoji + menu form a continuous block.
  //   align 'left'  -> left edge sits 8 to the RIGHT of click x
  //   align 'right' -> right edge sits 8 to the LEFT of click x
  const DOCK = 8
  let x
  if (props.align === 'left') {
    x = props.x + DOCK
  } else {
    x = props.x - DOCK - PILL_W
  }

  let y = props.y - DOCK - PILL_H


  if (typeof window !== 'undefined') {
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Horizontal clamp
    if (x < M) x = M
    if (x + PILL_W > vw - M) x = vw - PILL_W - M
    if (y + PILL_H > vh - M) y = vh - PILL_H - M
  }
  return { left: `${x}px`, top: `${y}px` }
})

function pick(emoji) {
  emit('select', { name: emoji, message: props.message })
  emit('close')
}

function onMore() {
  emit('more')
  // Don't auto-close — let the parent decide whether to swap in a
  // full picker or close the whole context menu.
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="message"
      class="jm-ctx-emoji"
      role="toolbar"
      aria-label="快速表情回应"
      :style="style"
      @click.stop
    >
      <button
        v-for="e in emojis"
        :key="e"
        type="button"
        class="jm-ctx-emoji__btn"
        :title="`添加 ${e}`"
        @click="pick(e)"
      >{{ e }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.jm-ctx-emoji {
  position: fixed;
  z-index: 1001;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  height: 42px;            /* 30 (button) + 6*2 (padding) — matches PILL_H */
  box-sizing: border-box;
  background: #FFFFFF;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, .10), 0 2px 4px rgba(15, 23, 42, .04);
  font-family: var(--font-sans);
  animation: jm-ctx-emoji-in 160ms cubic-bezier(.34, 1.56, .64, 1);
}

.jm-ctx-emoji__btn {
  width: 30px;
  height: 30px;
  min-width: 30px;
  min-height: 30px;
  border: 0;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 20px;
  display: grid;
  place-items: center;
  line-height: 1;
  padding: 0;
  transition: background 90ms ease, transform 120ms cubic-bezier(.34, 1.56, .64, 1);
}

.jm-ctx-emoji__btn:hover {
  background: #F1F5F9;
  transform: translateY(-2px) scale(1.15);
}

.jm-ctx-emoji__btn:active {
  transform: scale(.95);
}

.jm-ctx-emoji__more {
  width: 30px;
  height: 30px;
  min-width: 30px;
  min-height: 30px;
  border: 0;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-3);
  display: grid;
  place-items: center;
  transition: background 90ms ease, color 90ms ease;
}

.jm-ctx-emoji__more:hover {
  background: #F1F5F9;
  color: var(--text-1);
}

.jm-ctx-emoji__more svg {
  width: 14px;
  height: 14px;
}

@keyframes jm-ctx-emoji-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(.85);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
