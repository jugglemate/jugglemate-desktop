<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import NavSidebar from '../components/NavSidebar.vue'
import Conversations from '../components/Conversations.vue'
import ChatMain from '../components/ChatMain.vue'
import AgentPanel from '../components/AgentPanel.vue'
import UserDrawer from '../components/UserDrawer.vue'
import AgentCreateSlideover from '../components/AgentCreateSlideover.vue'
import Modal from '../components/Modal.vue'
import Toast from '../components/Toast.vue'
import im from '../common/im'
import userService from '../services/user'
import { SERVER_PATH, get, post } from '../services/api'
import {
  MSG_NAME, SESSION_FILTER,
  TICKET_GLOBAL_TAG, PLATFORM, PLATFORM_TAG_ID, PLATFORM_META
} from '../common/enum'

const router = useRouter()
const juggle = im.getCurrent()

// Current logged-in user (from localStorage, set by login)
const currentUser = computed(() => userService.getCurrentUser())
const currentUserName = computed(() => currentUser.value?.name || '用户')
// `role` 来自登录接口：1 = 管理员（在用户信息抽屉中显示"管理后台"入口），
// 其他值 = 普通坐席。具体业务含义由后端定义。
const currentUserRole = computed(() => currentUser.value?.role ?? null)

// Navigation & drawer state
// activeNav: inbox | team | data
const activeNav = ref('inbox')
const showUserDrawer = ref(false)
const currentUserId = computed(() => currentUser.value?.id || 'user_12345678')

// 收件箱未读数 —— 订阅 im.inboxUnreadTotal。
// 数据写入由 Conversations.fetchUnreadCounts() 完成（im 单例的 reactive ref），
// 触发时机：登录 / onStateChanged / watch(currentView|currentPlatform) /
// 收到新消息 / CONVERSATION_CHANGED / REMOVED / 用户清未读。
// 因此 NavSidebar 上「收件箱」badge 跟这些事件流自动同步，无需手动通知。
// 必须 .value 解包 Ref：否则 computed 返回 Ref 对象本身（永远 truthy），
// 导致 NavSidebar 上「v-if="inboxBadge"」始终为 true，0 时也会展示 badge；
// 并且 computed 没有 track 到 ref.value，后续 .value 变化不会触发重算。
const inboxBadge = computed(() => im.inboxUnreadTotal.value || 0)

function handleNavChange(nav) {
  activeNav.value = nav
  // 团队 / 数据 暂时没路由，先打日志
  if (nav === 'team' || nav === 'data') {
    console.log('[nav]', nav, '暂未实现路由')
  }
}
function handleStatusChange(key) {
  // TODO: 同步到后端 / juggle 当前用户状态
  console.log('[status-change]', key)
}

// Debug: log IM connection state at mount
onMounted(async () => {
  console.log('[MainView] mounted — IM connection state:', { 
    juggleExists: !!juggle, 
    isConnected: juggle?.isConnected?.() 
  })

  // 启动时尝试恢复 IM 连接（token 存在但进程重启后 WebSocket 已断开）
  const juggleConnected = juggle?.isConnected?.()
  const imConnecting = im.isConnecting?.()
  if (!juggleConnected && !imConnecting) {
    const stored = userService.getCurrentUser()
    if (stored?.id && stored?.token) {
      console.log('[MainView] 检测到已登录用户，尝试重连 IM...')
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('IM 重连超时（10s）')), 10000)
          im.connect(stored, {
            success: () => {
              clearTimeout(timeout)
              resolve()
            },
            error: (jg, err) => {
              clearTimeout(timeout)
              reject(err)
            }
          })
        })
        console.log('[MainView] IM 重连成功')
      } catch (err) {
        console.error('[MainView] IM 重连失败:', err?.message || err)
        userService.logout()
        router.push('/login')
      }
    } else {
      console.warn('[MainView] 无有效登录凭证，跳转登录页')
      router.push('/login')
    }
  } else if (imConnecting) {
    console.log('[MainView] IM 正在连接中，跳过重复重连')
  }
})

// Conversation state (in-memory, no routing)
const currentView = ref('conversation') // 'conversation' | 'group'
const currentConvoId = ref(null)
const currentConversation = ref(null)

// Conversations 内部维护视图/平台过滤；右侧列表始终是 IM 会话
// （unassigned 视图通过 exceptTag=assigned 在服务端过滤）。
const conversationsRef = ref(null)  // 父组件引用，认领后调 refresh() 重拉 IM 会话
// ChatMain 的 ref —— 转移 / 关闭弹层等回写通过此 ref 调 defineExpose 的方法
const chatMainRef = ref(null)
// 当前会话的写作 agent（建议区文案风格）。selectedAgentId 是全局 sticky 选择，
// 切会话不重置。Agent 列表不再在 UI 渲染（见 AgentPanel 改造），但 agents 数据
// 本身仍在 MainView 内部持有，供 selectedAgent 计算 & 会话 session 解析用。
//
// 备注：会话级「托管」(takeover) 已被产品下线 —— 接管按钮、对话接管 banner、
// session.auto_mode 推到 2 的客户端逻辑全部移除，仅保留服务端回写的 auto_mode
// 读取，让 ChatMain 的模式提示能跟随服务端状态。
const selectedAgentId = ref(null)

// Session state — created/looked-up when conversation is selected,
// updated when agent is switched, and used for takeover toggle.
const currentSession = ref(null)  // { session_id, unique_name, agent: {...}, auto_mode, ... }

// agentMsgBot 建议队列：session_id → [{ content, unique_name, msg_id }]
const pendingSuggestions = reactive({})
// 用户点 × 后，整个 tyn-agent-suggestions 关闭（按 session 记），
// 切换会话/会话重新产生建议时由 computed 自动恢复显示
const dismissedSuggestions = reactive({})

const selectedAgent = computed(
  () => agents.find((a) => a.id === selectedAgentId.value) || null
)
// 当前会话的 AI 辅助模式：0=不使用, 1=协同模式, 2=托管模式
const autoMode = computed(() => currentSession.value?.auto_mode ?? 0)
// 服务端推送的 session.auto_mode 仍由 ChatMain 读取（控制 head status tip
// 的 human/assist/auto 三态展示）。本地不再维护 takeoverByConv ——
// 客户端已无入口去推 auto_mode 到 2，按钮已下线。
// Data — agents. Conversation data is owned by Conversations.
const agents = reactive([])
const agentsLoaded = ref(false)

// dev/test 期间临时 mock AGENT_MYBOTS 的返回值。结构 / 字段 / 头像 url
// 全部按生产环境真实接口响应造，接真接口时只把下方 await new Promise(...) 那一行
// 改回 `await get(SERVER_PATH.AGENT_MYBOTS)`，再删掉这个常量即可。
const __MOCK_AGENTS__ = {
  code: 0,
  msg: 'success',
  data: {
    items: [
      {
        bot_id: 'gcWkNn85ZSS',
        unique_name: 'gcwknn85zss',
        nickname: '小柚天气',
        display_name: '小柚天气',
        avatar: 'https://snailchat-file.oss-ap-southeast-1.aliyuncs.com/avatars/nwm6fxqt2aeebhb7/1782181828062_eTFkRX847lV.webp',
        avatar_url: 'https://snailchat-file.oss-ap-southeast-1.aliyuncs.com/avatars/nwm6fxqt2aeebhb7/1782181828062_eTFkRX847lV.webp',
        greeting: '嗨，我是小天～告诉我你想看哪个城市的天气，我来帮你查。',
        status: 'trained',
        active_version: 'v1',
        suggestions: [
          '好的，请问您想查询哪个城市的天气？我可以为您实时查询最近 24 小时的天气情况。',
          '收到～告诉我城市名就行，比如「上海」「北京」，也可以发位置给我。',
          '目前支持国内 300+ 主要城市，未来会扩展到海外城市，敬请期待。'
        ]
      },
      {
        bot_id: '5zYkpWbFuhB',
        unique_name: 'a5zykpwbfuhb',
        nickname: 'juggle 小问',
        display_name: 'juggle 小问',
        avatar: 'https://snailchat-file.oss-ap-southeast-1.aliyuncs.com/avatars/nwm6fxqt2aeebhb7/1781687976720_WTFA1lbv5DR.webp',
        avatar_url: 'https://snailchat-file.oss-ap-southeast-1.aliyuncs.com/avatars/nwm6fxqt2aeebhb7/1781687976720_WTFA1lbv5DR.webp',
        greeting: '欢迎使用 juggleIM',
        status: 'trained',
        active_version: 'v1',
        suggestions: [
          '您好，我是 juggleIM 智能助手，请问有什么可以帮您？',
          '请稍等，我这边帮您查一下相关信息。',
          '如果您愿意，可以再详细描述一下遇到的问题，方便我更准确地帮您。'
        ]
      },
      {
        bot_id: 'Gj4QLs9YFwC',
        unique_name: 'gj4qls9yfwc',
        nickname: '小方糖～',
        display_name: '小方糖～',
        avatar: 'https://snailchat-file.oss-ap-southeast-1.aliyuncs.com/avatars/nwm6fxqt2aeebhb7/1781601261266_-sNQYI80MwI.webp',
        avatar_url: 'https://snailchat-file.oss-ap-southeast-1.aliyuncs.com/avatars/nwm6fxqt2aeebhb7/1781601261266_-sNQYI80MwI.webp',
        greeting: '你好',
        status: 'trained',
        active_version: 'v1',
        suggestions: [
          '嗨～我是小方糖，有什么可以帮到你的吗？',
          '在的呢，告诉我你遇到的问题，我陪你一起看看～',
          '已收到你发的内容啦，让我帮你想想办法 (◕‿◕)'
        ]
      }
    ],
    offset: '675NdFjkx'
  }
}

async function loadAgents() {
  if (agentsLoaded.value) return
  try {
    // TODO(接入): 走真接口时把这一行改回 `const res = await get(SERVER_PATH.AGENT_MYBOTS)`
    const res = await new Promise((resolve) => setTimeout(() => resolve(__MOCK_AGENTS__), 50))
    if (res?.code === 0 && Array.isArray(res.data?.items)) {
     const list = res.data.items
      //  .filter(item => item.status === 'trained' && item.active_version)
       .filter(item => item.status)
       .map((item) => ({
      id: item.bot_id,
      unique_name: item.unique_name,
      name: item.display_name,
      role: item.greeting || '',     
      emoji: item.avatar_url || '🤖',  
      suggestions: item.suggestions || []  
    }))
    agents.push(...list)
      agentsLoaded.value = true
    }
  } catch (e) {
    console.warn('[MainView] fetch agents failed', e)
  }
}

const showCreateAgent = ref(false)
const showLogoutModal = ref(false)


// "Nothing selected" state — no conversation AND no group. Used to swap
// the right two panes (Chat + Agent) for a centered "pick a conversation"
// placeholder. We keep the left sidebar visible so the user has something
// concrete to click on.
const hasNoSelection = computed(
  () => !currentConversation.value
)

// 已分配的会话 —— tags 是对象数组 [{id, name, type}, ...]，
// 所以用 some(t => t.id === 'assigned') 判断；之前按字符串 includes('assigned')
// 永远返 false，导致分配之后所有依赖 isAssignedConversation 的 v-if
// （如右侧 AgentPanel、发送按钮的启用状态）都不刷新。
const isAssignedConversation = computed(() => {
  const tags = currentConversation.value?.tags
  if (!Array.isArray(tags) || tags.length === 0) return false
  return tags.some(t => t && t.id === 'assigned')
})

// 客户信息：派生自当前会话。AgentPanel 接收的 customer 必须非空，
// 会话未选中时整个面板不渲染（MainView 模板里 v-if 控制），所以这里
// null 也是合法的占位状态。
//
// 渠道（channel）按产品要求从会话的 tag 数组里读 —— 取 tags 中匹配
//   TICKET_GLOBAL_TAG.CHANNEL_WIDGET / CHANNEL_TELEGRAM / CHANNEL_JUGGLEIM
// 的那条 tag，回退到 c.platform 字符串再做映射（兼容早期 SDK 返回）。
// 不依赖 c.platform 直接读取：服务端开始往 tag 上推 channel 后，c.platform
// 字段会逐步废弃（见 docs/sprint-1-revised-backend.md §3.4）。
const currentCustomerInfo = computed(() => {
  const c = currentConversation.value
  if (!c) return null
  const name = c.name || c.conversationName || c.userName || c.displayName || '未命名客户'
  const tags = Array.isArray(c.tags) ? c.tags : []
  const channelTag = tags.find((t) => {
    const tagId = t?.id ?? t?.tag
    return tagId === TICKET_GLOBAL_TAG.CHANNEL_WIDGET
      || tagId === TICKET_GLOBAL_TAG.CHANNEL_TELEGRAM
      || tagId === TICKET_GLOBAL_TAG.CHANNEL_JUGGLEIM
      || tagId === TICKET_GLOBAL_TAG.CHANNEL_WATCHAPP
  })
  let channelKey = ''
  if (channelTag) {
    const tagId = channelTag.id ?? channelTag.tag
    if (tagId === TICKET_GLOBAL_TAG.CHANNEL_WIDGET) channelKey = PLATFORM.WEB
    else if (tagId === TICKET_GLOBAL_TAG.CHANNEL_TELEGRAM) channelKey = PLATFORM.TELEGRAM
    else if (tagId === TICKET_GLOBAL_TAG.CHANNEL_JUGGLEIM) channelKey = PLATFORM.JUGGLECHAT
  }
  // 回退：早期 SDK 还没把 channel 写进 tag 时，从 c.platform 推
  if (!channelKey) {
    const plat = (c.platform || c.platformKey || '').toLowerCase()
    if (plat === PLATFORM_TAG_ID.WEB) channelKey = PLATFORM.WEB
    else if (plat === PLATFORM_TAG_ID.TELEGRAM) channelKey = PLATFORM.TELEGRAM
    else if (plat === PLATFORM_TAG_ID.JUGGLECHAT) channelKey = PLATFORM.JUGGLECHAT
  }
  // 客户 id —— 在 jugglemate 的 IM 模型里，私聊会话的 conversationId 实际
  // 等于对端 userId（SDK 内部 conversationId = targetId），这就是后端
  // customer_id 在 IM 端的载体，/jmate/customers/tickets 接受这个值。
  // 兜底链：c.id → c._raw.targetId → c._raw.conversationId → c.userid → c.customerId。
  const raw = c._raw || {}
  const customerId = (
    c.id
    || raw.targetId
    || raw.conversationId
    || c.userid
    || c.customerId
    || ''
  )
  if (!customerId && typeof console !== 'undefined') {
    // 排查字段来源用：打一条警告，列出当前会话对象的可用字段，方便后端
    // 协议或 SDK 返回结构变更时定位。
    console.warn('[MainView.currentCustomerInfo] customerId 为空，会话字段:',
      { id: c.id, conversationId: c.conversationId, ticket_id: c.ticket_id,
        customerId: c.customerId, userid: c.userid,
        rawKeys: raw ? Object.keys(raw) : null })
  }
  return {
    id: customerId,
    name,
    initial: c.initial || name.charAt(0),
    subtitle: c.subtitle
      || (c.id ? String(c.id) : '')
      || (channelKey ? PLATFORM_META[channelKey]?.label : 'Web'),
    online: c.online !== false,
    platformColor: c.platformColor || '',
    avatar: c.avatar || c.portrait || '',
    platformKey: channelKey,
    channelKey,
    channelLabel: channelKey ? (PLATFORM_META[channelKey]?.label || channelKey) : '',
    channelColor: channelKey ? (PLATFORM_META[channelKey]?.color || '#6B7280') : '',
    unreadDot: Boolean(c.unreadDot)
  }
})

const currentMessages = computed(() => {
  return currentConversation.value?.messages || []
})

const currentSuggestions = computed(() => {
  // if (currentView.value === 'group') return []
  // 用户主动关掉过 → 本次会话内不再展示
  const sidForDismiss = currentSession.value?.session_id
  if (sidForDismiss && dismissedSuggestions[sidForDismiss]) return []

  const result = []

  // 模板建议（选中 agent 时）
  if (selectedAgent.value) {
    const first = selectedAgent.value.suggestions?.[0]
    if (first) {
      result.push({ agent: selectedAgent.value.name, text: first })
    }
  }

  // agentMsgBot 实时建议
  const sid = currentSession.value?.session_id
  if (sid && pendingSuggestions[sid]) {
    for (const s of pendingSuggestions[sid]) {
      const ag = agents.find(a => a.unique_name === s.unique_name)
      result.push({
        agent: ag?.name || s.unique_name,
        text: s.content,
        msg_id: s.msg_id
      })
    }
  }

  return result
})

// 当前会话的待处理 agent 建议
const currentPendingSuggestions = computed(() => {
  if (!currentSession.value?.session_id) return []
  const sid = currentSession.value.session_id
  return pendingSuggestions[sid] || []
})

// Handlers
function handleLogout() {
  showLogoutModal.value = true
}

function confirmLogout() {
  showLogoutModal.value = false
  userService.logout()
  router.push('/login')
}

function cancelLogout() {
  showLogoutModal.value = false
}

function handleConvoSelect(convo) {
  if (
    currentView.value === 'conversation' &&
    currentConvoId.value === convo.id
  ) {
    return
  }
  currentView.value = 'conversation'
  currentConvoId.value = convo.id
  currentConversation.value = convo
  currentSession.value = null  // reset — will be populated by lookup below
  // Step 1: 点击会话 → 查询 session 是否存在，回显 agent 状态
  loadAgents().then(() => lookupOrCreateSession(convo))
}

// 认领成功后：让 IM 会话列表重新拉一次（认领会改 IM 的 my_ticket /
// assigned tag，应该立刻反映到左侧 mine 视图）。返回 refresh() 的 promise，
// 调用方可以 await 等待「整列表重拉 + 未读数刷新」完成。
function refreshAfterClaim() {
  if (conversationsRef.value && typeof conversationsRef.value.refresh === 'function') {
    return conversationsRef.value.refresh()
  }
  return Promise.resolve()
}


function handleSuggestionReceived({ session_id, unique_name, content, msg_id }) {
  console.log('[MainView] suggestionReceived:', session_id, unique_name, content)
  // 存入建议队列
  if (!pendingSuggestions[session_id]) {
    pendingSuggestions[session_id] = []
  }
  pendingSuggestions[session_id].push({ content, unique_name, msg_id })
}

// 获取当前会话的待处理建议，并标记为已处理（调用后清除）
function popPendingSuggestions(sessionId) {
  const list = pendingSuggestions[sessionId]
  if (list && list.length > 0) {
    const copy = [...list]
    delete pendingSuggestions[sessionId]
    return copy
  }
  return []
}

function handleClearSuggestion(msgId) {
  // 按 msg_id 从当前会话的 pending 队列中移除
  const sid = currentSession.value?.session_id
  if (!sid || !pendingSuggestions[sid]) return
  pendingSuggestions[sid] = pendingSuggestions[sid].filter(s => s.msg_id !== msgId)
  if (pendingSuggestions[sid].length === 0) {
    delete pendingSuggestions[sid]
  }
}

function handleDismissSuggestions() {
  console.log('[MainView] handleDismissSuggestions')
  // 用户点 × 关闭整组 AI 建议：
  //   1) 清掉当前会话的实时建议（pendingSuggestions[sid]）
  //   2) 标记 dismissedSuggestions[sid] = true，挡住模板建议的展示
  //   模板建议会在重新选择 agent / 切换会话 / 后端新推送时被自然覆盖
  const sid = currentSession.value?.session_id
  if (!sid) return
  if (pendingSuggestions[sid]) delete pendingSuggestions[sid]
  dismissedSuggestions[sid] = true
}

async function lookupOrCreateSession(convo) {
  const convId = convo.conversationId || convo.id
  if (!convId) return
  const convType = String(convo.conversationType || '')
  const sessionId = convId + '_' + convType
  try {
    const res = await get(SERVER_PATH.AGENT_SESSION_LOOKUP, { session_id: sessionId })
    if (res?.code === 0 && res.data) {
      // 已存在 → 回显 agent 状态
      currentSession.value = res.data
      // 如果 session 绑定了 agent，同步 selectedAgentId 和 托管状态
      if (res.data.agent && res.data.agent.unique_name) {
        const ag = agents.find(a => a.unique_name === res.data.agent.unique_name)
        if (ag) {
          selectedAgentId.value = ag.id
        }
      }
      // 服务端下推的 auto_mode === 2 由 ChatMain 通过 :auto-mode prop 读取；
      // 本地不再维护 takeoverByConv —— 客户端已无入口推 auto_mode 到 2。
    } else if (res?.code === 0 && agents.length > 0) {
      // 不存在 → 用第一个 agent 立即创建 session
      const firstAg = agents[0]
      const createRes = await post(SERVER_PATH.AGENT_SESSION_CREATE, {
        conv_id: convId,
        conv_type: String(convo.conversationType || ''),
        unique_name: firstAg.unique_name,
        customer_id: convo.customerId || convo.userid || '',
        platform: convo.platform || 'jim',
        auto_mode: 0
      })
      if (createRes?.code === 0 && createRes.data) {
        currentSession.value = createRes.data
        selectedAgentId.value = firstAg.id
      }
    }
  } catch (e) {
    console.warn('[MainView] lookup session failed', e)
  }
}

async function handleConversationOp({ key, conversation }) {
  if (!juggle || !conversation) return
  const sdk = im
  const { UnreadTag } = sdk
  const cId = conversation.conversationId
  const cType = conversation.conversationType
  if (!cId) return
  try {
    if (key === 'markUnread') {
      conversation.unreadTag = UnreadTag.UNREAD
      if (conversation._raw) conversation._raw.unreadTag = UnreadTag.UNREAD
      await juggle.markUnread({
        conversationType: cType,
        conversationId: cId,
        unreadTag: UnreadTag.UNREAD
      })
    } else if (key === 'remove') {
      await juggle.removeConversation({ conversationType: cType, conversationId: cId })
      // If the removed conversation is the active one, clear the chat panel and session.
      if (currentConversation.value?.conversationId === cId) {
        currentConversation.value = null
        currentConvoId.value = null
        currentSession.value = null
      }
    }
  } catch (e) {
    console.warn('[MainView] conversation op failed', key, e)
  }
}

function handleGroupSelect(id) {
  currentView.value = 'group'
  currentConvoId.value = null
  currentConversation.value = null
  // Per-conversation 托管 state is not affected by switching into group
  // mode — the takeover is bound to a specific conversation, not to the
  // current view. The chat tip and banner just don't render in group
  // mode.
}

function handleFilterChange(f) {
  filter.value = f
}


async function handleClaimTicket(ticketId) {
  // Called from ChatMain's claim banner / header claim button
  if (!ticketId) {
    console.warn('[MainView] handleClaimTicket called without ticketId')
    return
  }
  try {
    await post(SERVER_PATH.TICKET_CLAIM(ticketId))

    // 0. 给当前会话打上 assigned + my_ticket 两个 tag。assign 在前 — 服务端
    //    拿到 assigned 之后，其他设备在 "未分配" 列表里就看不到这个会话了。
    //    my_ticket 跟 assigned 是相互独立的 tag 成员，所以要单独加一次。
    //    失败仅 warn — UI 上 ticket 状态已经是"处理中"了，不阻断主流程。
    const convForTag = currentConversation.value
    if (convForTag && convForTag.conversationId !== undefined) {
      void im.addConversationToAssignedTag(convForTag)
      void im.addConversationToMyTicketTag(convForTag)
    }

    // 1. 把当前会话的本地 status 切到 1（处理中），让 ChatMain 的响应式
    //    computed 立刻看到"已分配"，banner / 发送按钮 / 回车快速解锁。
    //    注意：tags 不在这里手 push —— SDK 的 addConversationsToTag 已经把
    //    assigned / my_ticket 落库，等下面 refreshOne() 拉回权威 raw 之后
    //    再统一回灌，避免本地和 SDK 数据分裂。
    const conv = currentConversation.value
    if (conv && conv.ticket_id === ticketId) {
      conv.status = 1  // 1 = 处理中
    }

    // 2. 发系统通知消息（保留原有行为）
    const user = currentUser.value
    if (conv && conv.conversationId && user) {
      const assignMsg = {
        conversationType: conv.conversationType,
        conversationId: conv.conversationId,
        name: MSG_NAME.TICKET_ASSIGN,
        content: JSON.stringify({
          ticket_id: ticketId,
          operator: {
            id: user.id,
            nickname: user.name || '用户',
            avatar: user.avatar || ''
          },
          assignee: {
            id: user.id,
            nickname: user.name || '用户',
            avatar: user.avatar || ''
          },
          assign_type: 0  // self-claim
        })
      }
      // Send via IM SDK
      const juggle = im.getCurrent()
      if (juggle && typeof juggle.sendMessage === 'function') {
        juggle.sendMessage(assignMsg).catch(e => {
          console.warn('[MainView] Failed to send ticket assign notification', e)
        })
      }
    }

    // 3. 刷新 IM 会话列表。同步给当前会话加 assigned + my_ticket tag 之后，
    //    mine 视图里应该立刻多出这一条。
    await refreshAfterClaim()

    // 3.5 用 SDK 拉一次单条最新 conversation（带新的 tags / status / unreadCount
    //     等），替换掉 imConversations 列表里这一行，并把 currentConversation
    //     也同步刷新 —— 这样 ChatMain 里 isAssignedConversation
    //     （基于 tags.some(t=>t.id==='assigned')）和 unassigned 视图
    //     （基于 exceptTag=assigned 后端过滤）都按权威数据刷新。
    if (conv) {
      const refreshed = await conversationsRef.value?.refreshOne?.(conv)
      if (refreshed) {
        // refreshOne 内部已经 upsert 了列表项；这里再把 currentConversation
        // 指向最新的 wrapper，让 ChatMain 立即看到新 tags / status。
        currentConversation.value = refreshed
      }
    }

    // 4. 给这个会话建立/查找一个 agent session，让大模型建议链路跟上
    if (conv) {
      await lookupOrCreateSession(conv)
    }

    // toast.success('工单已分配给您')
  } catch (e) {
    console.error('[MainView] Claim ticket failed', e)
    // toast.error('认领失败，请稍后重试')
  }
}

// === 工单转移 ===
// 契约：最新 curl 示例（见发起方）
// body  : { assignee_id }   —— 最小字段，只传目标 user_id
//        （不带 to_assignee_name / note / expected_version）
// resp  : { code, data?: { ... } }
// 错误码同原来：
//   17012 - version 不匹配
//   17018 - 目标用户不存在/不可达
//   17019 - 目标 == 自己
// 副作用（前端可立即生效）：
//   * 本地 conv.assignee_id/name/version 同步
//   * 释放自己 my_ticket tag（这是工单从 mine 视图消失的关键）
//   * 发送 jgm:ticketreassign 通知（IM 广播）
//   * 触发会话列表 refresh
async function handleTransferTicket(payload) {
  const { ticket_id, assignee_id, to_assignee_name, note } = payload
  const conv = currentConversation.value
  if (!ticket_id || !assignee_id) {
    console.warn("[MainView] handleTransferTicket: missing ticket_id / assignee_id")
    return
  }
  try {
    // 1) POST 后端（先尝试，不阻塞前端内存态）
    let resp = null
    try {
      resp = await post(SERVER_PATH.TICKET_TRANSFER(ticket_id), {
        assignee_id
      })
    } catch (e) {
      console.warn("[MainView] TICKET_TRANSFER HTTP failed (backend likely not yet ready)", e)
    }

    // 2) 服务端错误码检查（仅在 resp.code 存在时校验）
    if (resp && resp.code !== undefined && resp.code !== 0) {
      const map = {
        17012: "工单状态已被他人修改，请刷新后重试",
        17018: "目标客服不在线或不可达",
        17019: "不能把工单转给自己"
      }
      const msg = map[resp.code] || ("工单转移失败 (" + resp.code + ")")
      console.warn("[MainView] transfer rejected", resp.code, msg)
      chatMainRef.value?.notifyTransferResult?.({ ok: false, message: msg })
      return
    }

    // 3) 本地 wrapper 同步
    if (conv && conv.ticket_id === ticket_id) {
      conv.assignee_id = assignee_id
      conv.assignee_name = to_assignee_name || ""
      if (resp?.data?.version !== undefined) conv.version = resp.data.version
      else conv.version = (conv.version || 0) + 1
    }

    // 4) 自己 my_ticket tag 释放
    if (conv) {
      void im.removeConversationFromMyTicketTag(conv)
    }

    // 5) 广播 jgm:ticketreassign
    const user = currentUser.value
    if (conv && conv.conversationId && user) {
      const juggle = im.getCurrent()
      if (juggle && typeof juggle.sendMessage === "function") {
        const msgPayload = {
          conversationType: conv.conversationType,
          conversationId: conv.conversationId,
          name: MSG_NAME.TICKET_REASSIGN,
          content: JSON.stringify({
            ticket_id,
            from: { id: user.id, name: user.name || "用户" },
            to:   { id: assignee_id, name: to_assignee_name || "" },
            note: note || ""
          })
        }
        juggle.sendMessage(msgPayload).catch(e => {
          console.warn("[MainView] failed to send ticket_reassign", e)
        })
      }
    }

    // 6) 刷新会话列表 + 当前 wrapper
    if (conversationsRef.value && typeof conversationsRef.value.refresh === "function") {
      await conversationsRef.value.refresh()
    }
    if (conv) {
      const refreshed = await conversationsRef.value?.refreshOne?.(conv)
      if (refreshed) currentConversation.value = refreshed
    }

    // 7) 通知 ChatMain 关闭弹层
    chatMainRef.value?.notifyTransferResult?.({
      ok: true,
      to_assignee_name: to_assignee_name || ""
    })
  } catch (e) {
    console.error("[MainView] handleTransferTicket unexpected", e)
    chatMainRef.value?.notifyTransferResult?.({ ok: false, message: "工单转移异常" })
  }
}

function handleSend(text) {
  if (!text.trim()) return

  if (currentView.value === 'conversation' && currentConversation.value) {
    currentConversation.value.messages.push({ type: 'outgoing', text })
  }
}

function handleUseSuggestion(suggestion) {
  // Intentionally a no-op. ChatMain now writes the suggestion into its own
  // composer state on click, so the input updates reactively without us
  // poking the DOM. This handler is kept as a hook for future parent-level
  // behavior (e.g. dismissing the suggestion list) without changing the
  // emit contract.
  void suggestion
}

function handleDeselectAgent() {
  // Reserved hook — kept for future flows that want to clear the
  // selectedAgentId from inside the chat (e.g. a per-message "remove Agent
  // context" action). Currently unused.
  selectedAgentId.value = null
}

async function handleSelectAgent(id) {
  // 列表行点击 = 切换当前会话的写作 agent（仅改 unique_name + selectedAgentId），
  // **不**动 mode。mode 改由专门的"托管 / 取消托管"按钮触发。
  // 当前会话已托管给 agent X，再点列表里 agent Y：
  //   - Y !== X：切 agent 风格，但接管保持（hosted 行变 Y）
  //   - Y === X：保持
  if (id === null) {
    selectedAgentId.value = null
    return
  }

  const ag = agents.find(a => a.id === id)
  if (!ag) return
  const conv = currentConversation.value
  if (!conv) return
  const convId = conv.conversationId || conv.id
  if (!convId) return

  selectedAgentId.value = id

  if (currentSession.value?.session_id) {
    try {
      const res = await post(SERVER_PATH.AGENT_SESSION_UPDATE_AGENT(currentSession.value.session_id), {
        unique_name: ag.unique_name
      })
      if (res?.code === 0 && res.data) {
        currentSession.value = res.data
      }
    } catch (e) {
      console.warn('[MainView] update session agent failed', e)
    }
  } else {
    // Session 不存在 → 创建（mode 默认 0 人工，由"托管"按钮或后续交互推）
    try {
      const res = await post(SERVER_PATH.AGENT_SESSION_CREATE, {
        conv_id: convId,
        conv_type: String(conv.conversationType || ''),
        unique_name: ag.unique_name,
        customer_id: conv.customerId || conv.userid || '',
        platform: conv.platform || 'jim',
        auto_mode: 0
      })
      if (res?.code === 0 && res.data) {
        currentSession.value = res.data
      }
    } catch (e) {
      console.warn('[MainView] create session failed', e)
    }
  }
}


function handleCreateAgent(data) {
  agents.push({
    id: 'a' + (agents.length + 1),
    name: data.name || '新 Agent',
    role: data.style,
    emoji: ['🧠', '🎯', '✨', '⚡', '🔮'][agents.length % 5],
    suggestions: [
      '这是我的第一条建议回复，基于角色设定自动生成。',
      '第二条候选回复方案，你可以点击直接使用。',
      '第三条智能建议，覆盖不同的回复角度和语气。'
    ]
  })
}

</script>

<template>
  <div class="app-container">
    <div class="titlebar-drag"></div>
    <NavSidebar
      :active-nav="activeNav"
      :inbox-badge="inboxBadge"
      :stats="{ sessionsToday: null, satisfaction: null, avgResponseSec: null }"
      @nav-change="handleNavChange"
      @open-settings="showUserDrawer = true"
      @logout="handleLogout"
      @status-change="handleStatusChange"
    />

    <!-- 会话面板：二级过滤侧栏 + 会话列表（IM 会话，过滤维度统一在 Conversations 内部） -->
    <Conversations
      ref="conversationsRef"
      :active-id="currentView === 'conversation' ? currentConvoId : null"
      @select="handleConvoSelect"
      @conversation-op="handleConversationOp"
      @suggestion-received="handleSuggestionReceived"
    />

    <ChatMain
      ref="chatMainRef"
      v-if="!hasNoSelection"
      :conversation="currentView === 'conversation' ? currentConversation : null"
      :messages="currentMessages"
      :suggestions="currentSuggestions"
      @dismiss-suggestions="handleDismissSuggestions"
      :is-group="currentView === 'group'"
      :selected-agent="selectedAgent"
      :auto-mode="autoMode"
      :pending-suggestions="currentPendingSuggestions"
      :assigned="isAssignedConversation"
      @send="handleSend"
      @use-suggestion="handleUseSuggestion"
      @clear-suggestion="handleClearSuggestion"
      @claim-ticket="handleClaimTicket"
      @transfer-ticket="handleTransferTicket"
    />

    <AgentPanel
      v-if="!hasNoSelection && currentCustomerInfo"
      :customer="currentCustomerInfo"
      :is-assigned="isAssignedConversation"
      :agents="agents"
      :selected-agent-id="selectedAgentId"
      @select-agent="handleSelectAgent"
    />

    <main v-if="hasNoSelection" class="jm-empty">
      <div class="jm-empty__inner">
        <div class="jm-empty__art" aria-hidden="true">
          <svg viewBox="0 0 120 88" fill="none">
            <!-- 主气泡 -->
            <path d="M16 18a8 8 0 0 1 8-8h52a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8H44l-12 10v-10h-8a8 8 0 0 1-8-8V18z" fill="#E6F2FF" stroke="#0080FF" stroke-width="1.6"/>
            <circle cx="36" cy="34" r="2.4" fill="#0080FF"/>
            <circle cx="50" cy="34" r="2.4" fill="#0080FF"/>
            <circle cx="64" cy="34" r="2.4" fill="#0080FF"/>
            <!-- 副气泡 -->
            <path d="M52 56a6 6 0 0 1 6-6h44a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6h-6v8l-10-8h-28a6 6 0 0 1-6-6V56z" fill="#F2F8FF" stroke="#CBD5E1" stroke-width="1.4"/>
            <rect x="62" y="66" width="30" height="3" rx="1.5" fill="#CBD5E1"/>
            <rect x="62" y="73" width="20" height="3" rx="1.5" fill="#CBD5E1"/>
          </svg>
        </div>
        <h2 class="jm-empty__title">选择会话开始沟通</h2>
        <p class="jm-empty__desc">从左侧列表里挑一个会话，聊天面板会显示对应的客户、历史消息和 AI 建议。</p>
        <ul class="jm-empty__tips">
          <li><span class="dot"></span>支持视图过滤：<b>我的 / 待分配 / 全部</b></li>
          <li><span class="dot"></span>支持按平台筛选：<b>Web / Telegram / JuggleChat</b></li>
          <li><span class="dot"></span>搜索框可按客户名、关键词快速定位</li>
        </ul>
      </div>
    </main>

    <UserDrawer
      :show="showUserDrawer"
      :user-name="currentUserName"
      :user-id="currentUserId"
      :user-role="currentUserRole"
      @close="showUserDrawer = false"
      @logout="handleLogout"
    />

    <AgentCreateSlideover
      :show="showCreateAgent"
      @close="showCreateAgent = false"
      @create="handleCreateAgent"
    />

    <Modal
      :show="showLogoutModal"
      title="退出登录"
      message="确定要退出登录吗？"
      confirm-text="确认"
      cancel-text="取消"
      :danger="true"
      @confirm="confirmLogout"
      @cancel="cancelLogout"
    />

    <Toast />
  </div>
</template>

<style scoped>
</style>
