<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import userService from '../services/user'
import Avatar from './Avatar.vue'
import UserStatusPopover from './UserStatusPopover.vue'

const props = defineProps({
  activeNav: {
    type: String,
    default: 'inbox' // inbox | team | data
  },
  /**
   * 收件箱未读数（顶到 0 不展示 badge）
   */
  inboxBadge: {
    type: [Number, String],
    default: 0
  },
  /**
   * 头像下 popover 的状态卡（3 统计）
   * MainView 传真实数据
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

const emit = defineEmits(['nav-change', 'open-settings', 'logout', 'status-change'])

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron
const isMac = isElectron && window.electronAPI?.platform === 'darwin'

// 当前登录用户
const currentUser = computed(() => userService.getCurrentUser())
const currentUserName = computed(() => currentUser.value?.name || currentUser.value?.nick_name || '用户')
const currentUserPortrait = computed(() => currentUser.value?.portrait || currentUser.value?.avatar || '')

// 角色/工号从登录接口拿，没有就回退空串（不写死假数据）
const currentUserRole = computed(() => currentUser.value?.role_name || currentUser.value?.title || '')
const currentUserIdNumber = computed(() => {
  const id = currentUser.value?.employee_id || currentUser.value?.id
  const group = currentUser.value?.group_name
  if (id && group) return `工号 ${id} · ${group}`
  if (id) return `工号 ${id}`
  return ''
})

// me-mini 状态点 + 当前状态
const currentStatus = ref('online')
const mePopoverOpen = ref(false)

function toggleMePopover() {
  mePopoverOpen.value = !mePopoverOpen.value
}

function closeMePopover() {
  mePopoverOpen.value = false
}

function selectNav(key) {
  emit('nav-change', key)
}

function handleStatusChange(key) {
  currentStatus.value = key
  emit('status-change', key)
}

function handleSettings() {
  emit('open-settings')
  mePopoverOpen.value = false
}

function handleLogout() {
  emit('logout')
  mePopoverOpen.value = false
}

// 决策 4.3.7：外点 + Esc 关闭 popover
function onDocClick(e) {
  if (!mePopoverOpen.value) return
  const rail = document.querySelector('.nav-rail')
  if (rail && rail.contains(e.target)) return
  mePopoverOpen.value = false
}

function onKeyDown(e) {
  if (!mePopoverOpen.value) return
  if (e.key === 'Escape') mePopoverOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onKeyDown)
})

// 3 个导航项配置（图标来自你给的样板 HTML 的 svg）
const navItems = [
  {
    key: 'inbox',
    label: '收件箱',
    svg: `<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>`
  },
  {
    key: 'team',
    label: '团队',
    svg: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>`
  },
  {
    key: 'data',
    label: '数据',
    svg: `<line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line>`
  }
]
</script>

<template>
  <nav class="nav-rail" :class="{ 'nav-rail--mac': isMac }">
    <!-- me-mini：头像 + 状态点（点击展开 popover） -->
    <div
      class="me-mini"
      :title="currentUserIdNumber"
      @click="toggleMePopover"
    >
      <Avatar :name="currentUserName" :avatar="currentUserPortrait" size="sm" />
      <span class="status" :class="currentStatus"></span>

      <UserStatusPopover
        v-if="mePopoverOpen"
        :current-status="currentStatus"
        :user-name="currentUserName"
        :user-role="currentUserRole"
        :user-id-number="currentUserIdNumber"
        :user-id="currentUser?.id"
        :user-avatar="currentUserPortrait"
        :stats="stats"
        @status-change="handleStatusChange"
        @settings="handleSettings"
        @logout="handleLogout"
      />
    </div>

    <!-- 3 个 nav-item -->
    <button
      v-for="item in navItems"
      :key="item.key"
      class="nav-item tip"
      :class="{ active: activeNav === item.key }"
      :data-tip="item.label"
      @click="selectNav(item.key)"
    >
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"
        v-html="item.svg"
      ></svg>
      <span v-if="item.key === 'inbox' && inboxBadge" class="badge">{{ inboxBadge }}</span>
    </button>

    <div class="spacer"></div>
  </nav>
</template>

<style scoped>
/* === 新版 .nav-rail 主样式（来自你给的样板 css，已切到新 token） === */
.nav-rail {
  background: var(--bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 4px;
  z-index: 5;
  height: 100vh;
  position: relative;
}

/* macOS：为系统 traffic lights 留出 38px 顶部空间 */
.nav-rail--mac {
  padding-top: 22px;
}

.nav-rail .nav-item {
  position: relative;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--text-2);
  transition: var(--t-fast);
  cursor: pointer;
  background: transparent;
  border: none;
  padding: 0;
}
.nav-rail .nav-item:hover {
  background: var(--bg-mute);
  color: var(--text-1);
}
.nav-rail .nav-item.active {
  background: var(--primary-soft);
  color: var(--primary);
}
.nav-rail .nav-item svg {
  width: 18px;
  height: 18px;
}

/* 收件箱未读 badge */
.nav-rail .nav-item .badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: grid;
  place-items: center;
  border: 2px solid var(--bg);
}

.nav-rail .spacer { flex: 1; }

/* 右侧 tooltip（你给样板的 ::after 提示） */
.nav-rail .nav-item.tip { position: relative; }
.nav-rail .nav-item.tip:hover::after {
  content: attr(data-tip);
  position: absolute;
  left: 48px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--text-1);
  color: #fff;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  z-index: 100;
  pointer-events: none;
}

/* === me-mini：头像 + 状态点 === */
.me-mini {
  width: 60px;
  margin: 6px 0;
  background: rgba(255, 255, 255, .06);
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 10px;
  padding: 6px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  position: relative;
  transition: var(--t-fast);
}
/* .me-mini:hover { background: var(--bg-mute); } */

.me-mini .status {
  border: 1px solid var(--bg);
  position: absolute;
  right: 4px;
  top: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.me-mini .status.online  { background: var(--success); }
.me-mini .status.busy    { background: var(--warning); }
.me-mini .status.away    { background: var(--warning); }
.me-mini .status.offline { background: var(--text-3); }
</style>
