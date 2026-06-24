<script setup>
import { ref, reactive, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import userService from '../services/user'
import { ERROR_CODE } from '../common/enum'

const router = useRouter()

const form = reactive({
  account: '',
  password: '',
  confirmPassword: ''
})

const errors = reactive({
  account: false,
  password: false,
  confirmPassword: false
})

const isLoading = ref(false)
const submitError = ref('')
const successMessage = ref('')
let redirectTimer = null

onBeforeUnmount(() => {
  if (redirectTimer) {
    clearTimeout(redirectTimer)
  }
})

function validateForm() {
  // Account: 6-20 chars, letters and numbers
  errors.account = !/^[A-Za-z0-9]{6,20}$/.test(form.account.trim())

  // Password: min 6 chars
  errors.password = form.password.length < 6

  // Confirm password: must match
  errors.confirmPassword = form.confirmPassword !== form.password

  return !errors.account && !errors.password && !errors.confirmPassword
}

function resolveErrorMessage(code) {
  switch (code) {
    case ERROR_CODE.USER_EXISTED:
      return '该账号已被注册'
    case ERROR_CODE.USER_NOT_EXIST:
      return '账号不存在'
    case ERROR_CODE.LOGIN_ERR_PASS:
      return '账号或密码错误'
    case ERROR_CODE.PARAM_ERROR:
      return '请检查账号和密码格式'
    default:
      return '注册失败，请稍后重试'
  }
}

async function handleRegister() {
  errors.account = false
  errors.password = false
  errors.confirmPassword = false
  submitError.value = ''
  successMessage.value = ''

  if (!validateForm()) {
    return
  }

  isLoading.value = true

  try {
    const res = await userService.register(form.account.trim(), form.password)
    isLoading.value = false

    if (res.code === ERROR_CODE.SUCCESS) {
      successMessage.value = '注册成功，正在跳转到登录页面...'
      redirectTimer = setTimeout(() => router.push('/login'), 1500)
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
    <!-- Left: Brand Panel -->
    <aside class="login-page__aside">
      <div class="login-page__brand">
        <div class="login-page__logo">
          <div class="login-page__logo-dot"></div>
        </div>
        <h1 class="login-page__aside-title">JuggleMate</h1>
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
            <h3 class="login-feature-card__title">聚合多平台私信，统一管理</h3>
            <p class="login-feature-card__desc">整合微信、微博、抖音、淘宝等主流平台的客服对话，在一个界面中统一处理，提升工作效率。</p>
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
            <p class="login-feature-card__desc">基于先进 AI 技术，为客服人员提供实时回复建议，确保回复准确性和一致性。</p>
          </div>
        </div>
        <div class="login-feature-card">
          <div class="login-feature-card__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="12.5,2 5,13 11.5,13 10.5,22 19,10 12.5,10 14,2" fill="#2563EB"/>
            </svg>
          </div>
          <div class="login-feature-card__body">
            <h3 class="login-feature-card__title">一键接管，自动回复</h3>
            <p class="login-feature-card__desc">在需要时一键接管对话，AI 助手自动回复常见问题，减轻客服工作压力。</p>
          </div>
        </div>
      </div>
    </aside>

    <!-- Right: Register Form -->
    <main class="login-page__form-side">
      <div class="login-card">
        <div class="login-card__header">
          <h2 class="login-card__title">创建账号</h2>
          <p class="login-card__subtitle">注册您的 JuggleMate 账号</p>
        </div>

        <form @submit.prevent="handleRegister">
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
                placeholder="6-20 位字母或数字"
                autocomplete="username"
              />
            </div>
            <div class="tyn-input-error" :class="{ 'tyn-input-error--visible': errors.account }">
              账号需为 6-20 位字母或数字
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
                placeholder="至少 6 个字符"
                autocomplete="new-password"
              />
            </div>
            <div class="tyn-input-error" :class="{ 'tyn-input-error--visible': errors.password }">
              密码至少 6 个字符
            </div>
          </div>

          <div class="tyn-form-group">
            <label class="tyn-form-label" for="confirm-password">确认密码</label>
            <div class="tyn-input-wrapper tyn-input-wrapper--icon">
              <svg class="tyn-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              <input
                id="confirm-password"
                v-model="form.confirmPassword"
                type="password"
                class="tyn-input"
                :class="{ 'tyn-input--error': errors.confirmPassword }"
                placeholder="再次输入密码"
                autocomplete="new-password"
              />
            </div>
            <div class="tyn-input-error" :class="{ 'tyn-input-error--visible': errors.confirmPassword }">
              两次输入的密码不一致
            </div>
          </div>

          <div v-if="submitError" class="login-form__error">
            {{ submitError }}
          </div>
          <div v-if="successMessage" class="login-form__success">
            {{ successMessage }}
          </div>

          <button
            type="submit"
            class="tyn-btn tyn-btn--primary tyn-btn--full"
            :class="{ 'tyn-btn--loading': isLoading }"
            :disabled="isLoading"
          >
            <span v-if="isLoading" class="tyn-btn__spinner"></span>
            <span>{{ isLoading ? '注册中...' : '注册' }}</span>
          </button>
        </form>

        <div class="login-signup-cta">
          <span class="login-signup-cta__text">已有账号？</span>
          <router-link to="/login" class="login-signup-cta__link">立即登录</router-link>
        </div>
      </div>
    </main>
  </div>
</template>
