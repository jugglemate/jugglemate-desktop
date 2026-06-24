<script setup>
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  userName: {
    type: String,
    default: '用户'
  },
  userId: {
    type: String,
    default: 'user_12345678'
  }
})

const emit = defineEmits(['close', 'logout'])

const menuItems = [
  { label: '通用设置', icon: 'settings' },
  { label: '我的收藏', icon: 'star' },
  { label: '我的二维码', icon: 'qrcode' },
  { label: '账号管理', icon: 'account' },
  { label: '用户协议', icon: 'doc' },
  { label: '隐私协议', icon: 'shield' }
]
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-slide">
      <div v-if="show" class="user-drawer-overlay" @click.self="emit('close')">
        <div class="user-drawer">
          <!-- 顶部栏 -->
          <div class="user-drawer__header">
            <span class="user-drawer__title">用户设置</span>
            <button class="user-drawer__close" @click="emit('close')">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- 用户信息区 -->
          <div class="user-drawer__profile">
            <div class="user-drawer__avatar">{{ userName.charAt(0) }}</div>
            <div class="user-drawer__name">
              <label>昵称：</label>
              <span>{{ userName }}</span>
              <!-- <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="user-drawer__edit-icon">
                <path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="#8E99AB" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg> -->
            </div>
            <div class="user-drawer__id"><label>User ID：</label>{{ userId }}</div>
          </div>

          <div class="user-drawer__divider"></div>

          <div class="user-drawer__divider"></div>

          <!-- 退出登录 -->
          <div class="user-drawer__footer">
            <button class="user-drawer__logout" @click="emit('logout')">退出登录</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.user-drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 200;
  display: flex;
  justify-content: flex-start;
}

.user-drawer {
  width: 320px;
  height: 100vh;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  box-shadow: 4px 0 20px rgba(0, 0, 0, 0.1);
}

.user-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 40px 20px 16px;
}

.user-drawer__title {
  font-size: 17px;
  font-weight: 600;
  color: #1F2937;
}

.user-drawer__close {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #9CA3AF;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.user-drawer__close:hover {
  background: #F3F4F6;
  color: #374151;
}

.user-drawer__profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 20px 20px;
  gap: 10px;
}

.user-drawer__avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #3B82F6;
  color: #FFFFFF;
  font-size: 24px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.user-drawer__name {
  font-size: 15px;
  font-weight: 500;
  color: #1F2937;
  display: flex;
  align-items: center;
  gap: 4px;
}

.user-drawer__edit-icon {
  cursor: pointer;
  flex-shrink: 0;
}

.user-drawer__id {
  font-size: 12px;
  color: #8E99AB;
}

.user-drawer__divider {
  height: 1px;
  background: #F0F2F5;
  margin: 0 20px;
}

.user-drawer__menu {
  padding: 8px 0;
}

.user-drawer__menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  height: 48px;
  color: #374151;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.user-drawer__menu-item:hover {
  background: #F9FAFB;
}

.user-drawer__arrow {
  margin-left: auto;
  color: #C0C4CC;
}

.user-drawer__version {
  padding: 16px 0;
  text-align: center;
  font-size: 12px;
  color: #8E99AB;
}

.user-drawer__footer {
  padding: 16px 20px;
  margin-top: auto;
}

.user-drawer__logout {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 8px;
  background: #F56C6C;
  color: #FFFFFF;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.user-drawer__logout:hover {
  background: #E55353;
}

/* 滑入/滑出动画 */
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: opacity 0.25s ease;
}

.drawer-slide-enter-active .user-drawer,
.drawer-slide-leave-active .user-drawer {
  transition: transform 0.25s ease;
}

.drawer-slide-enter-from {
  opacity: 0;
}

.drawer-slide-enter-from .user-drawer {
  transform: translateX(-100%);
}

.drawer-slide-leave-to {
  opacity: 0;
}

.drawer-slide-leave-to .user-drawer {
  transform: translateX(-100%);
}
</style>
