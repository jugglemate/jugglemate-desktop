import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import userService from './services/user'
import im from './common/im'
import './assets/css/hubchat.css'
import './assets/css/hubchat-custom.css'
import './assets/css/login.css'

// 在任何组件挂载前就把 JuggleIM 客户端创建出来。
// 修复「ConversationList 挂载时 juggle 还没初始化 → 取不到 juggle?.on →
// onMounted 直接 return → 没人监听 STATE_CHANGED → 刷新页面后「我的」列表空白」的
// 竞态。init() 是幂等的（im.js 内部 if (juggle) return juggle），重复调用安全。
im.init()

const app = createApp(App)

app.use(router)

app.mount('#app')


