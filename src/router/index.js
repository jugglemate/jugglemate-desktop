import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import MainView from '../views/MainView.vue'
import LoginView from '../views/LoginView.vue'
import userService from '../services/user'

// History 模式选择：
//
//   - createWebHistory（路径模式：/login）
//       URL 干净，但需要服务端把任意路径都 fallback 到 index.html
//       （nginx: try_files $uri $uri/ /index.html）。如果没配，刷新子页面 404。
//
//   - createWebHashHistory（hash 模式：/#/login）
//       URL 带 # 但永远只请求 index.html，**任何静态服务器零配置可跑**。
//       适合：通用静态代理、对象存储、CDN 源站、不能改 nginx 的场景。
//
// 选 hash 的触发条件（按优先级）：
//   1. ?vue-router-mode=history URL 参数强制 web history（部署方已配 SPA fallback）
//   2. file:// 协议
//   3. 默认 hash history（零配置）

function pickHistory() {
  if (typeof location === 'undefined') return createWebHashHistory()
  if (location.protocol === 'file:') return createWebHashHistory()
  // 显式 opt-in：用 ?vue-router-mode=history 切到 web history
  if (location.search.includes('vue-router-mode=history')) return createWebHistory('/')
  // 默认 hash history，零配置可跑
  return createWebHashHistory()
}

const router = createRouter({
  history: pickHistory(),
  routes: [
    {
      path: '/',
      name: 'main',
      component: MainView,
      meta: { requiresAuth: true }
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView
    }
  ],
})

// 路由守卫：未登录 → 强制跳转登录页
router.beforeEach((to, from, next) => {
  if (to.meta.requiresAuth && !userService.isLoggedIn()) {
    next('/login')
  } else {
    next()
  }
})

export default router
