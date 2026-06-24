import { createRouter, createWebHistory } from 'vue-router'
import MainView from '../views/MainView.vue'
import LoginView from '../views/LoginView.vue'
import RegisterView from '../views/RegisterView.vue'
import AgentAdmin from '../views/AgentAdmin.vue'
import userService from '../services/user'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
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
    },
    {
      path: '/register',
      name: 'register',
      component: RegisterView
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