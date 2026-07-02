<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  agents: {
    type: Array,
    default: () => []
  },
  selectedAgentId: {
    type: [String, Number],
    default: null
  },
  mode: {
    type: String,
    default: 'collaborative'
  },
  hostedAgentId: {
    type: [String, Number],
    default: null
  }
})

const emit = defineEmits([
  'select-agent',
  'update:mode',
  'toggle-host'
])

const dropdownOpen = ref(false)
const dropdownRef = ref(null)

const selectedAgent = computed(() =>
  props.agents.find(a => a.id === props.selectedAgentId) || null
)

const displayLabel = computed(() =>
  selectedAgent.value ? selectedAgent.value.name : '不使用'
)

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
}

function selectOption(agentOrNull) {
  dropdownOpen.value = false
  if (agentOrNull === null) {
    emit('select-agent', null)
  } else {
    emit('select-agent', agentOrNull.id)
  }
}

function switchMode(mode) {
  emit('update:mode', mode)
}

function onClickOutside(e) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target)) {
    dropdownOpen.value = false
  }
}

onMounted(() => { document.addEventListener('click', onClickOutside) })
onUnmounted(() => { document.removeEventListener('click', onClickOutside) })
</script>

<template>
  <aside class="agent-panel">
    <!-- 标题 -->
    <!-- <div class="agent-panel__header">
      <div class="agent-panel__header-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
          <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5 20c0-4 3.1-7 7-7s7 3 7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <rect x="13" y="2" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/>
          <path d="M16 4v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          <circle cx="8" cy="13" r="1" fill="currentColor"/>
          <circle cx="12" cy="13" r="1" fill="currentColor"/>
        </svg>
      </div>
      <span class="agent-panel__header-title">智能 Agent 列表</span>
    </div> -->

    <!-- 下拉选择器 -->
    <div class="agent-panel__field" ref="dropdownRef">
      <label class="agent-panel__label">当前使用Agent</label>
      <button
        type="button"
        class="agent-panel__trigger"
        :class="{ 'is-open': dropdownOpen }"
        @click="toggleDropdown"
      >
        <span>{{ displayLabel }}</span>
        <svg class="agent-panel__chevron" :class="{ 'is-open': dropdownOpen }" viewBox="0 0 16 16" width="16" height="16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div v-if="dropdownOpen" class="agent-panel__dropdown">
        <div
          class="agent-panel__dropdown-option"
          :class="{ 'is-active': !selectedAgentId }"
          @click="selectOption(null)"
        >
          <span>不使用</span>
          <svg v-if="!selectedAgentId" class="agent-panel__dropdown-check" viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="agent-panel__dropdown-divider" />
        <div
          v-for="agent in agents"
          :key="agent.id"
          class="agent-panel__dropdown-option"
          :class="{ 'is-active': agent.id === selectedAgentId }"
          @click="selectOption(agent)"
        >
          <span class="agent-panel__dropdown-avatar">{{ agent.name?.charAt(0) || 'A' }}</span>
          <span>{{ agent.name }}</span>
          <svg v-if="agent.id === selectedAgentId" class="agent-panel__dropdown-check" viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div v-if="agents.length === 0" class="agent-panel__dropdown-empty">暂无 Agent</div>
      </div>
    </div>

    <!-- AI辅助模式：仅选中 agent 后展示 -->
    <template v-if="selectedAgentId">
      <div class="agent-panel__divider" />
      <div class="agent-panel__mode">
        <div class="agent-panel__mode-title">AI辅助模式</div>

        <!-- 协同模式卡片 -->
        <div
          class="agent-panel__mode-card"
          :class="{ 'is-active': mode === 'collaborative' }"
          @click="switchMode('collaborative')"
        >
          <div class="agent-panel__mode-card-icon collaborative">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <path d="M7 10l2 2 4-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </div>
          <div class="agent-panel__mode-card-text">
            <div class="agent-panel__mode-card-name">协同模式</div>
            <div class="agent-panel__mode-card-desc">AI提供建议，人工决策</div>
          </div>
        </div>

        <!-- 托管模式卡片 -->
        <div
          class="agent-panel__mode-card"
          :class="{ 'is-active': mode === 'managed' }"
          @click="switchMode('managed')"
        >
          <div class="agent-panel__mode-card-icon managed">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="1.5"/>
              <path d="M10 7.5v3l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="agent-panel__mode-card-text">
            <div class="agent-panel__mode-card-name">托管模式</div>
            <div class="agent-panel__mode-card-desc">AI自动处理常规问题</div>
          </div>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.agent-panel {
  width: 288px;
  min-width: 288px;
  height: calc(100vh - 20px);
  margin: 10px 10px 10px 0;
  background: #FFFFFF;
  border-radius: var(--r);
  display: flex;
  flex-direction: column;
  overflow: visible;
  padding: 24px 20px;
  box-sizing: border-box;
}

/* ---- 标题 ---- */
.agent-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
}

.agent-panel__header-icon {
  color: #4A90E2;
  display: flex;
  align-items: center;
}

.agent-panel__header-title {
  font-size: 16px;
  font-weight: 600;
  color: #1A202C;
}

/* ---- 下拉字段 ---- */
.agent-panel__field {
  position: relative;
}

.agent-panel__label {
  display: block;
  margin-bottom: 8px;
  line-height: 1;
  font-size: 14px;
  font-weight: 600;
  color: #333333;
}

.agent-panel__trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px 0 14px;
  background: #FFFFFF;
  border: 1px solid #E4E7EB;
  border-radius: 6px;
  font-size: 14px;
  color: #1A202C;
  cursor: pointer;
  transition: border-color 150ms ease;
  font-family: inherit;
}

.agent-panel__trigger:hover {
  border-color: #CBD0D8;
}

.agent-panel__trigger.is-open {
  border-color: #4A90E2;
  box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.12);
}

.agent-panel__chevron {
  color: #B0B8C1;
  flex-shrink: 0;
  transition: transform 180ms ease;
}

.agent-panel__chevron.is-open {
  transform: rotate(180deg);
  color: #4A90E2;
}

/* ---- 下拉菜单 ---- */
.agent-panel__dropdown {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  background: #FFFFFF;
  border: 1px solid #E4E7EB;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04);
  padding: 6px;
  z-index: 100;
  max-height: 260px;
  overflow-y: auto;
}

.agent-panel__dropdown-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 14px;
  color: #333333;
  transition: background 120ms ease;
}

.agent-panel__dropdown-option:hover {
  background: #F6F8FB;
}

.agent-panel__dropdown-option.is-active {
  background: #EEF4FD;
  color: #1A202C;
}

.agent-panel__dropdown-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #B3D9F7;
  color: #FFFFFF;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.agent-panel__dropdown-check {
  color: #4A90E2;
  flex-shrink: 0;
  margin-left: auto;
}

.agent-panel__dropdown-divider {
  height: 1px;
  background: #F0F2F5;
  margin: 4px 6px;
}

.agent-panel__dropdown-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: #A0AEC0;
}

/* ---- 分隔线 ---- */
.agent-panel__divider {
  height: 1px;
  background: #E8ECF2;
  margin: 24px 0;
}

/* ---- AI辅助模式 ---- */
.agent-panel__mode {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-panel__mode-title {
  font-size: 14px;
  font-weight: 600;
  color: #333333;
  margin-bottom: 2px;
}

/* 模式卡片 */
.agent-panel__mode-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 14px;
  background: #FFFFFF;
  border: 1.5px solid #EAEDF2;
  border-radius: 12px;
  cursor: pointer;
  transition: all 150ms ease;
}

.agent-panel__mode-card:hover {
  border-color: #D0D6E0;
}

.agent-panel__mode-card.is-active {
  background: #EEF4FD;
  border-color: #4A90E2;
}

.agent-panel__mode-card-icon {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 150ms ease;
}

.agent-panel__mode-card-icon.collaborative {
  background: #E8F0FE;
  color: #4A90E2;
}

.agent-panel__mode-card.is-active .agent-panel__mode-card-icon.collaborative {
  background: #4A90E2;
  color: #FFFFFF;
}

.agent-panel__mode-card-icon.managed {
  background: #EEF2F8;
  color: #6B95D1;
}

.agent-panel__mode-card.is-active .agent-panel__mode-card-icon.managed {
  background: #4A90E2;
  color: #FFFFFF;
}

.agent-panel__mode-card-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.agent-panel__mode-card-name {
  font-size: 15px;
  font-weight: 600;
  color: #1A202C;
  line-height: 1.3;
}

.agent-panel__mode-card-desc {
  font-size: 12px;
  color: #8A94A6;
  line-height: 1.4;
}
</style>
