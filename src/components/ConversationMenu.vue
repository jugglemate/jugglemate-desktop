<script setup>
// Right-click context menu for a conversation row. The menu intentionally
// exposes only the compact operations currently needed:
//   - 标记未读              (juggle.markUnread)
//   - 删除会话              (juggle.removeConversation)
//
// The parent passes a single `conversation` (mapped shape from
// ConversationList). The menu emits `select` with the operation key and the
// conversation; the parent (MainView) calls the SDK and updates local state.
//
// Positioning: parent provides `x` / `y` (clientX / clientY) in viewport
// coordinates. The menu auto-flips when it would overflow the right or
// bottom edge.

import { computed } from 'vue'

const props = defineProps({
  conversation: {
    type: Object,
    default: null
  },
  // Pixel position in viewport coords. The parent should compute this from
  // the right-click event's clientX / clientY.
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

const items = computed(() => [
  {
    key: 'markUnread',
    icon: '✉️',
    label: '标记未读',
    danger: false
  },
  {
    key: 'remove',
    icon: '🗑️',
    label: '删除会话',
    danger: true
  }
])

const style = computed(() => {
  const MENU_WIDTH = 180
  const MENU_HEIGHT = 96
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
  if (item.divider) return
  emit('select', { key: item.key, conversation: props.conversation })
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="conversation"
      class="jm-conv-menu"
      :style="style"
      @click.stop
    >
      <ul class="jm-conv-menu__list">
        <li v-for="item in items" :key="item.key">
          <hr v-if="item.divider" class="jm-conv-menu__divider" />
          <button
            v-else
            class="jm-conv-menu__item"
            :class="{ 'jm-conv-menu__item--danger': item.danger }"
            type="button"
            @click="onSelect(item)"
          >
            <span class="jm-conv-menu__icon">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </button>
        </li>
      </ul>
    </div>
  </Teleport>
</template>

<style scoped>
.jm-conv-menu {
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  font-family: var(--font-sans);
  color: var(--text-primary);
  animation: jm-menuIn 120ms ease-out;
}

.jm-conv-menu__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.jm-conv-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  font-family: var(--font-sans);
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.jm-conv-menu__item:hover {
  background: var(--bg-hover);
}

.jm-conv-menu__item--danger {
  color: var(--danger);
}

.jm-conv-menu__item--danger:hover {
  background: oklch(0.22 0.08 20);
}

.jm-conv-menu__icon {
  width: 16px;
  text-align: center;
  font-size: 13px;
  flex-shrink: 0;
}

.jm-conv-menu__divider {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 4px 6px;
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
