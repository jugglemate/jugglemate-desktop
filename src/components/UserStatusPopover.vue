<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import Avatar from './Avatar.vue'

/**
 * UserStatusPopover — NavSidebar 头像点击后弹出的状态切换卡片
 * 决策 4.3.1~4.3.8 = a/a/a/a/a/a/a/b（推荐全部 a）
 * 决策 4.3.7 = a：外部点击 + Esc + 再点头像 都要关闭
 * 决策 4.3.8 = b：固定 left:76px / top:80px（参考样板 HTML 位置）
 * 决策 6：状态不持久化（刷新回 online）
 */
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  currentStatus: {
    type: String,
    default: 'online' // online | busy | away | offline
  },
  userName: {
    type: String,
    default: '王芳'
  },
  userRole: {
    type: String,
    default: '资深客服 · 3 年'
  },
  userIdNumber: {
    type: String,
    default: '工号 A0231 · 客服一组'
  },
  userId: {
    type: [String, Number],
    default: 'A0231'
  },
  userAvatar: {
    type: String,
    default: ''
  },
  /**
   * 3 项统计数据（MainView 算好传入）
   * 决策 4.3.6 修正 = a：走真实用户数据
   * - sessionsToday：今日会话数（从 juggle.getConversations() 算）
   * - satisfaction：满意度（后端无接口 → 显示 '—'）
   * - avgResponseSec：平均响应秒（暂无全局数据源 → 显示 '—'）
   * 缺数据用 null 标识，组件内部显示 '—'
   */
  stats: {
    type: Object,
    default: () => ({
      sessionsToday: null,
      satisfaction: null,
      avgResponseSec: null
    })
  }
})

const emit = defineEmits(['close', 'meStatus-change', 'settings', 'logout'])

// 4 状态切换（决策 4.3.5 默认 online，从 currentStatus prop 拿）
const localStatus = ref(props.currentStatus)

// 决策 4.3.6 修正 = a：走真实用户数据（MainView 传入），缺数据显示 '—'
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
  emit('meStatus-change', key)
}

function handleSettings() {
  emit('settings')
  emit('close')
}

function handleLogout() {
  emit('logout')
  emit('close')
}

// 决策 4.3.7 = a：外部点击 + Esc + 再点头像 都要
function onDocClick(e) {
  if (!props.show) return
  const root = document.querySelector('.jm-user-popover')
  // 如果点击在 popover 内部（avatar 按钮、me-actions 按钮），不关
  if (root && root.contains(e.target)) return
  emit('close')
}

function onKeyDown(e) {
  if (!props.show) return
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="jm-user-popover" @click.stop>
      <!-- me-head：头像 + 姓名 + 角色 + 工号 -->
      <div class="me-head">
        <Avatar
          :user-id="userId"
          :name="userName"
          :avatar="userAvatar"
          size="md"
        />
        <div class="info">
          <div class="n">{{ userName }}</div>
          <div class="r">{{ userRole }}</div>
          <div class="id">{{ userIdNumber }}</div>
        </div>
      </div>

      <!-- status-row：4 状态 -->
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

      <!-- me-stats：3 项统计 -->
      <div class="me-stats">
        <div v-for="(it, i) in statsDisplay" :key="i" class="it">
          <div class="v">{{ it.v }}</div>
          <div class="l">{{ it.l }}</div>
        </div>
      </div>

      <!-- me-actions：个人设置 / 退出登录 -->
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
  </Teleport>
</template>

<!-- 决策 4.3.1 = a：popover 用全局 class（不 scoped），写在 tokens.css 之外的 hubchat-custom.css 不合适
     实际：这里不写 scoped，但样式集中在 tokens.css 顶层 .jm-user-popover-* 选择器
     等等：scoped 在 <Teleport to="body"> 后的 DOM 不会注入 hash，必须放全局。
     方案：写到 src/assets/css/hubchat-custom.css 末尾（已在 main.js 引入），保持单一收口点 -->
<style>
/* UserStatusPopover 全局样式（不 scoped，决策 4.3.1 a） */
.jm-user-popover {
  position: fixed;
  left: 76px;
  top: 80px;
  z-index: 9999;
  width: 280px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 12px;
  font-size: 13px;
  color: var(--text-1);
}

.jm-user-popover .me-head {
  display: flex;
  gap: 10px;
  padding: 4px 0 12px;
  border-bottom: 1px solid var(--border-soft);
  align-items: center;
}

.jm-user-popover .me-head .info {
  flex: 1;
  min-width: 0;
}

.jm-user-popover .me-head .n {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.2;
}

.jm-user-popover .me-head .r {
  font-size: 11px;
  color: var(--text-2);
  margin-top: 2px;
  line-height: 1.2;
}

.jm-user-popover .me-head .id {
  font-size: 10px;
  color: var(--text-3);
  margin-top: 2px;
  line-height: 1.2;
}

.jm-user-popover .status-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-soft);
}

.jm-user-popover .status-row button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--r);
  border: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.jm-user-popover .status-row button:hover {
  background: var(--bg-mute);
}

.jm-user-popover .status-row button.on {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 500;
}

.jm-user-popover .status-row button .d {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.jm-user-popover .me-stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-soft);
}

.jm-user-popover .me-stats .it {
  background: var(--bg-mute);
  border-radius: var(--r);
  padding: 6px 4px;
  text-align: center;
}

.jm-user-popover .me-stats .v {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.2;
}

.jm-user-popover .me-stats .l {
  font-size: 10px;
  color: var(--text-3);
  margin-top: 2px;
  line-height: 1.2;
}

.jm-user-popover .me-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding-top: 10px;
}

.jm-user-popover .me-actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--r);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.jm-user-popover .me-actions button:hover {
  background: var(--bg-mute);
  color: var(--text-1);
}
</style>
