<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import userService from '../services/user'
import { ERROR_CODE } from '../common/enum'
import { getApiBaseUrl, setApiBaseUrl } from '../config'
import Slideover from '../components/Slideover.vue'

const router = useRouter()

const form = reactive({
  account: '',
  password: ''
})

const errors = reactive({
  account: false,
  password: false
})

const rememberMe = ref(false)
const isLoading = ref(false)
const submitError = ref('')

// Server settings slideover
const showServerSettings = ref(false)
const apiUrlInput = ref('')

function openServerSettings() {
  apiUrlInput.value = getApiBaseUrl()
  showServerSettings.value = true
}

function saveServerSettings() {
  setApiBaseUrl(apiUrlInput.value)
  // 同步 API Server 到主进程 im-service
  if (window.electronAPI?.imSetApiServer) {
    window.electronAPI.imSetApiServer(apiUrlInput.value)
  }
  showServerSettings.value = false
}

function validateForm() {
  let valid = true

  errors.account = !form.account.trim()
  errors.password = form.password.length < 6

  if (errors.account || errors.password) {
    valid = false
  }

  return valid
}

function resolveErrorMessage(code) {
  switch (code) {
    case ERROR_CODE.USER_NOT_EXIST:
      return '账号不存在'
    case ERROR_CODE.LOGIN_ERR_PASS:
      return '账号或密码错误'
    case ERROR_CODE.PARAM_ERROR:
      return '请检查账号和密码格式'
    default:
      return '登录失败，请稍后重试'
  }
}

async function handleLogin() {
  errors.account = false
  errors.password = false
  submitError.value = ''

  if (!validateForm()) {
    return
  }

  isLoading.value = true

  try {
    const res = await userService.login(form.account.trim(), form.password)
    isLoading.value = false

    if (res.code === ERROR_CODE.SUCCESS) {
      router.push('/')
      return
    }

    submitError.value = resolveErrorMessage(res.code)
  } catch (e) {
    isLoading.value = false
    submitError.value = '网络异常，请检查连接后重试'
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-page__drag-region" aria-hidden="true"></div>
    <!-- Left: Brand Panel -->
    <aside class="login-page__aside">
      <div class="login-page__brand">
        <div class="login-page__logo">
          <div class="login-page__logo-dot"></div>
        </div>
        <h1 class="login-page__aside-title">JuggleMate</h1>
        <!-- <p class="login-page__aside-subtitle">
          一个窗口，管理所有平台的对话；一个面板，调度所有 AI 助手
        </p> -->
      </div>

      <div class="login-page__features">
        <div class="login-feature-card">
          <div class="login-feature-card__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="2" width="18" height="5" rx="1.5" fill="#2563EB"/>
              <rect x="4" y="9.5" width="16" height="5" rx="1.5" fill="#2563EB" opacity="0.75"/>
              <rect x="5" y="17" width="14" height="5" rx="1.5" fill="#2563EB" opacity="0.45"/>
            </svg>
          </div>
          <div class="login-feature-card__body">
            <h3 class="login-feature-card__title">聚合多渠道私信，统一处理</h3>
            <p class="login-feature-card__desc">把 Web、Telegram、JuggleChat、WhatsApp 等渠道的客服对话收进同一个收件箱，一个界面回复所有消息。</p>
          </div>
        </div>
        <div class="login-feature-card">
          <div class="login-feature-card__icon">
            <svg t="1782198138322" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
              p-id="6563" id="mx_n_1782198138323" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24">
              <path
                d="M576 85.333333c0 18.944-8.234667 35.968-21.333333 47.701334V213.333333h213.333333a128 128 0 0 1 128 128v426.666667a128 128 0 0 1-128 128H256a128 128 0 0 1-128-128V341.333333a128 128 0 0 1 128-128h213.333333V133.034667A64 64 0 1 1 576 85.333333zM0 426.666667h85.333333v256H0v-256z m1024 0h-85.333333v256h85.333333v-256zM384 618.666667a64 64 0 1 0 0-128 64 64 0 0 0 0 128z m320-64a64 64 0 1 0-128 0 64 64 0 0 0 128 0z"
                fill="#2563EB" p-id="6564"></path>
            </svg>
          </div>
          <div class="login-feature-card__body">
            <h3 class="login-feature-card__title">AI Agent 实时回复建议</h3>
            <p class="login-feature-card__desc">为每个 Agent 设定角色与话术风格；选中 Agent 后实时给出多条候选回复，点击一键填入输入框。</p>
          </div>
        </div>
      </div>
    </aside>

    <!-- Right: Login Form -->
    <main class="login-page__form-side">
      <button class="login-server-btn" title="服务器设置" @click="openServerSettings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      <div class="login-card">
        <div class="login-card__header">
          <h2 class="login-card__title">欢迎回来</h2>
          <p class="login-card__subtitle">请登录您的 JuggleMate 账号</p>
        </div>

        <form @submit.prevent="handleLogin">
          <div class="tyn-form-group">
            <label class="tyn-form-label" for="account">账号</label>
            <div class="tyn-input-wrapper tyn-input-wrapper--icon">
              <svg class="tyn-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <input
                id="account"
                v-model="form.account"
                type="text"
                class="tyn-input"
                :class="{ 'tyn-input--error': errors.account }"
                placeholder="请输入账号"
                autocomplete="username"
              />
            </div>
            <div class="tyn-input-error" :class="{ 'tyn-input-error--visible': errors.account }">
              请输入账号
            </div>
          </div>

          <div class="tyn-form-group">
            <label class="tyn-form-label" for="password">密码</label>
            <div class="tyn-input-wrapper tyn-input-wrapper--icon">
              <svg class="tyn-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              <input
                id="password"
                v-model="form.password"
                type="password"
                class="tyn-input"
                :class="{ 'tyn-input--error': errors.password }"
                placeholder="输入密码"
                autocomplete="current-password"
              />
            </div>
            <div class="tyn-input-error" :class="{ 'tyn-input-error--visible': errors.password }">
              密码至少 6 个字符
            </div>
          </div>

          <div class="login-form__row">
            <label class="login-checkbox-wrapper">
              <input type="checkbox" v-model="rememberMe" />
              <span class="login-checkbox-custom"></span>
              <span class="login-checkbox-label">记住我</span>
            </label>
            <a href="#" class="login-link">忘记密码？</a>
          </div>

          <div v-if="submitError" class="login-form__error">
            {{ submitError }}
          </div>

          <button
            type="submit"
            class="tyn-btn tyn-btn--primary tyn-btn--full"
            :class="{ 'tyn-btn--loading': isLoading }"
            :disabled="isLoading"
          >
            <span v-if="isLoading" class="tyn-btn__spinner"></span>
            <span>{{ isLoading ? '登录中...' : '登录' }}</span>
          </button>
        </form>
      </div>
    </main>

    <!-- Server Settings Slideover -->
    <Slideover
      title="服务器设置"
      :show="showServerSettings"
      @close="showServerSettings = false"
    >
      <div class="server-settings">
        <p class="server-settings__desc">
          修改后将覆盖默认地址 localhost:8050，留空则恢复默认。
        </p>
        <div class="server-settings__field">
          <label class="server-settings__label" for="api-url">API 地址</label>
          <input
            id="api-url"
            v-model="apiUrlInput"
            type="text"
            class="tyn-input"
            placeholder="localhost:8050"
          />
        </div>
      </div>
      <template #footer>
        <div class="server-settings__footer">
          <button class="tyn-btn tyn-btn--secondary" @click="showServerSettings = false">取消</button>
          <button class="tyn-btn tyn-btn--primary" @click="saveServerSettings">保存</button>
        </div>
      </template>
    </Slideover>
  </div>
</template>
