<script setup>
// Right-click context menu for a single message. Emits the operation key;
// the parent (ChatMain) wires it up to the SDK.
//
// Operations surfaced in P3:
//   - copy         (text messages only)
//   - reaction     (open emoji picker sub-menu; parent handles)
//   - transfer     (forward to another conversation)
//   - recall       (sender-only, within the SDK's recall window)
//   - remove       (delete)
//
// Position: parent provides clientX / clientY. We auto-flip on edge overflow.

import { computed } from 'vue'
import im from '../common/im'

const props = defineProps({
  message: {
    type: Object,
    default: null
  },
  x: {
    type: Number,
    default: 0
  },
  y: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['select', 'close'])

const { MessageType, SentState } = im

// Show "copy" only for text/stream-text. Show "recall" only for sender's
// own messages with a sentState === SUCCESS.
const isText = computed(() => {
  const name = props.message?.name
  return name === MessageType.TEXT || name === MessageType.STREAM_TEXT
})

const canRecall = computed(() => {
  const m = props.message
  if (!m?.isSender) return false
  if (m.sentState && m.sentState !== SentState.SUCCESS) return false
  return isText.value || m.name === MessageType.IMAGE
})

const items = computed(() => {
  const out = []
  if (isText.value) out.push({ key: 'copy', icon: '📋', label: '复制' })
  out.push({ key: 'reaction', icon: '😊', label: '表情回复' })
  out.push({ key: 'transfer', icon: '➡️', label: '转发' })
  if (canRecall.value) {
    out.push({ key: 'recall', icon: '↶', label: '撤回', danger: false })
  }
  out.push({ key: 'remove', icon: '🗑️', label: '删除', danger: true })
  return out
})

const style = computed(() => {
  const MENU_WIDTH = 180
  const MENU_HEIGHT = items.value.length * 36 + 16
  const MARGIN = 8
  let x = props.x
  let y = props.y
  if (typeof window !== 'undefined') {
    if (x + MENU_WIDTH > window.innerWidth) {
      x = window.innerWidth - MENU_WIDTH - MARGIN
    }
    if (y + MENU_HEIGHT > window.innerHeight) {
      y = Math.max(MARGIN, y - MENU_HEIGHT)
    }
  }
  return { left: `${x}px`, top: `${y}px` }
})

function onSelect(item) {
  emit('select', { key: item.key, message: props.message })
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="message"
      class="jm-msg-menu"
      :style="style"
      @click.stop
    >
      <ul class="jm-msg-menu__list">
        <li v-for="item in items" :key="item.key">
          <button
            class="jm-msg-menu__item"
            :class="{ 'jm-msg-menu__item--danger': item.danger }"
            type="button"
            @click="onSelect(item)"
          >
            <span class="jm-msg-menu__icon">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </button>
        </li>
      </ul>
    </div>
  </Teleport>
</template>

<style scoped>
.jm-msg-menu {
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  background: var(var(--bg));
  border: 1px solid var(--border);
  border-radius: var(--r);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  font-family: var(--font-sans);
  color: var(--text-1);
  animation: jm-menuIn 120ms ease-out;
}

.jm-msg-menu__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.jm-msg-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: var(--text-1);
  font-size: 13px;
  font-family: var(--font-sans);
  text-align: left;
  cursor: pointer;
  border-radius: var(--r-sm);
  transition: background var(--t-fast);
}

.jm-msg-menu__item:hover {
  background: var(--primary-hover);
}

.jm-msg-menu__item--danger {
  color: var(--danger);
}

.jm-msg-menu__item--danger:hover {
  background: oklch(0.22 0.08 20);
}

.jm-msg-menu__icon {
  width: 16px;
  text-align: center;
  font-size: 13px;
  flex-shrink: 0;
}

@keyframes jm-menuIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
