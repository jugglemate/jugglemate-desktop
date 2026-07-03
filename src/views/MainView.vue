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
import { MSG_NAME, SESSION_FILTER } from '../common/enum'

const router = useRouter()
const ticketListRef = ref(null)
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

// 收件箱未读数：当前 Conversations 组件不向上抛总数，暂占位为 0
// TODO: Conversations 通过 defineExpose 或 emit('count-change', n) 上抛
const inboxBadge = computed(() => 0)

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
// Two independent Agent-related states. Keep them separate on purpose:
//   - selectedAgentId: which Agent's style the operator wants to write in.
//     Drives the suggestion area (the single reply card shown above the
//     composer). Toggled by clicking the Agent row body. Global — survives
//     a conversation switch (sticky voice).
//   - takeoverByConv: per-conversation map of { conversationKey → agentId }
//     tracking which Agent is "driving" each conversation. The chat tip +
//     takeover banner read this for the *current* conversation only. Any
//     number of conversations can be in 托管 at once, each driven by a
//     (possibly different) Agent — they're surfaced in the sidebar's
//     "接管中" filter.
//
// They are NOT coupled. You can pick an Agent to write in its voice
// without handing the conversation over, and you can hand over a
// conversation to an Agent without necessarily using its reply as a draft.
const selectedAgentId = ref(null)
const takeoverByConv = reactive(new Map())  // Map<convKey, { conversation, agentId }>

// Session state — created/looked-up when conversation is selected,
// updated when agent is switched, and used for takeover toggle.
const currentSession = ref(null)  // { session_id, unique_name, agent: {...}, auto_mode, ... }

// agentMsgBot 建议队列：session_id → [{ content, unique_name, msg_id }]
const pendingSuggestions = reactive({})

const selectedAgent = computed(
  () => agents.find((a) => a.id === selectedAgentId.value) || null
)
// 当前会话的 AI 辅助模式：0=不使用, 1=协同模式, 2=托管模式
const autoMode = computed(() => currentSession.value?.auto_mode ?? 0)
// Agent 面板模式：'off' | 'collaborative' | 'managed'
//   off           = 人工回复（不显式标注，列表行无 active 态）
//   collaborative = 协助模式（agent 给出建议，运营手发）
//   managed       = 托管模式（agent 自动接管会话）
const agentPanelMode = computed(() => {
  if (autoMode.value === 2) return 'managed'
  if (autoMode.value === 1) return 'collaborative'
  return 'off'
})
const takenOverAgent = computed(() => {
  if (!currentConversation.value) return null
  const key = getConvKeyForTakeover(currentConversation.value)
  if (!key) return null
  const entry = takeoverByConv.get(key)
  if (!entry) return null
  return agents.find((a) => a.id === entry.agentId) || null
})
// Same lookup as takenOverAgent, but returns the raw id — used to drive
// the AgentPanel's "hosted" indicator (which Agent row gets the 托管中
// pill), which expects an id, not an agent object.
// 显式 ref + 触发器，绕开 reactive Map 反应性可能的边界情况。
//   takeoverVersion 在 setTakeover / clearTakeover / 切会话时 ++，让 computed 必然重算。
//   currentTakenOverAgentId 仍然只读 takeoverByConv，但版本号变化是依赖。
const takeoverVersion = ref(0)
const currentTakenOverAgentId = computed(() => {
  // 把 takeoverVersion 放进依赖追踪
  void takeoverVersion.value
  if (!currentConversation.value) return null
  const key = getConvKeyForTakeover(currentConversation.value)
  if (!key) return null
  return takeoverByConv.get(key)?.agentId || null
})
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
        active_version: 'v1'
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
        active_version: 'v1'
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
        active_version: 'v1'
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

// 「还是未认领工单」的会话。认领成功后 status 会被推到 1（处理中），
// 这个 computed 自动变 false — 右侧 AgentPanel 就跟着出来了，ChatMain
// 也不再走「未认领分支」（banner 隐藏、发送按钮可用、回车恢复）。
// 注意不要只看 isTicket — 认领之后的会话 isTicket 还是 true，但已经是普通会话了。
const isTicketConversation = computed(
  () => currentConversation.value?.isTicket === true && currentConversation.value?.status === 0
)

// 客户信息：派生自当前会话。AgentPanel 内部还有 mock 兜底，
// 所以这里 null 也是合法的（占位 + 未选中态）。
const currentCustomerInfo = computed(() => {
  const c = currentConversation.value
  if (!c) return null
  const name = c.name || c.conversationName || c.userName || c.displayName || '未命名客户'
  return {
    name,
    initial: c.initial || name.charAt(0),
    subtitle: c.subtitle
      || (c.id ? String(c.id) : '')
      || (c.platform ? String(c.platform) : 'Web'),
    online: c.online !== false,
    platformColor: c.platformColor || '',
    avatar: c.avatar || c.portrait || '',
    platformKey: (c.platform || c.platformKey || '').toLowerCase(),
    unreadDot: Boolean(c.unreadDot)
  }
})

const currentMessages = computed(() => {
  return currentConversation.value?.messages || []
})

const currentSuggestions = computed(() => {
  if (currentView.value === 'group') return []
  // 托管中 → 隐藏建议。Agent 已经在自动接管了，运营不需要从候选回复里
  // 挑一条手发，建议区会让输入区产生无意义的"高度占位"。
  if (takenOverAgent.value) return []

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
  // 切会话触发一次重算：让 currentTakenOverAgentId 立刻反映新会话的 takeover 状态
  takeoverVersion.value++
  // Step 1: 点击会话 → 查询 session 是否存在，回显 agent 状态
  loadAgents().then(() => lookupOrCreateSession(convo))
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
      if (res.data.auto_mode === 2 && res.data.agent) {
        const ag = agents.find(a => a.unique_name === res.data.agent.unique_name)
        if (ag) {
          setTakeover(convo, ag.id)
        }
      }
    } else if (res?.code === 0 && agents.length > 0) {
      // 不存在 → 用第一个 agent 立即创建 session
      const firstAg = agents[0]
      const createRes = await post(SERVER_PATH.AGENT_SESSION_CREATE, {
        conv_id: convId,
        conv_type: String(convo.conversationType || ''),
        unique_name: firstAg.unique_name,
        customer_id: convo.customerId || convo.userid || '',
        platform: convo.platform || 'jim',
        auto_mode: 1
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
      // Also drop the local 托管 state for the removed conversation. The
      // server will clean up the tag membership as part of the deletion;
      // locally we just need to drop the Map entry so a future reconcile
      // pass doesn't try to re-add it.
      clearTakeoverForConv(cType, cId)
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

    // 1. 把当前会话从"未分配"切到"处理中" → 驱动 ChatMain 的
    //    isTicketUnassigned 变 false，自动隐藏认领 banner、放开发送按钮和回车
    const conv = currentConversation.value
    if (conv && conv.ticket_id === ticketId) {
      conv.status = 1  // 1 = 处理中
      // 同时把本地会话的 isTicket 标记保留，避免左侧列表突然把这个会话当成普通会话
      // 但让 ChatMain 通过 status 判断走"已分配"分支（隐藏 banner / 启用发送）
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

    // 3. 刷新未分配工单列表，让这条工单从"未分配"列表中消失
    if (ticketListRef.value?.refresh) {
      ticketListRef.value.refresh()
    }

    // 4. 切换 filter 到"我的" — 现在这个工单归我了，应该在"我的"列表里
    filter.value = SESSION_FILTER.MINE

    // 5. 给这个会话建立/查找一个 agent session，让大模型建议链路跟上
    if (conv) {
      await lookupOrCreateSession(conv)
    }

    // toast.success('工单已分配给您')
  } catch (e) {
    console.error('[MainView] Claim ticket failed', e)
    // toast.error('认领失败，请稍后重试')
  }
}

async function handleRevokeTakeover() {
  // Triggered by the chat takeover banner's "收回控制" button. Clears the
  // 托管 state for the *current* conversation and sets mode back to 协助.
  const conv = currentConversation.value
  if (!conv) return
  clearTakeover(conv)
  const sessionId = currentSession.value?.session_id
  if (sessionId) {
    try {
      await post(SERVER_PATH.AGENT_SESSION_TAKEOVER(sessionId), { auto_mode: 1 })
      if (currentSession.value) {
        currentSession.value.auto_mode = 1
      }
    } catch (e) {
      console.warn('[MainView] revoke takeover API failed', e)
    }
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

function handleAgentPanelModeChange(mode) {
  const sessionId = currentSession.value?.session_id

  if (mode === 'managed' && selectedAgent.value && currentConversation.value) {
    const ag = selectedAgent.value
    handleTakeoverToggle(currentConversation.value, ag.id)
    if (sessionId) {
      post(SERVER_PATH.AGENT_SESSION_TAKEOVER(sessionId), { auto_mode: 2 })
        .then(res => {
          if (currentSession.value) currentSession.value.auto_mode = 2
        })
        .catch(e => console.warn('[MainView] set managed mode API failed', e))
    }
  } else if (mode === 'collaborative' && currentConversation.value) {
    clearTakeover(currentConversation.value)
    if (sessionId) {
      post(SERVER_PATH.AGENT_SESSION_TAKEOVER(sessionId), { auto_mode: 1 })
        .then(res => {
          if (currentSession.value) currentSession.value.auto_mode = 1
        })
        .catch(e => console.warn('[MainView] set collaborative mode API failed', e))
    }
  }
}

function handleTakeoverToggle(conversation, agentId) {
  if (!conversation || !agentId) return
  const key = getConvKeyForTakeover(conversation)
  if (takeoverByConv.has(key)) {
    clearTakeover(conversation)
  } else {
    setTakeover(conversation, agentId)
  }
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


// "托管"按钮：把当前 agent 设为会话的接管者，并把 session.auto_mode 推到 2。
// 流程：① 选中 agent（chat 切风格）→ ② 接管（setTakeover）→ ③ 通知后端。
function handleHostAgent(agentId) {
  const ag = agents.find(a => a.id === agentId)
  const conv = currentConversation.value
  if (!ag || !conv) return
  if (selectedAgentId.value !== agentId) {
    selectedAgentId.value = agentId
  }
  // 托管：先写本地 Map（AgentPanel 通过 currentTakenOverAgentId 立刻看到状态变化），
  // 再同步后端 session.auto_mode = 2。
  setTakeover(conv, ag.id)
  const sessionId = currentSession.value?.session_id
  if (sessionId) {
    post(SERVER_PATH.AGENT_SESSION_UPDATE_AGENT(sessionId), { unique_name: ag.unique_name })
      .then(res => { if (res?.code === 0 && res.data) currentSession.value = res.data })
      .catch(e => console.warn('[MainView] host-agent update session failed', e))
    post(SERVER_PATH.AGENT_SESSION_TAKEOVER(sessionId), { auto_mode: 2 })
      .then(res => { if (currentSession.value) currentSession.value.auto_mode = 2 })
      .catch(e => console.warn('[MainView] host-agent takeover api failed', e))
  }
}

// "取消托管"按钮：清掉当前会话的接管，把 session.auto_mode 拉回 1。
function handleUnhostAgent() {
  const conv = currentConversation.value
  if (!conv) return
  // 先清本地 Map 让 AgentPanel 立刻看到状态变化，再同步后端
  clearTakeover(conv)
  const sessionId = currentSession.value?.session_id
  if (sessionId) {
    post(SERVER_PATH.AGENT_SESSION_TAKEOVER(sessionId), { auto_mode: 1 })
      .then(res => { if (currentSession.value) currentSession.value.auto_mode = 1 })
      .catch(e => console.warn('[MainView] unhost-agent api failed', e))
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

function getConvKeyForTakeover(c) {
  if (!c) return ''
  const id = c.conversationId || c.id
  if (id === undefined || id === null) return ''
  return `${c.conversationType}_${id}`
}

function setTakeover(conversation, agentId) {
  if (!conversation || !agentId) return
  const key = getConvKeyForTakeover(conversation)
  if (!key) return
  const wasIn = takeoverByConv.has(key)
  takeoverByConv.set(key, { conversation, agentId })
  takeoverVersion.value++
  if (!wasIn) {
    void im.addConversationToTakeoverTag(conversation)
  }
}

function clearTakeover(conversation) {
  if (!conversation) return
  const key = getConvKeyForTakeover(conversation)
  if (!key) return
  if (!takeoverByConv.has(key)) return
  void im.removeConversationFromTakeoverTag(takeoverByConv.get(key).conversation)
  takeoverByConv.delete(key)
  takeoverVersion.value++
}

function clearTakeoverForConv(conversationType, conversationId) {
  // Used by handleConversationOp('remove') — drops a Map entry by
  // (type, id) when the conversation is being deleted. We don't fire a
  // SDK remove here because the server tears down the conversation (and
  // its tag memberships) as part of the deletion itself; we just need
  // the local Map to stop tracking it so the next reconcile pass doesn't
  // try to re-add a now-deleted conversation.
  if (conversationType === undefined || conversationType === null) return
  if (conversationId === undefined || conversationId === null) return
  const key = `${conversationType}_${conversationId}`
  takeoverByConv.delete(key)
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

    <!-- 会话面板：二级过滤侧栏 + 会话列表 -->
    <Conversations
      :active-id="currentView === 'conversation' ? currentConvoId : null"
      @select="handleConvoSelect"
      @conversation-op="handleConversationOp"
      @suggestion-received="handleSuggestionReceived"
    />

    <ChatMain
      v-if="!hasNoSelection"
      :conversation="currentView === 'conversation' ? currentConversation : null"
      :messages="currentMessages"
      :suggestions="currentSuggestions"
      :is-group="currentView === 'group'"
      :selected-agent="selectedAgent"
      :taken-over-agent="takenOverAgent"
      :auto-mode="autoMode"
      :pending-suggestions="currentPendingSuggestions"
      :ticket="isTicketConversation ? currentConversation : null"
      @send="handleSend"
      @use-suggestion="handleUseSuggestion"
      @revoke-takeover="handleRevokeTakeover"
      @clear-suggestion="handleClearSuggestion"
      @claim-ticket="handleClaimTicket"
    />

    <AgentPanel
      v-if="!hasNoSelection &amp;&amp; !isTicketConversation"
      :agents="agents"
      :selected-agent-id="selectedAgentId"
      :mode="agentPanelMode"
      :hosted-agent-id="currentTakenOverAgentId"
      :customer="currentCustomerInfo"
      @select-agent="handleSelectAgent"
      @host-agent="handleHostAgent"
      @unhost-agent="handleUnhostAgent"
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
          <li><span class="dot"></span>支持视图过滤：<b>我的 / 待分配 / AI 托管中 / 全部</b></li>
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
