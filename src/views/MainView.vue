<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import NavSidebar from '../components/NavSidebar.vue'
import ConversationList from '../components/ConversationList.vue'
import ChatMain from '../components/ChatMain.vue'
import AgentPanel from '../components/AgentPanel.vue'
import UserDrawer from '../components/UserDrawer.vue'
import AgentCreateSlideover from '../components/AgentCreateSlideover.vue'
import Modal from '../components/Modal.vue'
import Toast from '../components/Toast.vue'
import im from '../common/im'
import userService from '../services/user'
import { SERVER_PATH, get, post } from '../services/api'

const router = useRouter()
const juggle = im.getCurrent()

// Current logged-in user (from localStorage, set by login)
const currentUser = computed(() => userService.getCurrentUser())
const currentUserName = computed(() => currentUser.value?.name || '用户')
const currentUserRole = computed(() => '客服坐席')

// Navigation & drawer state
const activeNav = ref('messages')
const showUserDrawer = ref(false)
const currentUserId = computed(() => currentUser.value?.id || 'user_12345678')

function handleNavChange(nav) {
  activeNav.value = nav
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
        // 同步通知主进程也通过 imService 建立连接
        if (window.electronAPI?.imConnect) {
          window.electronAPI.imConnect(stored.token).then(res => {
            console.log('[MainView] 主进程 im-connect 结果:', res)
          })
        }
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
const currentGroupId = ref(null)
const filter = ref('all')

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
const agentPanelCollapsed = ref(false)
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
// Agent 面板模式，与 autoMode 联动（0→隐藏, 1→协同, 2→托管）
const agentPanelMode = computed(() => {
  if (autoMode.value === 2) return 'managed'
  return 'collaborative'
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
const currentTakenOverAgentId = computed(() => {
  if (!currentConversation.value) return null
  const key = getConvKeyForTakeover(currentConversation.value)
  if (!key) return null
  return takeoverByConv.get(key)?.agentId || null
})
// Data — agents and groups. Conversation data is owned by ConversationList.
const agents = reactive([])
const agentsLoaded = ref(false)

async function loadAgents() {
  if (agentsLoaded.value) return
  try {
    const res = await get(SERVER_PATH.AGENT_MYBOTS)
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

const groups = reactive([
  {
    id: 'g1',
    name: '营销策划组',
    agentCount: 3,
    messages: [
      { type: 'user', text: '帮我策划下个月双11的小红书营销方案，预算2万以内，主推我们家的精华液' },
      { type: 'agent', agentName: '营销专家', agentEmoji: '🎯', text: '好的！2万预算做精华液小红书推广，我建议分三步：\n\n**1. 预热期(11.1-11.7) 预算8000**\n· 邀请5位腰部达人产出种草笔记\n· 素人铺量20篇真实测评\n· 话题标签：#秋冬精华推荐 #双11必买清单\n\n**2. 爆发期(11.8-11.11) 预算10000**\n· 信息流精准投放，定向25-35岁女性\n· 头部达人1篇视频测评（预算占大头）\n· 限时优惠券+评论区互动引导\n\n**3. 返场期(11.12-11.15) 预算2000**\n· 用户好评二次传播\n· 未转化用户私信触达' },
      { type: 'agent', agentName: '财务助手', agentEmoji: '💰', text: '预算分配基本合理，补充几点：\n\n· 信息流投放按CPM 50预估，10000预算约20万曝光\n· 建议聚焦一二线城市女性25-35岁\n· 预留5%机动预算（约1000元）应对突发需求\n· ROI预期：按行业平均3%-5%转化率，预计产出300-500单\n\n风险提示：达人排期要提前锁定，双11期间优质达人资源紧张。' },
      { type: 'agent', agentName: '内容助手', agentEmoji: '✍️', text: '我来补充内容策略方向：\n\n**笔记标题方向：**\n· "终于找到本命精华！干敏皮双11必囤"\n· "30天精华实测，这效果我服了"\n\n**内容关键卖点：**\n· 成分党友好（列出核心成分+功效数据）\n· 使用前后对比（真实记录）\n· 性价比对比（横向对比大牌平替）\n\n**避坑提醒：**\n· 禁用"最""第一"等绝对化用语\n· 达人需真实使用7天以上再出内容\n· 素人笔记保持自然语气，避免过度营销感' },
    ]
  },
  {
    id: 'g2',
    name: '技术方案评审组',
    agentCount: 2,
    messages: [
      { type: 'user', text: '我们想做一个会员积分系统，请帮我评审下技术方案：用Redis做积分存储，MySQL做订单记录，前端实时展示积分变动' },
      { type: 'agent', agentName: '架构师', agentEmoji: '🏗️', text: '方案方向正确，但有几个优化建议：\n\n1. Redis做积分存储很好，但需要配合AOF持久化防止数据丢失\n2. 建议增加一层积分变动的消息队列（Kafka/RabbitMQ），解耦订单系统和积分系统\n3. 实时展示可以用WebSocket推送，不要轮询\n4. 考虑积分过期机制，用Redis的TTL或者定时任务扫描' },
      { type: 'agent', agentName: '安全专家', agentEmoji: '🔒', text: '安全方面需要关注：\n\n· Redis一定要设置密码且不暴露公网\n· 积分变动操作需要幂等设计（防止重复扣减/增加）\n· 增加风控规则：单用户单日积分上限、异常行为检测\n· 所有积分变动操作记录审计日志\n· 前端展示要做数据签名校验，防止篡改' },
    ]
  }
])

const showCreateAgent = ref(false)
const showLogoutModal = ref(false)

// Computed
const currentGroup = computed(() => {
  return groups.find(g => g.id === currentGroupId.value) || null
})

// "Nothing selected" state — no conversation AND no group. Used to swap
// the right two panes (Chat + Agent) for a centered "pick a conversation"
// placeholder. We keep the left sidebar visible so the user has something
// concrete to click on.
const hasNoSelection = computed(
  () => !currentConversation.value && !currentGroup.value
)

const currentMessages = computed(() => {
  if (currentView.value === 'group') {
    return currentGroup.value?.messages || []
  }
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
  currentGroupId.value = null
  currentSession.value = null  // reset — will be populated by lookup below
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
  currentGroupId.value = id
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
  } else if (currentView.value === 'group' && currentGroup.value) {
    currentGroup.value.messages.push({ type: 'user', text })
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
  // Mode toggle rules (auto_mode):
  //   0 = 人工回复 → click → 1 (协助回复)
  //   1 = 协助回复 → click → 0 (人工回复)
  //   2 = 自动回复(托管) → click → 0 (人工回复) + clear takeover tag
  if (id === null) {
    selectedAgentId.value = null
    // 取消选中 → 恢复人工回复
    if (currentSession.value?.session_id && currentSession.value.auto_mode !== 0) {
      try {
        await post(SERVER_PATH.AGENT_SESSION_TAKEOVER(currentSession.value.session_id), { auto_mode: 0 })
        if (currentSession.value) {
          currentSession.value.auto_mode = 0
        }
        if (currentConversation.value) {
          clearTakeover(currentConversation.value)
        }
      } catch (e) {
        console.warn('[MainView] deselect agent mode reset failed', e)
      }
    }
    return
  }

  const ag = agents.find(a => a.id === id)
  if (!ag) return
  const conv = currentConversation.value
  if (!conv) return
  const convId = conv.conversationId || conv.id
  if (!convId) return

  const isSwitch = selectedAgentId.value && selectedAgentId.value !== id
  selectedAgentId.value = id

  // Agent switch → clear takeover tag (mode will be set below)
  if (isSwitch && currentConversation.value) {
    clearTakeover(currentConversation.value)
  }

  if (currentSession.value?.session_id) {
    // Session 已存在 → 更新 agent
    try {
      const res = await post(SERVER_PATH.AGENT_SESSION_UPDATE_AGENT(currentSession.value.session_id), {
        unique_name: ag.unique_name
      })
      if (res?.code === 0 && res.data) {
        currentSession.value = res.data
      }
      // Toggle auto_mode：仅切换 agent 或当前为人工/自动时变更
      const currentMode = currentSession.value?.auto_mode ?? 0
      let newMode = currentMode
      if (isSwitch) {
        // 切换到新 agent → 协助模式
        newMode = 1
      } else if (currentMode === 0) {
        // 人工 → 协助
        newMode = 1
      } else if (currentMode === 2) {
        // 自动(托管) → 人工
        newMode = 0
      }
      // 协助(1)点击同一 agent → 保持协助，不切换
      if (newMode !== currentMode) {
        const tres = await post(SERVER_PATH.AGENT_SESSION_TAKEOVER(currentSession.value.session_id), { auto_mode: newMode })
        if (currentSession.value) {
          currentSession.value.auto_mode = newMode
          if (newMode === 0) {
            currentSession.value.unique_name = ''
            currentSession.value.agent = null
            selectedAgentId.value = null
            clearTakeover(conv)
          }
        }
      }
    } catch (e) {
      console.warn('[MainView] update session agent failed', e)
    }
  } else {
    // Session 不存在 → 创建（初始为协助模式）
    try {
      const res = await post(SERVER_PATH.AGENT_SESSION_CREATE, {
        conv_id: convId,
        conv_type: String(conv.conversationType || ''),
        unique_name: ag.unique_name,
        customer_id: conv.customerId || conv.userid || '',
        platform: conv.platform || 'jim',
        auto_mode: 1
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
  // Map.set is needed even when wasIn is true — switching the driving
  // Agent on the same conversation (e.g. A→B) is a local-only update,
  // no SDK call. The tag membership is per-conversation, not per-agent.
  takeoverByConv.set(key, { conversation, agentId })
  if (!wasIn) {
    void im.addConversationToTakeoverTag(conversation)
  }
}

function clearTakeover(conversation) {
  if (!conversation) return
  const key = getConvKeyForTakeover(conversation)
  if (!key) return
  if (!takeoverByConv.has(key)) return
  // Fire the SDK call BEFORE deleting the Map entry, so we still have
  // the conversation object on hand for the remove payload.
  void im.removeConversationFromTakeoverTag(takeoverByConv.get(key).conversation)
  takeoverByConv.delete(key)
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
    <NavSidebar
      :active-nav="activeNav"
      @open-user-drawer="showUserDrawer = true"
      @nav-change="handleNavChange"
    />

    <ConversationList
      :active-id="currentView === 'conversation' ? currentConvoId : null"
      :filter="filter"
      @select="handleConvoSelect"
      @filter-change="handleFilterChange"
      @conversation-op="handleConversationOp"
      @suggestion-received="handleSuggestionReceived"
    >
      <template #groups>
        <div
          v-for="g in groups"
          :key="g.id"
          class="tyn-group-item"
          :class="{ active: currentView === 'group' && currentGroupId === g.id }"
          @click="handleGroupSelect(g.id)"
        >
          <div class="tyn-group-item__icon">👥</div>
          <div>
            <div style="font-weight: 500;">{{ g.name }}</div>
            <div style="font-size: 11px; color: var(--text-tertiary);">{{ g.agentCount }} 个 Agent</div>
          </div>
        </div>
      </template>
    </ConversationList>

    <ChatMain
      v-if="!hasNoSelection"
      :conversation="currentView === 'conversation' ? currentConversation : null"
      :messages="currentMessages"
      :suggestions="currentSuggestions"
      :is-group="currentView === 'group'"
      :group-name="currentGroup?.name || ''"
      :group-agent-count="currentGroup?.agentCount || 0"
      :selected-agent="selectedAgent"
      :taken-over-agent="takenOverAgent"
      :auto-mode="autoMode"
      :pending-suggestions="currentPendingSuggestions"
      @send="handleSend"
      @use-suggestion="handleUseSuggestion"
      @revoke-takeover="handleRevokeTakeover"
      @clear-suggestion="handleClearSuggestion"
    />

    <AgentPanel
      v-if="!hasNoSelection"
      :agents="agents"
      :selected-agent-id="selectedAgentId"
      :mode="agentPanelMode"
      :hosted-agent-id="currentTakenOverAgentId"
      @select-agent="handleSelectAgent"
      @update:mode="handleAgentPanelModeChange"
      @toggle-host="(agentId) => handleTakeoverToggle(currentConversation, agentId)"
    />

    <main v-if="hasNoSelection" class="jm-app-placeholder">
      <div class="jm-app-placeholder__inner">
        <div class="jm-app-placeholder__icon">💬</div>
        <div class="jm-app-placeholder__text">暂无会话</div>
        <div class="jm-app-placeholder__hint">请在左侧选择一个会话开始沟通</div>
      </div>
    </main>

    <UserDrawer
      :show="showUserDrawer"
      :user-name="currentUserName"
      :user-id="currentUserId"
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
