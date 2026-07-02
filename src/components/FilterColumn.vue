<script setup>
import { computed } from 'vue'
import { SESSION_FILTER, PLATFORM } from '../common/enum.js'

/**
 * FilterColumn — 5 列布局第 2 列（220px，可收起）
 * 决策 4.4.1~4.4.8 推荐全 a
 * 决策 3.1 = a：5 项视图 mine / unassigned / ai_hosting / pending_reply / all
 * 决策 4.4.3 = a：视图组 + 平台组
 * 决策 4.4.5 = a：平台做实际过滤
 * 决策 4.4.6 = a：可收起 + 16px 把手
 * 决策 4.4.7 = a：v-if="activeNav === 'inbox'" 显隐
 */
const props = defineProps({
  filter: {
    type: String,
    required: true
  },
  filterCounts: {
    type: Object,
    default: () => ({})
  },
  platformFilter: {
    type: String,
    default: 'all'
  },
  collapsed: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['filter-change', 'platform-change', 'toggle-collapse'])

// 5 项视图（决策 3.1 = a，截图 1 第 2 列：我的/待分配/AI 托管中/待回复/全部）
const viewItems = [
  { key: SESSION_FILTER.MINE,          label: '我的' },
  { key: SESSION_FILTER.UNASSIGNED,    label: '待分配' },
  { key: SESSION_FILTER.AI_HOSTING,    label: 'AI 托管中' },
  { key: SESSION_FILTER.PENDING_REPLY, label: '待回复' },
  { key: SESSION_FILTER.ALL,           label: '全部' }
]

// 3 项平台（决策 4.1 = a，截图 1 第 2 列底部：Web / Telegram / JuggleChat）
const platformItems = [
  { key: PLATFORM.WEB,        label: 'Web' },
  { key: PLATFORM.TELEGRAM,   label: 'Telegram' },
  { key: PLATFORM.JUGGLECHAT, label: 'JuggleChat' }
]

function selectView(key) {
  emit('filter-change', key)
}

function selectPlatform(key) {
  emit('platform-change', key)
}

function handleToggle() {
  emit('toggle-collapse')
}
</script>

<template>
  <div class="filter-col" :class="{ 'filter-col--collapsed': collapsed }">
    <div v-if="!collapsed" class="filter-col__inner">
      <!-- 收起按钮（右上角） -->
      <button
        class="filter-col__collapse-btn"
        title="收起"
        aria-label="收起"
        @click="handleToggle"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      <!-- 视图组 -->
      <div class="filter-col__group">
        <div class="filter-col__group-title">视图</div>
        <button
          v-for="it in viewItems"
          :key="it.key"
          class="filter-col__item"
          :class="{ 'filter-col__item--active': filter === it.key }"
          @click="selectView(it.key)"
        >
          <span class="filter-col__item-label">{{ it.label }}</span>
          <span v-if="filterCounts[it.key]" class="filter-col__item-badge">{{ filterCounts[it.key] }}</span>
        </button>
      </div>

      <!-- 平台组 -->
      <div class="filter-col__group">
        <div class="filter-col__group-title">平台</div>
        <button
          v-for="it in platformItems"
          :key="it.key"
          class="filter-col__item"
          :class="{ 'filter-col__item--active': platformFilter === it.key }"
          @click="selectPlatform(it.key)"
        >
          <span class="filter-col__item-label">{{ it.label }}</span>
        </button>
      </div>
    </div>

    <!-- 收起态：仅留 16px 把手 + 展开按钮 -->
    <button
      v-else
      class="filter-col__expand-btn"
      title="展开"
      aria-label="展开"
      @click="handleToggle"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.filter-col {
  width: 220px;
  min-width: 220px;
  height: 100%;
  background: var(--bg);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  position: relative;
  transition: width var(--t), min-width var(--t);
}

.filter-col--collapsed {
  width: 16px;
  min-width: 16px;
}

.filter-col__inner {
  padding: 12px 8px;
}

.filter-col__collapse-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--text-3);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.filter-col__collapse-btn:hover {
  background: var(--bg-mute);
  color: var(--text-1);
}

.filter-col__group {
  margin-bottom: 16px;
}

.filter-col__group-title {
  font-size: 11px;
  color: var(--text-3);
  padding: 4px 10px 6px;
  font-weight: 500;
  letter-spacing: 0.5px;
}

.filter-col__item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 7px 10px 7px 13px;
  border: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  border-radius: var(--r);
  cursor: pointer;
  text-align: left;
  transition: background var(--t-fast), color var(--t-fast);
}

/* 决策 4.4.4 = a：active 态左侧 3px primary 竖条 + primary-soft 背景 */
.filter-col__item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: transparent;
  transition: background var(--t-fast);
}

.filter-col__item:hover {
  background: var(--bg-mute);
  color: var(--text-1);
}

.filter-col__item--active {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 500;
}

.filter-col__item--active::before {
  background: var(--primary);
}

.filter-col__item-badge {
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg-mute);
  padding: 1px 6px;
  border-radius: var(--r-full);
  min-width: 18px;
  text-align: center;
}

.filter-col__item--active .filter-col__item-badge {
  background: var(--primary);
  color: var(--bg);
}

.filter-col__expand-btn {
  width: 16px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.filter-col__expand-btn:hover {
  background: var(--bg-mute);
  color: var(--text-1);
}
</style>
