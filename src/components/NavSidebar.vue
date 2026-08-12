<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import userService from '../services/user'
import Avatar from './Avatar.vue'
import UserStatusPopover from './UserStatusPopover.vue'
import { CONFIG, getApiBaseUrl } from '../config'

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
const currentUserName = computed(() => currentUser.value?.name || currentUser.value?.nick_name || '')
const currentUserPortrait = computed(() => currentUser.value?.portrait || currentUser.value?.avatar || '')

// 角色/工号从登录接口拿，没有就回退空串（不写死假数据）
const currentUserRole = computed(() => currentUser.value?.role_name || currentUser.value?.title || '')
// 管理员判断：登录接口 role === 2（与 UserDrawer.isAdmin 同口径）
const isAdmin = computed(() => Number(currentUser.value?.role) === 2)
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

async function openAdminConsole() {
  const url = `http://${getApiBaseUrl()}/jmateconsole?appkey=${CONFIG.APP_KEY}`
  if (window.electronAPI?.openExternal) {
    try { await window.electronAPI.openExternal(url); return } catch (error) { console.warn('[NavSidebar] open admin console failed', error) }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
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
  // {
  //   key: 'team',
  //   label: '团队',
  //   svg: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>`
  // },
  // {
  //   key: 'data',
  //   label: '知识库',
  //   svg: `<line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line>`
  // },
  {
    key: 'contacts',
    label: '联系人',
    adminOnly: false,
    svg: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>`
  },
  {
    key: 'tickets',
    label: '全量工单',
    adminOnly: true,
    svg: `<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>`
  },
  {
    key: 'analytics',
    label: '数据统计',
    adminOnly: true,
    svg: `<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>`
  }
]
// 过滤 adminOnly 项（仅管理员可见）
const visibleNavItems = computed(() => navItems.filter((it) => !it.adminOnly || isAdmin.value))
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

    <!-- nav-items：adminOnly 的项仅管理员可见 -->
    <button
      v-for="item in visibleNavItems"
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

    <button v-if="isAdmin" class="nav-item tip" data-tip="管理后台" type="button" @click="openAdminConsole">
      <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M732.672 984.064H303.616c-14.336 0-25.6-11.264-25.6-25.6s11.264-25.6 25.6-25.6h429.056c14.336 0 25.6 11.264 25.6 25.6s-11.264 25.6-25.6 25.6zM518.144 947.2c-14.336 0-25.6-11.264-25.6-25.6V794.624c0-14.336 11.264-25.6 25.6-25.6s25.6 11.264 25.6 25.6V921.6c0 14.336-11.264 25.6-25.6 25.6zM309.76 677.888c-14.336 0-25.6-11.264-25.6-25.6V277.504c0-14.336 11.264-25.6 25.6-25.6s25.6 11.264 25.6 25.6v374.784c0 14.336-11.264 25.6-25.6 25.6zM247.808 399.36a61.952 61.952 0 1 0 123.904 0 61.952 61.952 0 1 0-123.904 0zM309.76 486.912c-48.128 0-87.552-39.424-87.552-87.552s39.424-87.552 87.552-87.552 87.552 39.424 87.552 87.552-39.424 87.552-87.552 87.552z m0-123.904c-19.968 0-36.352 16.384-36.352 36.352s16.384 36.352 36.352 36.352 36.352-16.384 36.352-36.352-16.384-36.352-36.352-36.352z m402.432 314.88c-14.336 0-25.6-11.264-25.6-25.6V277.504c0-14.336 11.264-25.6 25.6-25.6s25.6 11.264 25.6 25.6v374.784c0 14.336-11.264 25.6-25.6 25.6zM650.24 399.36a61.952 61.952 0 1 0 123.904 0 61.952 61.952 0 1 0-123.904 0zM712.192 486.912c-48.128 0-87.552-39.424-87.552-87.552s39.424-87.552 87.552-87.552c48.128 0 87.552 39.424 87.552 87.552s-39.424 87.552-87.552 87.552z m0-123.904c-19.968 0-36.352 16.384-36.352 36.352s16.384 36.352 36.352 36.352 36.352-16.384 36.352-36.352-16.384-36.352-36.352-36.352zM516.608 678.4c-14.336 0-25.6-11.264-25.6-25.6V278.016c0-14.336 11.264-25.6 25.6-25.6s25.6 11.264 25.6 25.6V652.8c0 14.336-11.264 25.6-25.6 25.6zM454.656 530.944a61.952 61.952 0 1 0 123.904 0 61.952 61.952 0 1 0-123.904 0zM516.608 618.496c-48.128 0-87.552-39.424-87.552-87.552 0-48.128 39.424-87.552 87.552-87.552 48.128 0 87.552 39.424 87.552 87.552 0 48.128-39.424 87.552-87.552 87.552z m0-123.904c-19.968 0-36.352 16.384-36.352 36.352s16.384 36.352 36.352 36.352 36.352-16.384 36.352-36.352-16.384-36.352-36.352-36.352zM988.16 820.224H47.616c-14.336 0-25.6-11.264-25.6-25.6v-670.72c0-14.336 11.264-25.6 25.6-25.6H988.16c14.336 0 25.6 11.264 25.6 25.6v670.72c0 14.336-11.264 25.6-25.6 25.6z m-914.944-51.2H962.56v-619.52H73.216v619.52z"/></svg>
    </button>
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
  /* The signed-in toolbar itself is a large, convenient window drag target. */
  -webkit-app-region: drag;
}

/* Clickable toolbar content must never be swallowed by the drag region. */
.nav-rail .nav-item,
.nav-rail .me-mini,
.nav-rail :deep(.me-popover) {
  -webkit-app-region: no-drag;
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
  /* border: 2px solid var(--bg); */
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
