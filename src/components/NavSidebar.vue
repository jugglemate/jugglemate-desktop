<script setup>
import { ref, computed } from 'vue'
import userService from '../services/user'
import Avatar from './Avatar.vue'

const props = defineProps({
  activeNav: {
    type: String,
    default: 'messages'
  }
})

const emit = defineEmits(['open-user-drawer', 'nav-change'])

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron
const isMac = isElectron && window.electronAPI?.platform === 'darwin'
const isMaximized = ref(false)

// 当前登录用户，用于把"用户信息"那一项展示成头像。
const currentUser = computed(() => userService.getCurrentUser())
const currentUserName = computed(() => currentUser.value?.name || currentUser.value?.nick_name || '用户')
const currentUserPortrait = computed(() => currentUser.value?.portrait || currentUser.value?.avatar || '')

function handleMinimize() {
  window.electronAPI?.windowMinimize?.()
}

function handleMaximize() {
  window.electronAPI?.windowMaximize?.()
  isMaximized.value = !isMaximized.value
}

function handleClose() {
  window.electronAPI?.windowClose?.()
}
</script>

<template>
  <nav class="nav-sidebar" :class="{ 'nav-sidebar--mac': isMac }">
    <!-- macOS: 系统原生 traffic lights 通过 titleBarStyle='hidden' + trafficLightPosition 渲染 -->
    <!-- Windows: 自定义窗口控制按钮 -->
    <div v-if="!isMac" class="nav-sidebar__traffic-lights">
      <button class="nav-sidebar__tl nav-sidebar__tl--close" title="关闭" @click="handleClose"></button>
      <button class="nav-sidebar__tl nav-sidebar__tl--minimize" title="最小化" @click="handleMinimize"></button>
      <button class="nav-sidebar__tl nav-sidebar__tl--maximize" title="最大化" @click="handleMaximize"></button>
    </div>
    <div class="nav-sidebar__items">
      <!-- 用户信息：直接展示当前用户的头像，不再用图标+文字。 -->
      <button
        class="nav-sidebar__avatar-btn"
        :class="{ 'nav-sidebar__avatar-btn--active': activeNav === 'user' }"
        @click="emit('open-user-drawer')"
        title="用户信息"
      >
        <Avatar
          :name="currentUserName"
          :avatar="currentUserPortrait"
          size="md"
        />
      </button>

      <!-- 消息：active 态只换图标+文字颜色，不再加蓝色背景块。 -->
      <button
        class="nav-sidebar__item"
        :class="{ 'nav-sidebar__item--active': activeNav === 'messages' }"
        @click="emit('nav-change', 'messages')"
        title="消息"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17 3H5a2 2 0 00-2 2v9a2 2 0 002 2h2.5l3.5 3.5L14.5 16H17a2 2 0 002-2V5a2 2 0 00-2-2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 8.5h8M7 11.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span class="nav-sidebar__label">消息</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.nav-sidebar {
  width: 64px;
  min-width: 64px;
  height: 100vh;
  background: #e5edf4;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 12px;
  z-index: 50;
  -webkit-app-region: drag;
}

/* macOS: 为原生 traffic lights 留出空间 */
.nav-sidebar--mac {
  padding-top: 50px;
}

/* Windows 自定义窗口控制按钮 */
.nav-sidebar__traffic-lights {
  display: flex;
  gap: 6px;
  padding: 0 0 12px;
  -webkit-app-region: no-drag;
}

.nav-sidebar__tl {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: filter 0.15s;
}

.nav-sidebar__tl:hover {
  filter: brightness(0.85);
}

.nav-sidebar__tl--close {
  background: #FF5F57;
}

.nav-sidebar__tl--minimize {
  background: #FFBD2E;
}

.nav-sidebar__tl--maximize {
  background: #28C840;
}

.nav-sidebar__logo {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  margin-bottom: 20px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.nav-sidebar__items {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  -webkit-app-region: no-drag;
}

/* 用户头像按钮：圆形 36px 头像 + 选中态外圈描边。 */
.nav-sidebar__avatar-btn {
  width: 40px;
  height: 40px;
  margin: 0 auto;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 0.15s;
  outline: 2px solid transparent;
  outline-offset: 2px;
}

.nav-sidebar__avatar-btn:hover {
  outline-color: rgba(20, 33, 210, 0.35);
}

.nav-sidebar__avatar-btn--active {
  outline-color: #1421d2;
}

.nav-sidebar__item {
  width: 48px;
  height: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: none;
  background: transparent;
  color: #6B7280;
  cursor: pointer;
  margin: 0 auto;
  border-radius: 8px;
  /* 只换颜色，不再加 background。 */
  transition: color 0.15s;
  padding: 0;
}

.nav-sidebar__item:hover {
  color: #9CA3AF;
}

/* active 态：沿用原先的蓝色作为前景色（图标 + 文字），不铺背景。 */
.nav-sidebar__item--active {
  color: #1421d2;
}

.nav-sidebar__label {
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}
</style>
