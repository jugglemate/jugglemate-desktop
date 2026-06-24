import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import userService from './services/user'
import im from './common/im'
import './assets/css/hubchat.css'
import './assets/css/hubchat-custom.css'
import './assets/css/login.css'

const app = createApp(App)

app.use(router)

app.mount('#app')

// Re-establish the IM socket if the user is already logged in (cold start
// or page refresh). main.js runs once per page load, so this covers both.
// im.connect() is idempotent — calling it on an already-connected client
// resolves the success callback immediately, no duplicate connection.
const currentUser = userService.getCurrentUser()
console.log('[main.js] startup — currentUser from storage:', currentUser ? { 
  hasId: !!currentUser.id, 
  hasToken: !!currentUser.token, 
  hasAuth: !!currentUser.authorization 
} : null)
if (currentUser?.token) {
  im.connect(currentUser, {
    success: (imUser) => console.log('[main.js] im reconnected on startup, imUser:', imUser),
    error: (jg, err) => console.warn('[main.js] im reconnect on startup failed, err:', err?.message || err, 'juggle:', !!jg)
  })
  // 同步通知主进程也通过 imService 建立连接
  if (window.electronAPI?.imConnect) {
    window.electronAPI.imConnect(currentUser.token).then(res => {
      console.log('[main.js] 主进程 im-connect 结果:', res)
    })
  }
} else {
  console.warn('[main.js] no token found — skipping IM connect on startup')
}

// 同步已保存的 API Server 到主进程 im-service
import { getApiBaseUrl } from './config'
const savedApiBase = getApiBaseUrl()
if (window.electronAPI?.imSetApiServer) {
  window.electronAPI.imSetApiServer(savedApiBase).then(() => {
    console.log('[main.js] API Server synced to main process:', savedApiBase)
  })
}
