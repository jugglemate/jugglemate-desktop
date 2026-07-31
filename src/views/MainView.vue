<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import NavSidebar from '../components/NavSidebar.vue'
import Conversations from '../components/Conversations.vue'
import ChatMain from '../components/ChatMain.vue'
import TicketManagementView from '../views/TicketManagementView.vue'
import StatisticsView from '../views/StatisticsView.vue'
import ContactsView from '../views/ContactsView.vue'
import ContactsEmptyView from '../views/ContactsEmptyView.vue'
import AgentPanel from '../components/AgentPanel.vue'
import UserDrawer from '../components/UserDrawer.vue'
import AgentCreateSlideover from '../components/AgentCreateSlideover.vue'
import Modal from '../components/Modal.vue'
import Toast from '../components/Toast.vue'
import im from '../common/im'
import userService from '../services/user'
import { SERVER_PATH, get, post } from '../services/api'
import {
  fetchActiveAgents, mapAgent, bindAgentToTicket, unbindAgentFromTicket, streamAgentChat
} from '../services/agent'
import {
  MSG_NAME, TICKET_GLOBAL_TAG, PLATFORM, PLATFORM_TAG_ID, PLATFORM_META
} from '../common/enum'

const router = useRouter()
const juggle = im.getCurrent()

// Current logged-in user (from localStorage, set by login)
const currentUser = computed(() => userService.getCurrentUser())
const currentUserName = computed(() => currentUser.value?.name || '')
// `role` 来自登录接口：2 = 管理员（在用户信息抽屉中显示"管理后台"入口），
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
  if (nav === activeNav.value) return
  clearChatState()
  activeNav.value = nav
  // 团队 / 数据 暂时没路由，先打日志
  if (nav === 'team' || nav === 'data') {
    console.log('[nav]', nav, '暂未实现路由')
  }
  // tickets：全量工单管理（仅管理员可见入口由 NavSidebar 兜底）
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

  // Agent 列表不在启动时拉 —— 等用户点开会话再触发（handleConvoSelect），
  // 避免一进首页就发请求，节省冷启动时间 + 后端压力。
})

// Conversation state (in-memory, no routing)
const currentView = ref('conversation') // 'conversation' | 'group'
const currentConvoId = ref(null)
const currentConversation = ref(null)
// 当前会话在 IM 端的真实 user id（取自 customers/info.source_id）
const currentPeerSourceId = ref('')

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
const currentSession = ref(null)
const currentSessionId = computed(() => pickTicketId(currentConversation.value))

// agentMsgBot 建议队列：session_id → [{ content, unique_name, msg_id }]
// 2026-07-22 重构：流式 AI 回复建议存储。
// 扁平字典，按 trace_id 一级索引；entry 上挂 sid 用于"当前会话过滤"。
// 设计要点：
//   - trace_id 来自 SSE started 事件；started 之前不存在 entry，UI 不显示。
//   - 多会话并发：每个会话的流各自带独立 trace_id，互不干扰。
//   - 不自动清理：用户点 × 才删除；切会话/关会话不清。
//   - 流完成（done/error/abort）后 entry.streaming = false，entry 持续展示。
// entry 形态：
//   { traceId, sid, agentId, content, streaming, startedAt }
const streamSuggestions = reactive({})

function clearChatState() {
  currentView.value = 'conversation'
  currentConvoId.value = null
  currentConversation.value = null
  currentPeerSourceId.value = ''
  currentSession.value = null
  selectedAgentId.value = null
  agents.splice(0, agents.length)
  agentsLoaded.value = false
  for (const key of Object.keys(streamSuggestions)) delete streamSuggestions[key]
}

const selectedAgent = computed(
  () => agents.find((a) => a.id === selectedAgentId.value) || null
)
// 当前会话的 AI 辅助模式：0=不使用, 1=协同模式, 2=托管模式
const autoMode = computed(() => bindedAgentId.value ? 1 : 0)
// 服务端推送的 session.auto_mode 仍由 ChatMain 读取（控制 head status tip
// 的 human/assist/auto 三态展示）。本地不再维护 takeoverByConv ——
// 客户端已无入口去推 auto_mode 到 2，按钮已下线。
// Data — agents. Conversation data is owned by Conversations.
const agents = reactive([])
const agentsLoaded = ref(false)

// 数据源：`GET /jmate/agentapi/agents/active`（新接口契约，2026-07-20 接入）。
// 旧接口 `GET /jmate/aibots/mybots` 不再使用 —— 字段名 / 结构完全不同，
// 且新接口不再返 suggestions[]。建议来源改为后端实时推送（agent_msg_id
// 路径已被废弃。AI 回复建议的当前来源是 streamAgentChat 流式响应，
// 见 handleAgentAssistSuggestion / streamSuggestions。
//
// 分页：pageSize 默认 20（接口允许 1~100）。当前实现只拉第 1 页，total
// 超过 pageSize 时由后续"加载更多"按钮触发翻页（暂未实现，留个 hook）。
// 2026-07-20 更新：
//   - 接收当前会话对象，提取 ticket_id（即接口里的 session_id）传给
//     /agents/active，列表项会回带 binded 用于回显当前选中。
//   - 不再 agentsLoaded 短路：切到不同会话时必须重拉（binded 状态是 per-ticket 的）。
//   - 重拉前先清空旧数组，避免旧会话的 binded 状态短暂闪烁到新会话上。
async function loadAgents(convo) {
  const conv = convo || currentConversation.value
  const sessionId = pickTicketId(conv)
  try {
    // hideSystemAgent 设为 false —— Juggle_Agent 是接口设计里的"系统兜底"，
    // 当前没有自己的 Agent 时它就是默认可选项，必须展示给用户。AgentPanel
    // 列表项上会通过 mapAgent 透传的 `isSystem: true` 加一个「系统」徽标。
    const { items } = await fetchActiveAgents({
      page: 1, pageSize: 20, hideSystemAgent: false, sessionId
    })
    if (!Array.isArray(items) || items.length === 0) {
      agents.splice(0, agents.length)   // 切换会话时清空旧列表
      agentsLoaded.value = true
      return
    }
    const list = items.map(mapAgent).filter(Boolean)
    agents.splice(0, agents.length)
    agents.push(...list)
    agentsLoaded.value = true
  } catch (e) {
    console.warn('[MainView] fetch agents failed', e)
  }
}

// 工单的 ticket_id 在不同来源下字段名不同。session_id 参数要求 ticket_ 开头，
// 所以这里要的是"工单 ID"，不是 IM conversationId。
//   - currentConversation.value.ticket_id   列表项已 map 出来的工单 ID
//   - currentConversation.value._raw?.ticketId
//   - currentConversation.value.conversationId  兜底（私聊时 conversationId == ticket_id）
function pickTicketId(conv) {
  if (!conv) return null
  return conv.ticket_id || conv?._raw?.ticketId || conv.conversationId || conv.id || null
}

// 当前会话"已绑定"的 Agent。列表里 binded===true 最多 1 项（接口契约）。
// 这也是 AgentPanel 卡片选中态的唯一来源：bindedAgentId 变化 → selectedAgentId 跟着变。
const bindedAgentId = computed(
  () => agents.find((a) => a && a.binded)?.id || null
)

// 让 selectedAgentId 跟着"服务端绑定"走。bindedAgentId 是 ground truth，
// selectedAgentId 仍然承担"UI 内部选中态"的角色（依赖它的 selectedAgent
// 计算属性在 ChatMain 里用作模式文案/header 状态）。这样旧的 selectedAgent
// 派生链不破，回显和切换都只跟 bindedAgentId 对齐。
//   - bindedAgentId 有值 → 同步到 selectedAgentId（回显/换绑后）
//   - bindedAgentId 为 null 且 selectedAgentId 不是当前会话绑定的 → 清空
//     （切换到没有任何绑定 agent 的会话时）
watch(bindedAgentId, (next) => {
  if (next) {
    selectedAgentId.value = next
  } else if (selectedAgentId.value) {
    selectedAgentId.value = null
  }
})

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

// 当前会话的流式建议列表（按 trace_id 顺序）。
const currentSessionStreamSuggestions = computed(() => {
  console.log('[MainView] currentSessionStreamSuggestions ------------currentSessionId.value', currentSessionId.value)
  const sid = currentSessionId.value
  if (!sid) return []
  console.log('[MainView] currentSessionStreamSuggestions ------------222222')
  // 遍历 reactive dict 时 Object.values 会触发 reactive getter
  // → computed 自动追踪每个 entry.content / streaming 变化。
  const entries = Object.values(streamSuggestions)
    .filter((entry) => entry && entry.sid === sid)
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
  console.log('[MainView] currentSessionStreamSuggestions ------------entries', entries)
  return entries
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
  loadAgents(convo)
}

// 联系人选中 → 构造一个形状兼容的 conversation 对象喂给 ChatMain
//   conversationType = PRIVATE (1)，targetId = userId
function handleContactSelect(member) {
  // 真实接口字段是 user_id（不是 id），兜底兼容
  const userId = member?.user_id || member?.id
  if (!userId) return
  const fakeConv = {
    id: userId,
    conversationId: userId,
    conversationType: juggle?.ConversationType?.PRIVATE ?? 1,
    name: member.nickname,
    conversationTitle: member.nickname,
    portrait: member.avatar || '',
    conversationPortrait: member.avatar || '',
    platform: '',
    tags: [],
    messages: [],
    unread: 0,
    unreadTag: 0,
    isTop: false,
    isTicket: false,
    status: undefined,
    ticket_id: undefined,
    // _raw.targetId 是 ChatMain 用来定位 IM 端 user 的关键字段
    _raw: { targetId: userId, member }
  }
  currentView.value = 'conversation'
  currentConvoId.value = fakeConv.id
  currentConversation.value = fakeConv
  currentPeerSourceId.value = userId
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
// ============================================================================
// 流式 AI 回复建议（2026-07-22 重构）
// ============================================================================
// 触发链：ChatMain 收客户消息 → emit('requestAgentSuggestion') → 下面的
// handleAgentAssistSuggestion → streamAgentChat → 按 SSE 事件更新
// streamSuggestions[traceId] → currentSessionStreamSuggestions computed 过滤
// 当前会话 → ChatMain 通过 :stream-suggestions prop 渲染。
//
// 关键约束：
//   - trace_id 是流的标识符，started 事件首次带回，前端用 trace_id 作为
//     streamSuggestions 的 key；started 之前不存在 entry。
//   - 多会话并发：每个流各自带独立 trace_id，互不干扰。
//   - 不自动清理：用户点 × 才删除（handleClearStreamSuggestion）。
// ============================================================================

async function handleAgentAssistSuggestion({ agentId, customerMessage }) {
  const sid = currentSessionId.value
  const userId = currentUser.value?.id
  if (!sid) {
    console.warn('[MainView] handleAgentAssistSuggestion: no currentSessionId, skip')
    return
  }
  if (!agentId || !userId || !customerMessage) {
    console.warn('[MainView] handleAgentAssistSuggestion: missing fields', { agentId, userId, hasMsg: !!customerMessage })
    return
  }
  // 不预 push 占位：started 之前不存在 entry，UI 不显示；
  // started 拿到 trace_id 后再创建 entry，token / done 按 trace_id 找 entry。
  try {
    await streamAgentChat({
      agentId,
      userId,
      message: customerMessage,
      onEvent: (ev) => {
        if (!ev) return
        if (ev.event === 'started') {
          const traceId = ev.trace_id || ev.traceId
          if (!traceId) return
          if (streamSuggestions[traceId]) return  // 重复 started 幂等
          streamSuggestions[traceId] = {
            traceId,
            sid,
            agentId,
            content: '',
            streaming: true,
            startedAt: Date.now()
          }
        } else if (ev.event === 'token') {
          const traceId = ev.trace_id || ev.traceId
          const entry = traceId && streamSuggestions[traceId]
          if (!entry) return
          if (ev.payload?.token) entry.content += ev.payload.token
        } else if (ev.event === 'done') {
          const traceId = ev.trace_id || ev.traceId
          const entry = traceId && streamSuggestions[traceId]
          if (!entry) return
          if (ev.payload?.answer) entry.content = ev.payload.answer
          entry.streaming = false
        } else if (ev.event === 'error') {
          const traceId = ev.trace_id || ev.traceId
          const entry = traceId && streamSuggestions[traceId]
          if (entry) entry.streaming = false
        }
      }
    })
    // 流结束兜底：把 sid 匹配的所有 streaming entry 关掉
    for (const entry of Object.values(streamSuggestions)) {
      if (entry && entry.streaming && entry.sid === sid) entry.streaming = false
    }
  } catch (e) {
    if (e?.code === 'aborted') {
      console.log('[MainView] streamAgentChat aborted')
    } else {
      console.warn('[MainView] streamAgentChat failed', e)
    }
    for (const entry of Object.values(streamSuggestions)) {
      if (entry && entry.streaming && entry.sid === sid) entry.streaming = false
    }
  }
}

// 用户点 ×：按 trace_id 删除一条流式建议。
function handleClearStreamSuggestion(traceId) {
  if (!traceId) return
  delete streamSuggestions[traceId]
}

// 用户点 header ×：清掉当前会话的全部流式建议（按 sid 过滤）。
function handleClearAllStreamSuggestions() {
  const sid = currentSessionId.value
  if (!sid) {
    // 没有当前会话就整体清空，保留兜底。
    for (const k of Object.keys(streamSuggestions)) delete streamSuggestions[k]
    return
  }
  for (const [k, v] of Object.entries(streamSuggestions)) {
    if (v && v.sid === sid) delete streamSuggestions[k]
  }
}

// ChatMain 收到新消息时调：按当前 filter 重拉会话列表。
//   防御 conversationsRef 未挂载 / refresh 缺失，做静默 no-op。
async function handleConversationChanged() {
  if (conversationsRef.value && typeof conversationsRef.value.refresh === 'function') {
    try {
      await conversationsRef.value.refresh()
    } catch (e) {
      console.warn('[MainView] conversations refresh failed', e)
    }
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
    // 1) POST 后端
    const resp = await post(SERVER_PATH.TICKET_TRANSFER(ticket_id), {
      assignee_id
    })

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
      await im.removeConversationFromMyTicketTag(conv)
    }

    // 5) 广播 jgm:ticketreassign
    // const user = currentUser.value
    // if (conv && conv.conversationId && user) {
    //   const juggle = im.getCurrent()
    //   if (juggle && typeof juggle.sendMessage === "function") {
    //     const msgPayload = {
    //       conversationType: conv.conversationType,
    //       conversationId: conv.conversationId,
    //       name: MSG_NAME.TICKET_REASSIGN,
    //       content: JSON.stringify({
    //         ticket_id,
    //         from: { id: user.id, name: user.name || "用户" },
    //         to:   { id: assignee_id, name: to_assignee_name || "" },
    //         note: note || ""
    //       })
    //     }
    //     juggle.sendMessage(msgPayload).catch(e => {
    //       console.warn("[MainView] failed to send ticket_reassign", e)
    //     })
    //   }
    // }

    // 6) 重新拉取当前筛选下的会话列表。转移后不再 refreshOne，
    // 否则会把已经不属于“我的工单”的当前会话重新插回列表。
    if (conversationsRef.value && typeof conversationsRef.value.refresh === "function") {
      await conversationsRef.value.refresh()
    }
    currentConversation.value = null
    currentConvoId.value = null
    currentPeerSourceId.value = ''
    currentSession.value = null

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
  // 2026-07-20 切换为新接口契约：
  //   1) POST /jmate/agentapi/agents/sessions/bind（换绑直接覆盖）
  //   2) 重拉 /agents/active?session_id=... 刷新 binded 状态
  //   3) bindedAgentId 派生回写 selectedAgentId（见 watcher），UI 自动同步选中态
  // 旧逻辑里"创建 / 更新 session"步骤已不再需要 —— bind 是 ground truth。
  // 2026-07-21：点已选中项 = 取消选中 → bind agentId='' 让后端解绑。
  const conv = currentConversation.value
  if (!conv) return
  const sessionId = pickTicketId(conv)
  if (!sessionId) return

  // 取消选中分支：当前已是选中态，再点同一项就是 toggle off
  if (id !== null && id === selectedAgentId.value) {
    const prev = selectedAgentId.value
    selectedAgentId.value = null
    try {
      await unbindAgentFromTicket(sessionId)
      await loadAgents(conv)
    } catch (e) {
      console.warn('[MainView] unbind agent failed', e)
      selectedAgentId.value = prev
    }
    return
  }

  if (id === null) {
    selectedAgentId.value = null
    return
  }

  const ag = agents.find(a => a.id === id)
  if (!ag) return

  // 乐观更新：先本地把 selectedAgentId 切过去，避免卡片点击后视觉延迟。
  // 失败时回滚（bind 接口错误码透传）。
  const prev = selectedAgentId.value
  selectedAgentId.value = id

  try {
    await bindAgentToTicket(sessionId, ag.id)
    // 重拉让 binded 与服务端对齐 —— bindedAgentId watcher 会再 sync 一次
    await loadAgents(conv)
  } catch (e) {
    console.warn('[MainView] bind agent failed', e)
    selectedAgentId.value = prev
  }
}

// customers/info 拉回最新数据后 → 用 detail.source_id 作为 IM peer userId
// 去刷在线状态。chat 会话 id 不等于 IM 端的 user id，必须走 source_id。
// 刷新后 userStatusCache 用 source_id 作 key；currentPeerSourceId 透给
// ChatMain 算 peerStatus，二者对齐。
function onCustomerInfoLoaded(payload) {
  const detail = payload?.detail
  if (!detail) return
  const sourceId = detail.source_id
  if (!sourceId) {
    console.warn('[MainView] customer-info-loaded: detail 缺 source_id')
    return
  }
  const sid = String(sourceId)
  currentPeerSourceId.value = sid
  im.invalidateUserStatus(sid)
  im.getUserStatus(sid).catch((e) => {
    console.warn('[MainView] refresh peer status failed', e)
  })
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

    <!-- 全量工单管理（仅管理员入口） -->
    <TicketManagementView
      v-if="activeNav === 'tickets'"
      @transfer-ticket="handleTransferTicket"
    />

    <!-- 数据统计（仅管理员入口） -->
    <StatisticsView
      v-if="activeNav === 'analytics'"
    />

    <!-- 联系人 -->
    <ContactsView
      v-if="activeNav === 'contacts'"
      @select="handleContactSelect"
    />

    <!-- 联系人模式占位：未选中成员时右侧显示空态（独立组件，不复用 jm-empty） -->
    <ContactsEmptyView v-if="activeNav === 'contacts' && hasNoSelection" />

    <!-- 会话面板：二级过滤侧栏 + 会话列表（IM 会话，过滤维度统一在 Conversations 内部） -->
    <Conversations
      v-if="activeNav !== 'tickets' && activeNav !== 'analytics' && activeNav !== 'contacts'"
      ref="conversationsRef"
      :active-id="currentView === 'conversation' ? currentConvoId : null"
      @select="handleConvoSelect"
      @conversation-op="handleConversationOp"
    />

    <ChatMain
      ref="chatMainRef"
      v-if="!hasNoSelection && activeNav !== 'tickets' && activeNav !== 'analytics'"
      :conversation="currentView === 'conversation' ? currentConversation : null"
      :peer-source-id="currentPeerSourceId"
      :messages="currentMessages"
      :is-group="currentView === 'group'"
      :selected-agent="selectedAgent"
      :auto-mode="autoMode"
      :stream-suggestions="currentSessionStreamSuggestions"
      :assigned="isAssignedConversation"
      @send="handleSend"
      @use-suggestion="handleUseSuggestion"
      @clear-stream-suggestion="handleClearStreamSuggestion"
      @clear-all-stream-suggestions="handleClearAllStreamSuggestions"
      @conversation-changed="handleConversationChanged"
      @claim-ticket="handleClaimTicket"
      @transfer-ticket="handleTransferTicket"
      @request-agent-suggestion="handleAgentAssistSuggestion"
    />

    <AgentPanel
      v-if="!hasNoSelection && currentCustomerInfo && activeNav !== 'tickets' && activeNav !== 'analytics' && activeNav !== 'contacts'"
      :customer="currentCustomerInfo"
      :is-assigned="isAssignedConversation"
      :agents="agents"
      :selected-agent-id="selectedAgentId"
      @select-agent="handleSelectAgent"
      @customer-info-loaded="onCustomerInfoLoaded"
    />

    <main v-if="hasNoSelection && activeNav !== 'tickets' && activeNav !== 'analytics' && activeNav !== 'contacts'" class="jm-empty">
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
