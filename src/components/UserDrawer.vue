<script setup>
import { computed, ref, watch } from 'vue'
import { CONFIG, getApiBaseUrl } from '../config'
import toast from '../common/toast'
import userService from '../services/user'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  userName: {
    type: String,
    default: ''
  },
  userId: {
    type: String,
    default: 'user_12345678'
  },
  // Server-defined role. `2` = admin (sees the "管理后台" entry point), `1` = 普通用户。
  userRole: {
    type: [Number, String],
    default: null
  }
})

const emit = defineEmits(['close', 'logout'])

const isAdmin = computed(() => Number(props.userRole) === 2)
const editableName = ref(props.userName)
const editableAvatar = ref('')
watch(() => props.show, (visible) => {
  if (!visible) return
  const user = userService.getCurrentUser() || {}
  editableName.value = user.name || props.userName
  editableAvatar.value = user.portrait || user.avatar || ''
})

function saveProfile() {
  const name = editableName.value.trim()
  if (!name) return
  userService.updateCurrentUser({ name, portrait: editableAvatar.value.trim() })
  toast.success?.('个人信息已保存')
}

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
            <div class="user-drawer__avatar" :style="editableAvatar ? { backgroundImage: `url(${editableAvatar})` } : {}">
              <span v-if="!editableAvatar">{{ editableName.charAt(0) }}</span>
            </div>
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

          <div class="user-drawer__edit-form">
            <label>头像地址</label>
            <input v-model="editableAvatar" placeholder="输入头像 URL（可选）">
            <label>昵称</label>
            <input v-model="editableName" maxlength="40">
            <button type="button" class="user-drawer__save" @click="saveProfile">保存修改</button>
          </div>

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

.user-drawer__edit-form {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 20px;
}
.user-drawer__edit-form label {
  color: #6B7280;
  font-size: 12px;
}
.user-drawer__edit-form input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #E5E7EB;
  border-radius: 7px;
  color: #1F2937;
  font: inherit;
  outline: none;
}
.user-drawer__edit-form input:focus {
  border-color: #3B82F6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, .12);
}
.user-drawer__save {
  height: 34px;
  margin-top: 7px;
  border: 0;
  border-radius: 7px;
  background: #3B82F6;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
.user-drawer__save:hover { background: #2563EB; }

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
