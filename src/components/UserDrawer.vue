<script setup>
import { computed } from 'vue'
import { CONFIG, getApiBaseUrl } from '../config'
import toast from '../common/toast'

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
  },
  // Server-defined role. `1` = admin (sees the "管理后台" entry point).
  userRole: {
    type: [Number, String],
    default: null
  }
})

const emit = defineEmits(['close', 'logout'])

const isAdmin = computed(() => Number(props.userRole) === 1)

// 管理员专属：跳转到外部管理后台。
// 主机地址跟随用户当前配置的 API server（而不是写死线上 IP），
// 切到测试环境时管理后台 URL 也跟着切；appkey 同步走 config 里的 APP_KEY。
const adminConsoleUrl = computed(() => `http://${getApiBaseUrl()}/jmateconsole?appkey=${CONFIG.APP_KEY}`)

async function openAdminConsole() {
  const url = adminConsoleUrl.value
  // Electron 桌面端：走主进程 shell.openExternal，由系统默认浏览器打开 URL。
  // 普通浏览器（开发态 vite / 直接预览）下没有 electronAPI，降级到 window.open。
  if (window.electronAPI?.openExternal) {
    try {
      await window.electronAPI.openExternal(url)
      return
    } catch (err) {
      // 常见原因：main.cjs 改了但没重启 Electron，主进程没有 'open-external' handler。
      console.warn('[UserDrawer] openExternal 失败，fallback 到 a.click()：', err)
      // toast.error('外部链接桥接未生效，请重启应用后再试')
    }
  }
  // 兜底：动态创建 <a target="_blank"> 并触发点击。
  // 在 web 端这会开新标签页；在 Electron 端如果 setWindowOpenHandler 没配，
  // 也会尽量走系统浏览器（比直接 window.open 行为更可控）。
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
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

          <!-- 菜单区：当前只对管理员展示"管理后台"入口；非管理员整块不渲染。 -->
          <div v-if="isAdmin" class="user-drawer__menu">
            <!-- 管理员专属入口：跳转到 jmateconsole -->
            <button
              type="button"
              class="user-drawer__menu-item user-drawer__menu-item--admin"
              @click="openAdminConsole"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7l3-7z"/>
              </svg>
              <span>管理后台</span>
              <svg class="user-drawer__arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 3h2v2h-2zM9 7h2v6h-2zM5 9h6v2H5z" fill="currentColor"/>
                <path d="M14 3l-1-1-7 7 1 1 7-7z" fill="currentColor"/>
              </svg>
            </button>
          </div>

          <div v-if="isAdmin" class="user-drawer__divider"></div>

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

.user-drawer__menu-item--admin {
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  color: #2563EB;
  font-weight: 500;
}

.user-drawer__menu-item--admin:hover {
  background: #EFF6FF;
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
