<script setup>
import { ref, computed } from 'vue'

/**
 * ChatHeadTools — ChatMain 顶栏右段的工具区
 * 决策 4.9.1~4.9.8 推荐全 a
 * 4.9.1 搜索框 bg-mute，focus primary
 * 4.9.2 5 个工具按钮：刷新 / 置顶 / 静音 / 转接 / 更多
 * 4.9.3 工具按钮 icon 保留现有 emoji（决策 11）
 * 4.9.4 tooltip 用原生 title 属性
 * 4.9.5 agent-mode 三态 human / assist / auto 循环切换
 * 4.9.6 agent-mode 默认值 human
 * 4.9.7 agent-mode emit mode-change 给 ChatMain
 */
const props = defineProps({
  mode: {
    type: String,
    default: 'human' // human | assist | auto
  }
})

const emit = defineEmits(['tool-action', 'mode-change', 'focus-search'])

const searchInput = ref(null)

defineExpose({
  focus() {
    if (searchInput.value) {
      searchInput.value.focus()
    }
  }
})

// 5 个工具按钮（决策 4.9.3 = a 保留 emoji，决策 11）
const toolButtons = [
  { key: 'refresh',  emoji: '🔄', title: '刷新' },
  { key: 'pin',      emoji: '📌', title: '置顶' },
  { key: 'mute',     emoji: '🔕', title: '静音' },
  { key: 'transfer', emoji: '↗️', title: '转接' },
  { key: 'more',     emoji: '⋯',  title: '更多' }
]

function handleToolClick(key) {
  emit('tool-action', key)
}

function handleModeClick() {
  // human → assist → auto → human 循环
  const next = props.mode === 'human' ? 'assist'
            : props.mode === 'assist' ? 'auto'
            : 'human'
  emit('mode-change', next)
}

const modeDisplay = computed(() => {
  if (props.mode === 'human')  return { label: '人工', color: 'var(--text-2)' }
  if (props.mode === 'assist') return { label: '辅助', color: 'var(--primary)' }
  if (props.mode === 'auto')   return { label: '托管', color: 'var(--warning)' }
  return { label: '人工', color: 'var(--text-2)' }
})
</script>

<template>
  <div class="chat-head-tools">
    <!-- 搜索框（决策 4.9.1 a） -->
    <div class="chat-head-tools__search">
      <input
        ref="searchInput"
        type="text"
        class="chat-head-tools__search-input"
        placeholder="搜索消息…"
        @focus="emit('focus-search')"
      />
      <span class="chat-head-tools__search-icon" aria-hidden="true">🔍</span>
    </div>

    <!-- 5 个工具按钮（决策 4.9.2/3/4 a） -->
    <button
      v-for="t in toolButtons"
      :key="t.key"
      class="chat-head-tools__btn"
      :title="t.title"
      :aria-label="t.title"
      @click="handleToolClick(t.key)"
    >
      <span class="chat-head-tools__btn-emoji">{{ t.emoji }}</span>
    </button>

    <!-- agent-mode 三态（决策 4.9.5/6/7 a） -->
    <button
      class="chat-head-tools__mode"
      :class="`chat-head-tools__mode--${mode}`"
      :style="{ color: modeDisplay.color }"
      :title="`模式: ${modeDisplay.label}（点击切换）`"
      @click="handleModeClick"
    >
      <span class="chat-head-tools__mode-dot" :style="{ background: modeDisplay.color }"></span>
      <span class="chat-head-tools__mode-label">{{ modeDisplay.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.chat-head-tools {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 搜索框：bg-mute 背景，focus 走 primary（决策 4.9.1 a） */
.chat-head-tools__search {
  position: relative;
  margin-right: 6px;
}

.chat-head-tools__search-input {
  width: 180px;
  height: 28px;
  padding: 0 28px 0 10px;
  border: 1px solid transparent;
  border-radius: var(--r);
  background: var(--bg-mute);
  color: var(--text-1);
  font-size: 12px;
  transition: border-color var(--t-fast), background var(--t-fast);
}

.chat-head-tools__search-input::placeholder {
  color: var(--text-3);
}

.chat-head-tools__search-input:focus {
  border-color: var(--primary);
  background: var(--bg);
  outline: none;
}

.chat-head-tools__search-icon {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  pointer-events: none;
  opacity: 0.6;
}

/* 工具按钮：emoji icon（决策 4.9.3 a） */
.chat-head-tools__btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--text-2);
  border-radius: var(--r);
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.chat-head-tools__btn:hover {
  background: var(--bg-mute);
  color: var(--text-1);
}

.chat-head-tools__btn-emoji {
  font-size: 14px;
  line-height: 1;
}

/* agent-mode 三态：human/assist/auto 不同色 */
.chat-head-tools__mode {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: var(--r);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  margin-left: 4px;
  transition: background var(--t-fast), border-color var(--t-fast);
}

.chat-head-tools__mode:hover {
  background: var(--bg-mute);
}

.chat-head-tools__mode-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 三态：human 默认 / assist primary 脉冲 / auto warning 脉冲 */
.chat-head-tools__mode--assist {
  background: var(--primary-soft);
  border-color: var(--primary-glow);
}

.chat-head-tools__mode--assist .chat-head-tools__mode-dot {
  animation: chat-head-tools-pulse 1.6s infinite;
}

.chat-head-tools__mode--auto {
  background: var(--warning-soft);
  border-color: var(--warning);
}

.chat-head-tools__mode--auto .chat-head-tools__mode-dot {
  animation: chat-head-tools-pulse 1.6s infinite;
}

@keyframes chat-head-tools-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.4); }
}
</style>
