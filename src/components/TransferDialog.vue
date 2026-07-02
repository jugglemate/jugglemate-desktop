<script setup>
// Transfer (forward) target picker. Shows the conversation list (other
// conversations, excluding the source), and on confirm emits a list of
// target conversations so the parent can call juggle.sendMergeMessage.
//
// The actual conversation data source is the parent's responsibility — this
// component just renders whatever it gets and emits the selection.

import { ref, computed, watch } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  // List of available conversations to forward to. Each item is the IM
  // conversation object (we read conversationId / conversationType / title).
  conversations: { type: Array, default: () => [] },
  // The conversation we're forwarding FROM. We exclude it from the list.
  source: { type: Object, default: null },
  // Title shown at the top of the dialog.
  title: { type: String, default: '选择转发的会话' }
})

const emit = defineEmits(['confirm', 'cancel'])

const keyword = ref('')
const selected = ref(new Set())

const filtered = computed(() => {
  const list = props.conversations || []
  return list.filter((c) => {
    if (props.source) {
      if (c.conversationId === props.source.conversationId &&
          c.conversationType === props.source.conversationType) {
        return false
      }
    }
    if (!keyword.value) return true
    const k = keyword.value.toLowerCase()
    return (c.conversationTitle || c.name || '').toLowerCase().includes(k)
  })
})

function toggle(c) {
  const key = `${c.conversationType}_${c.conversationId}`
  if (selected.value.has(key)) {
    selected.value.delete(key)
  } else {
    selected.value.add(key)
  }
  // Trigger reactivity for the Set
  selected.value = new Set(selected.value)
}

function isSelected(c) {
  return selected.value.has(`${c.conversationType}_${c.conversationId}`)
}

function onConfirm() {
  const targets = (props.conversations || []).filter(isSelected)
  emit('confirm', { conversations: targets })
}

watch(() => props.show, (val) => {
  if (!val) {
    selected.value = new Set()
    keyword.value = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="jm-transfer-mask" @click.self="emit('cancel')">
      <div class="jm-transfer-dialog">
        <div class="jm-transfer-dialog__header">
          <h3 class="jm-transfer-dialog__title">{{ title }}</h3>
          <button
            class="jm-transfer-dialog__close"
            type="button"
            aria-label="关闭"
            @click="emit('cancel')"
          >✕</button>
        </div>
        <div class="jm-transfer-dialog__search">
          <input
            v-model="keyword"
            class="jm-transfer-dialog__input"
            type="text"
            placeholder="搜索会话..."
          />
        </div>
        <div class="jm-transfer-dialog__list">
          <button
            v-for="c in filtered"
            :key="`${c.conversationType}_${c.conversationId}`"
            type="button"
            class="jm-transfer-dialog__item"
            :class="{ 'is-selected': isSelected(c) }"
            @click="toggle(c)"
          >
            <span
              class="jm-transfer-dialog__check"
              :class="isSelected(c) ? 'is-on' : ''"
              aria-hidden="true"
            >{{ isSelected(c) ? '✓' : '' }}</span>
            <div class="jm-transfer-dialog__info">
              <div class="jm-transfer-dialog__name">{{ c.conversationTitle || c.name }}</div>
              <div class="jm-transfer-dialog__hint">
                {{ c.conversationType === 2 ? '群聊' : '私聊' }}
              </div>
            </div>
          </button>
          <div v-if="!filtered.length" class="jm-transfer-dialog__empty">无匹配会话</div>
        </div>
        <div class="jm-transfer-dialog__footer">
          <button
            type="button"
            class="jm-btn jm-btn--outline"
            @click="emit('cancel')"
          >取消</button>
          <button
            type="button"
            class="jm-btn jm-btn--primary"
            :disabled="selected.size === 0"
            @click="onConfirm"
          >确定 ({{ selected.size }})</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.jm-transfer-mask {
  position: fixed;
  inset: 0;
  background: oklch(0.08 0.005 260 / 0.6);
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
}

.jm-transfer-dialog {
  width: 420px;
  max-width: 90vw;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(var(--bg));
  border: 1px solid var(--border);
  border-radius: var(--r);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.jm-transfer-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.jm-transfer-dialog__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}

.jm-transfer-dialog__close {
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
}

.jm-transfer-dialog__close:hover {
  color: var(--text-1);
}

.jm-transfer-dialog__search {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.jm-transfer-dialog__input {
  width: 100%;
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-sm);
  padding: 8px 10px;
  color: var(--text-1);
  font-size: 13px;
  font-family: var(--font-sans);
  outline: none;
}

.jm-transfer-dialog__input:focus {
  border-color: var(--primary-active);
}

.jm-transfer-dialog__list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.jm-transfer-dialog__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  color: var(--text-1);
  font-family: var(--font-sans);
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast);
}

.jm-transfer-dialog__item:hover,
.jm-transfer-dialog__item.is-selected {
  background: var(--primary-hover);
}

.jm-transfer-dialog__check {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--bg-soft);
  flex-shrink: 0;
}

.jm-transfer-dialog__check.is-on {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--bg-soft);
}

.jm-transfer-dialog__info {
  flex: 1;
  min-width: 0;
}

.jm-transfer-dialog__name {
  font-size: 13px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.jm-transfer-dialog__hint {
  font-size: 11px;
  color: var(--text-3);
}

.jm-transfer-dialog__empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

.jm-transfer-dialog__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--border-soft);
}

.jm-btn {
  padding: 6px 14px;
  border-radius: var(--r-sm);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--t-fast);
}

.jm-btn--outline {
  background: transparent;
  border-color: var(--border);
  color: var(--text-2);
}

.jm-btn--outline:hover {
  background: var(--primary-hover);
  color: var(--text-1);
}

.jm-btn--primary {
  background: var(--primary);
  color: var(--bg-soft);
}

.jm-btn--primary:hover:not(:disabled) {
  background: oklch(0.72 0.18 250);
}

.jm-btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
