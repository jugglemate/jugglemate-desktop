import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import userService from './services/user'
import './assets/css/hubchat.css'
import './assets/css/hubchat-custom.css'
import './assets/css/login.css'

const app = createApp(App)

app.use(router)

app.mount('#app')


