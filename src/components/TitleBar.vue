<script setup>
defineProps({
  userName: {
    type: String,
    default: ''
  },
  userRole: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['logout'])

function handleLogout() {
  emit('logout')
}
</script>

<template>
  <header class="tyn-title-bar">
    <!-- 左侧品牌区 -->
    <div class="tyn-title-bar__brand">
      <div class="tyn-title-bar__brand-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 18v-6a9 9 0 0118 0v6" stroke="#4A90E2" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v5z" fill="#4A90E2" fill-opacity="0.2" stroke="#4A90E2" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="8" y="8" width="8" height="5" rx="2" fill="#4A90E2" fill-opacity="0.3"/>
          <path d="M10 10.5h4M10 12h2" stroke="#4A90E2" stroke-width="0.8" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="tyn-title-bar__brand-text">
        <div class="tyn-title-bar__brand-title-row">
          <span class="tyn-title-bar__brand-title">JuggleMate</span>
          <span class="tyn-title-bar__brand-pill">AI辅助</span>
        </div>
        <span class="tyn-title-bar__brand-slogan">高效沟通，专业服务，AI智能辅助</span>
      </div>
    </div>

    <!-- 右侧用户信息区 -->
    <div class="tyn-title-bar__user">
      <div class="tyn-title-bar__user-info">
        <span class="tyn-title-bar__user-name">{{ userName }}</span>
        <span class="tyn-title-bar__user-role">{{ userRole }}</span>
      </div>
      <div class="tyn-title-bar__user-avatar">{{ userName.charAt(0) }}</div>
      <button class="tyn-title-bar__logout" @click="handleLogout" title="退出登录">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>
  </header>
</template>
