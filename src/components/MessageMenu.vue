<script setup>
// Right-click context menu for a single message.
//
// The menu is split into three logical groups (separated by a thin divider):
//   1) Copy (text messages only)
//   2) Reply / Forward
//   3) Recall (own messages only, send success) / Delete (always)
//
// "Recall" is intentionally gated to messages the user sent themselves:
// the IM SDK only permits the original sender to recall a message, so
// surfacing the action on incoming messages would be a dead button.
//
// Position: parent provides clientX / clientY. We auto-clamp on edge
// overflow. Esc / click-outside close is handled by the parent (ChatMain)
// via the `close` event; we expose a `onOutsideClick` guard via a global
// `pointerdown` listener that the parent subscribes to.

import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import im from '../common/im'

const props = defineProps({
  message: {
    type: Object,
    default: null
  },
  // Right-click x in viewport pixels.
  x: { type: Number, default: 0 },
  // Right-click y in viewport pixels — menu's top edge starts here
  // unless we have to flip it to stay in the viewport.
  y: { type: Number, default: 0 },
  // Horizontal alignment edge shared with the companion emoji bar.
  // 'left' = right edge of menu touches the click x (menu extends
  //          to the LEFT). 'right' = left edge touches x (extends
  //          to the RIGHT). The parent picks this so the menu and
  //          the emoji bar share the same column.
  align: {
    type: String,
    default: 'left',
    validator: (v) => v === 'left' || v === 'right'
  }
})

const emit = defineEmits(['select', 'close'])

const { MessageType, SentState } = im

// "Copy" only makes sense for text payloads (text/stream-text). We mirror
// the React snailchat behavior here.
const isText = computed(() => {
  const name = props.message?.name
  return name === MessageType.TEXT || name === MessageType.STREAM_TEXT
})

// Recall is sender-only AND only on messages that successfully reached
// the server. We don't limit by name: the SDK allows recalling any
// outbound message (text, image, file, video, voice, merge, contact
// card). `sentState` guard prevents a confusing UX where the user
// tries to recall an in-flight or failed message.
const canRecall = computed(() => {
  const m = props.message
  if (!m) return false
  if (!m.isSender) return false
  // If we don't have a sentState at all, assume success (older
  // messages or demo data). Otherwise require SUCCESS.
  if (m.sentState && m.sentState !== SentState.SUCCESS) return false
  // Recall window is typically 2 minutes. If the SDK has flagged the
  // message as past-recall-window, respect that signal if present.
  if (m.isRecallable === false) return false
  return true
})

// Group definitions. Each group renders with an optional top divider
// (so the second/third groups separate from the first). The `show`
// predicate controls whether the group renders at all.
const groups = computed(() => {
  const g = []
  // Group 1: copy
  if (isText.value) {
    g.push({
      key: 'g-copy',
      items: [{ key: 'copy', label: '复制消息' }]
    })
  }
  // Group 2: reply / forward
  g.push({
    key: 'g-ops',
    items: [
      { key: 'reply', label: '消息回复'},
      { key: 'transfer', label: '消息转发' }
    ]
  })
  // Group 3: recall (own only) + delete
  const g3 = []
  if (canRecall.value) {
    g3.push({ key: 'recall', label: '消息撤回' })
  }
  g3.push({ key: 'remove', label: '消息删除', danger: true })
  g.push({ key: 'g-danger', items: g3 })
  return g
})

// Flat list of selectable items, keyed by group, for keyboard navigation
// in case we add it later. Not currently used by the template but kept
// for future hot-key wiring.
const allItems = computed(() =>
  groups.value.flatMap((g) => g.items.map((it) => ({ ...it, group: g.key })))
)

// Reserve space ABOVE the menu for the companion emoji bar (PILL_H
// from MessageContextEmoji + GAP). We also flip the menu's vertical
// position when the WHOLE composite (emoji pill + gap + menu) would
// otherwise fall off the bottom of the viewport.
const EMOJI_PILL_H = 30 + 12 // matches MessageContextEmoji's PILL_H
const EMOJI_GAP = 12

// `flipped` is true when we moved the menu's top edge ABOVE the
// click point (i.e. the menu ran out of room below the click and
// had to grow upward). The companion MessageContextEmoji reads this
// via the parent's exposed `messageMenuRef.flipped` so the pill can
// dock to the OPPOSITE side of the menu and stay visible.
const flippedRef = ref(false)

const style = computed(() => {
  // Rough sizing — we measure after mount in onMounted for accuracy but
  // a static estimate is good enough to keep the menu inside the
  // viewport on first paint.
  const MENU_WIDTH = 200
  const ITEM_HEIGHT = 36
  const GROUP_PAD = 8
  const DIVIDER = 9
  const itemCount = allItems.value.length
  const groupCount = groups.value.length
  const MENU_HEIGHT =
    itemCount * ITEM_HEIGHT +
    (groupCount - 1) * DIVIDER +
    GROUP_PAD * 2
  const MARGIN = 8
  // Horizontal: dock the menu to one edge of the click point.
  //   align 'left'  -> left edge sits GAP to the RIGHT of click x
  //   align 'right' -> right edge sits GAP to the LEFT of click x
  // The 8px gap stops the panel from sitting exactly under the
  // cursor (which feels like a "pop under the cursor").
  const GAP_FROM_CLICK = 8
  let x
  if (props.align === 'left') {
    x = props.x + GAP_FROM_CLICK
  } else {
    x = props.x - GAP_FROM_CLICK - MENU_WIDTH
  }
  let y = props.y
  if (typeof window !== 'undefined') {
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Make sure the WHOLE composite (emoji bar + gap + menu) fits.
    // The bar lives ABOVE the menu, so we need at least
    // EMOJI_PILL_H + EMOJI_GAP + MENU_HEIGHT of vertical space when
    // the menu is at the top; otherwise flip below.
    const totalAbove = EMOJI_PILL_H + EMOJI_GAP + MENU_HEIGHT
    if (y + totalAbove > vh) {
      // Flip: menu's bottom edge sits GAP above the click instead.
      y = Math.max(MARGIN, props.y - MENU_HEIGHT - GAP_FROM_CLICK)
    }
    if (x < MARGIN) x = MARGIN
    if (x + MENU_WIDTH > vw - MARGIN) x = vw - MENU_WIDTH - MARGIN
    if (y < MARGIN) y = MARGIN
  }
  // The companion MessageContextEmoji reads our top via the parent
  // (ChatMain) calling getBoundingClientRect() on the exposed rootEl.
  flippedRef.value = y < props.y - 4
  return { left: `${x}px`, top: `${y}px` }
})

function onSelect(item) {
  emit('select', { key: item.key, message: props.message })
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

// Global Esc handler — the parent may not always capture the keystroke
// while a sub-emoji-popup has focus, so we listen at the document level
// and self-clean on unmount.
onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
})
// Expose the root element + the flipped flag so the parent (ChatMain)
// can read the resolved position via getBoundingClientRect and pass
// the menu's top edge to the companion MessageContextEmoji overlay.
const rootEl = ref(null)
defineExpose({ rootEl, flipped: flippedRef })

</script>

<template>
  <Teleport to="body">
    <div
      v-if="message"
      ref="rootEl"
      class="jm-msg-menu"
      role="menu"
      aria-label="消息操作"
      :style="style"
      @click.stop
    >
      <template v-for="(group, gi) in groups" :key="group.key">
        <div v-if="gi > 0" class="jm-msg-menu__divider" role="separator"></div>
        <ul class="jm-msg-menu__list">
          <li v-for="item in group.items" :key="item.key">
            <button
              class="jm-msg-menu__item"
              :class="{ 'jm-msg-menu__item--danger': item.danger }"
              type="button"
              role="menuitem"
              @click="onSelect(item)"
            >
              <!-- Icons are inline SVG so they look consistent across
                   platforms (vs emoji which renders unevenly). -->
              <svg
                v-if="item.key === 'copy'"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
              ><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <svg
                v-else-if="item.key === 'reply'"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
              ><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
              <svg
                v-else-if="item.key === 'transfer'"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
              ><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              <svg
                v-else-if="item.key === 'recall'"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
              ><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              <svg
                v-else-if="item.key === 'remove'"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
              ><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span class="jm-msg-menu__label">{{ item.label }}</span>
              <span v-if="item.kbd" class="jm-msg-menu__kbd">{{ item.kbd }}</span>
            </button>
          </li>
        </ul>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.jm-msg-menu {
  position: fixed;
  z-index: 1000;
  min-width: 200px;
  max-width: 240px;
  padding: 6px;
  background: #FFFFFF;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .10), 0 2px 6px rgba(15, 23, 42, .04);
  font-family: var(--font-sans);
  color: var(--text-1);
  animation: jm-menuIn 140ms ease-out;
}

.jm-msg-menu__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.jm-msg-menu__divider {
  height: 1px;
  margin: 4px 8px;
  background: #EEF2F7;
}

.jm-msg-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: 0;
  color: var(--text-1);
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
  line-height: 1;
  user-select: none;
  transition: background 90ms ease, color 90ms ease;
}

.jm-msg-menu__item:hover,
.jm-msg-menu__item:focus-visible {
  outline: none;
  background: #F2F8FF;
  color: #006FE6;
}

.jm-msg-menu__item svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--text-2);
  transition: color 90ms ease;
}

.jm-msg-menu__item:hover svg,
.jm-msg-menu__item:focus-visible svg {
  color: #006FE6;
}

.jm-msg-menu__item--danger {
  color: #EF4444;
}

.jm-msg-menu__item--danger svg {
  color: #EF4444;
}

.jm-msg-menu__item--danger:hover,
.jm-msg-menu__item--danger:focus-visible {
  background: #FEF2F2;
  color: #DC2626;
}

.jm-msg-menu__item--danger:hover svg,
.jm-msg-menu__item--danger:focus-visible svg {
  color: #DC2626;
}

.jm-msg-menu__label {
  flex: 1;
  min-width: 0;
}

.jm-msg-menu__kbd {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

.jm-msg-menu__item:hover .jm-msg-menu__kbd,
.jm-msg-menu__item:focus-visible .jm-msg-menu__kbd {
  color: inherit;
  opacity: .7;
}

@keyframes jm-menuIn {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
