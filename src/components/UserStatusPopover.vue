<script setup>
import { ref, computed } from 'vue'
import Avatar from './Avatar.vue'
const props = defineProps({
  currentStatus: {
    type: String,
    default: 'online' // online | busy | away | offline
  },
  userName: {
    type: String,
    default: ''
  },
  userRole: {
    type: String,
    default: ''
  },
  userIdNumber: {
    type: String,
    default: ''
  },
  userId: {
    type: [String, Number],
    default: ''
  },
  userAvatar: {
    type: String,
    default: ''
  },
  stats: {
    type: Object,
    default: () => ({
      sessionsToday: null,
      satisfaction: null,
      avgResponseSec: null
    })
  }
})

const emit = defineEmits(['status-change', 'settings', 'logout'])

const localStatus = ref(props.currentStatus)

const statsDisplay = computed(() => [
  { v: props.stats.sessionsToday != null ? String(props.stats.sessionsToday) : '—', l: '今日会话' },
  { v: props.stats.satisfaction  != null ? String(props.stats.satisfaction)  : '—', l: '满意度' },
  { v: props.stats.avgResponseSec != null ? `${props.stats.avgResponseSec}s` : '—', l: '平均响应' }
])

const statuses = [
  { key: 'online',  label: '在线', color: 'var(--success)' },
  { key: 'busy',    label: '忙碌', color: 'var(--warning)' },
  { key: 'away',    label: '离开', color: 'var(--warning)' },
  { key: 'offline', label: '隐身', color: 'var(--text-3)' }
]

function setStatus(key) {
  localStatus.value = key
  emit('status-change', key)
}

function handleSettings() {
  emit('settings')
}

function handleLogout() {
  emit('logout')
}
</script>

<template>
  <div class="me-popover" @click.stop>
    <!-- 头部：头像 + 姓名 + 角色 + 工号 -->
    <div class="me-head">
      <Avatar :user-id="userId" :name="userName" :avatar="userAvatar" size="md" />
      <div class="info">
        <div class="n">{{ userName }}</div>
        <div class="r">{{ userRole }}</div>
        <div class="id">{{ userIdNumber }}</div>
      </div>
    </div>

    <!-- 4 状态 -->
    <div class="status-row">
      <button
        v-for="s in statuses"
        :key="s.key"
        :class="{ on: localStatus === s.key }"
        :data-st="s.key"
        @click="setStatus(s.key)"
      >
        <span class="d" :style="{ background: s.color }"></span>
        {{ s.label }}
      </button>
    </div>

    <!-- 3 统计 -->
    <div class="me-stats">
      <div v-for="(it, i) in statsDisplay" :key="i" class="it">
        <div class="v">{{ it.v }}</div>
        <div class="l">{{ it.l }}</div>
      </div>
    </div>

    <!-- 操作 -->
    <div class="me-actions">
      <button @click="handleSettings">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        个人设置
      </button>
      <button @click="handleLogout">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <path d="m16 17 5-5-5-5"></path>
          <path d="M21 12H9"></path>
        </svg>
        退出登录
      </button>
    </div>
  </div>
</template>

<style scoped>
/* popover 现在嵌在 .nav-rail 内，位置在 avatar 下方展开；
   父级布局负责 left/top，自身只控制宽高和内容样式 */
.me-popover {
  position: absolute;
  left: 48px;
  top: 0;
  z-index: 1000;
  width: 280px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 12px;
  font-size: 13px;
  color: var(--text-1);
}

/* me-head：头像 + 姓名 + 角色 + 工号 */
.me-head {
  display: flex;
  gap: 10px;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-soft);
}
.me-head .info { line-height: 1.35; }
.me-head .n   { font-weight: 600; font-size: 14px; color: var(--text-1); }
.me-head .r   { font-size: 12px; color: var(--text-2); }
.me-head .id  { font-size: 11px; color: var(--text-3); }

/* status-row：4 状态按钮 */
.status-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin: 10px 0;
}
.status-row button {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
  border: 1px solid var(--border-soft);
  background: var(--bg);
  color: var(--text-2);
  padding: 4px 6px;
  border-radius: var(--r);
  cursor: pointer;
  font-size: 12px;
  transition: var(--t-fast);
}
.status-row button:hover {
  border-color: var(--primary);
  color: var(--text-1);
}
.status-row button.on {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: var(--primary);
}
.status-row .d {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

/* me-stats：3 统计 */
.me-stats {
  display: none;
  /* display: grid; */
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  background: var(--bg-mute);
  border-radius: var(--r);
  padding: 8px 4px;
  margin-bottom: 10px;
}
.me-stats .it { text-align: center; }
.me-stats .v  { font-size: 14px; font-weight: 600; color: var(--text-1); }
.me-stats .l  { font-size: 11px; color: var(--text-3); }

/* me-actions：设置 / 退出 */
.me-actions {
  display: flex;
  gap: 6px;
}
.me-actions button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--border-soft);
  background: var(--bg);
  color: var(--text-2);
  padding: 6px 8px;
  border-radius: var(--r);
  cursor: pointer;
  font-size: 12px;
  transition: var(--t-fast);
}
.me-actions button:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft);
}
</style>
