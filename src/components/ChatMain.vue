<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import im from '../common/im'
import { SERVER_PATH, post, get } from '../services/api'
import {
  MSG_NAME,
  TYPING_STATUS
} from '../common/enum'
import { resolvePlatformMeta } from '../common/platform-utils'
import utils from '../common/utils'
import chatTime from '../common/chat-time-utils'
import toast from '../common/toast'
import MessageItem from './message/MessageItem.vue'
import MessageContextEmoji from './MessageContextEmoji.vue'
import MessageSender from './MessageSender.vue'
import MessageMenu from './MessageMenu.vue'
import ImagePreviewer from './ImagePreviewer.vue'
import TransferDialog from './TransferDialog.vue'
import TicketTransferDialog from './TicketTransferDialog.vue'
import { fetchTransferCandidates } from '../services/agent'
import ReplyQuote from './ReplyQuote.vue'
import Avatar from './Avatar.vue'
import emitter from '../common/emitter'
import { EVENT_NAME } from '../common/enum'
import { isElectron } from '../common/platform'
import userService from '../services/user'
import { getTranslationSettings } from '../services/translation-settings'
import {
  hydrateMessageTranslation,
  isTranslatableMessage,
  translateMessage
} from '../services/message-translation'

const props = defineProps({
  conversation: {
    type: Object,
    default: null
  },
  // 客户在 IM 端的真实 user id（取自 customers/info.source_id）
  // 用于在 im.userStatusCache 里查在线状态；不传时回退到 conversationId。
  peerSourceId: {
    type: String,
    default: ''
  },
  // Fallback / demo messages used when the IM SDK isn't connected yet.
  messages: {
    type: Array,
    default: () => []
  },
  isGroup: {
    type: Boolean,
    default: false
  },
  groupName: {
    type: String,
    default: ''
  },
  groupAgentCount: {
    type: Number,
    default: 0
  },
  // For the transfer dialog. Parent (MainView) passes the full conversation
  // list so the user can pick a target conversation.
  transferTargets: {
    type: Array,
    default: () => []
  },
  // The currently *selected* Agent on the right-side panel. Drives the
  // header status tip ("{name} 正在协助回复" / "人工自主回复"). This is the
  // operator's "I'm writing in this Agent's voice" signal — distinct from
  // 托管 (see `takenOverAgent`).
  selectedAgent: {
    type: Object,
    default: null
  },
  // The Agent currently in "托管" (takeover) mode, set from the right-side
  // panel's per-Agent 托管 button. When set, the takeover banner appears
  // ("{name} 助手接管" with a 收回控制 button). This is a stronger signal
  // than selection — it means the Agent is fully driving the conversation.
  takenOverAgent: {
    type: Object,
    default: null
  },
  streamSuggestions: {
    type: Array,
    default: () => []
  },
  assigned: {
    type: Boolean,
    default: false
  }
})
const emit = defineEmits([
  'send', 'useSuggestion',
  'clearStreamSuggestion', 'clearAllStreamSuggestions', 'claimTicket',
  // 工单转移：弹层 confirm 时携带 { to_assignee_id, note, ticket_id, expected_version }
  // 父组件 MainView 负责 POST /jmate/tickets/:id/transfer 并刷新本地状态，
  // 完成后通过 chatMainRef.notifyTransferResult({ ok, message }) 回写弹层。
  'transferTicket',
  // 辅助回复模式：收到客户消息时通知 MainView 去 streamAgentChat 拿 AI 建议。
  // payload: { agentId: string, customerMessage: string }
  // MainView 处理完成后会通过 prop 传回的 streamSuggestions 自然渲染。
  'requestAgentSuggestion',
  // 收到新消息（含自己会话内收消息）时通知 MainView 触发会话列表按当前 filter 刷新。
  // Conversations 内部 loadConversations() 会读取 active filter 后拉新列表。
  'conversationChanged'
])

const { Event, SentState, MessageType, ConversationType } = im

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const imMessages = reactive([])
const loadingMore = ref(false)
const isHistoryFinished = ref(false)
const composerText = ref('')
const replyTo = ref(null)
const peerTyping = ref(false)
const peerStatusLoading = ref(false)
// peer userId：只能取 customers/info 返回的 source_id（IM 端的真实 user id）。
// 不做兼容 —— conversationId 是 chat 会话 id，跟 IM 端的 user id 不是一回事。
// source_id 还没拿到时 peerUserId 为空，peerStatus 走「状态未知」。
const peerUserId = computed(() => props.peerSourceId || '')
const peerStatus = computed(() => {
  const userId = peerUserId.value
  if (!userId) return null
  return im.userStatusCache.get(String(userId))?.status ?? null
})
const peerOnline = computed(() => peerStatus.value === 1)
const peerStatusText = computed(() => {
  if (peerStatus.value === im.UserStatus.ONLINE) return '在线'
  if (peerStatus.value === im.UserStatus.OFFLINE) return '离线'
  return peerStatusLoading.value ? '查询中…' : '状态未知'
})
let receiveTypingTimer = null
let typingStartSentAt = 0

// Ticket claim banner
const showClaimBanner = ref(false)
const claiming = ref(false)

// Thinking bubble state — shown after sendText until agent replies or timeout
const thinkingMsg = ref(null)
let thinkingTimer = null
let countdownTimer = null
const COUNTDOWN_SECONDS = 10

// Image preview
const previewerOpen = ref(false)
const previewerUrl = ref('')

// Message right-click menu
const messageMenuState = ref({ show: false, x: 0, y: 0, message: null })
// Emoji picker (sub-menu of message menu)
// Transfer dialog
const transferState = ref({ show: false, message: null, targets: [] })

const juggle = im.getCurrent()
const translationSettings = reactive(getTranslationSettings())
// Product scope is determined by the Electron shell. Do not gate the UI with
// SDK `isDesktop()`: some Electron hosts expose updateMessageAttr through the
// runtime provider without that diagnostic returning true.
const translationAvailable = computed(() => isElectron())

function applyTranslationVisibility(message) {
  if (message) message.translationVisible = translationSettings.enabled
}

function hydrateTranslation(message) {
  if (!translationAvailable.value || !message) return null
  applyTranslationVisibility(message)
  return hydrateMessageTranslation(message, translationSettings.targetLang)
}

async function requestMessageTranslation(message, { force = false, silent = false } = {}) {
  if (!translationAvailable.value || !isTranslatableMessage(message)) return
  applyTranslationVisibility(message)
  // A manual action (right-click/retry) is an explicit request to see this
  // message's translation even when automatic incoming translation is off.
  if (force) message.translationVisible = true
  try {
    await translateMessage(message, translationSettings.targetLang, { client: juggle, force })
  } catch (error) {
    if (!silent) toast.error(error?.msg || error?.message || '翻译失败')
  }
}

function onTranslationSettingsChanged(payload) {
  const userId = String(userService.getCurrentUser()?.id || '')
  if (payload?.userId && String(payload.userId) !== userId) return
  const settings = payload?.settings || getTranslationSettings(userId)
  Object.assign(translationSettings, settings)
  for (const message of imMessages) {
    applyTranslationVisibility(message)
    if (settings.enabled) hydrateMessageTranslation(message, settings.targetLang)
  }
}

async function ensurePeerStatus() {
  if (props.isGroup) return
  const userId = peerUserId.value
  if (!userId) {
    console.warn('[ChatMain][user-status] missing peer userId', {
      conversation: props.conversation
    })
    return
  }
  console.log('[ChatMain][user-status] resolve peer', {
    userId: String(userId),
    conversationId: props.conversation?.conversationId,
    conversationType: props.conversation?.conversationType,
    targetId: props.conversation?._raw?.targetId,
    platform: props.conversation?.platform
  })
  peerStatusLoading.value = true
  try {
    await im.getUserStatus(userId)
  } catch (error) {
    console.warn('[ChatMain] getUserStatus failed', { userId, error })
  } finally {
    peerStatusLoading.value = false
    console.log('[ChatMain][user-status] rendered state', {
      userId: String(userId),
      cachedStatus: im.userStatusCache.get(String(userId))?.status,
      statusText: peerStatusText.value
    })
  }
}
const platformTag = computed(() => {
  // Common-platform resolver. Reads `tags` first (channel_*  → PLATFORM_META)
  // and falls back to `conversation.platform` / `platformKey`. Returns
  // `null` for groups or when the platform cannot be determined. The
  // returned object is the same shape PLATFORM_META[key] produces, so the
  // existing template bindings (color / label) keep working unchanged.
  return resolvePlatformMeta(props.conversation, { isGroup: props.isGroup })
})

// ---------------------------------------------------------------------------
// Derived: rows = messages + injected time separators
// ---------------------------------------------------------------------------

// Always render in sentTime-ascending order. The underlying imMessages array
// is mutated from multiple paths (loadHistory prepending, MESSAGE_RECEIVED
// appending, optimistic send appending), and the SDK's `getMessages` order
// isn't documented — sorting here is the single source of truth for the UI.
//
// Performance: the array is small (one conversation's window) and the sort
// is O(n log n) per render. For <1000 messages this is negligible. If the
// list ever grows past that, switch to a sorted-insert helper.
const rows = computed(() => {
  const list = imMessages.length > 0 ? imMessages : props.messages
  if (!list || list.length === 0) return []
  const sorted = [...list].sort(
    (a, b) => (a?.sentTime || 0) - (b?.sentTime || 0)
  )
  return insertTimeSeparators(sorted)
})

function insertTimeSeparators(list) {
  const out = []
  let previous = null
  for (const m of list) {
    if (chatTime.shouldShowTimeSeparator(m.sentTime, previous?.sentTime)) {
      out.push({
        name: 'notify',
        sentTime: m.sentTime,
        conversationType: m.conversationType,
        conversationId: m.conversationId
      })
    }
    out.push(m)
    previous = m
  }
  return out
}

const prevByIndex = computed(() => {
  const map = new Map()
  const list = rows.value
  for (let i = 0; i < list.length; i++) {
    map.set(list[i], i > 0 ? list[i - 1] : null)
  }
  return map
})

const isCurrentGroup = computed(() => {
  if (props.isGroup) return true
  return props.conversation?.conversationType === ConversationType.GROUP
})

// Header status tip. Driven by *selection*, not 托管. The two states are
// independent:
//   - An Agent is selected (operator is writing in its voice) → red tip
//     "{name} 正在协助回复".
//   - Nothing selected → neutral "人工自主回复".
// The 托管 button on the right side is what triggers the takeover banner;
// it does not affect the tip. That keeps the tip meaningful even when no
// 托管 is active.
// --- Header agent-mode (2 状态) ---
// human      人工自主回复（灰）—— 无 selectedAgent
// assist     AI 协助回复（主色蓝）—— selectedAgent 在场
// 托管（auto）状态已下线：MainView 不再下推 takenOverAgent，下方 UI 也已
// 移除 takeover banner 与收回控制按钮。
const currentMode = computed(() => {
  if (props.selectedAgent) return 'assist'
  return 'human'
})
const modeText = computed(() => {
  if (currentMode.value === 'assist') {
    return props.selectedAgent?.name
      ? `${props.selectedAgent.name} 正在协助回复`
      : 'AI 协助回复'
  }
  return '人工自主回复'
})

// 两种 mode 对应的 svg icon
const ICON_HUMAN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'
const ICON_ASSIST = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v.5A3 3 0 0 0 6 8.5V9a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-3a3 3 0 0 0 3-3v0a3 3 0 0 0-3-3v-.5A3 3 0 0 0 15 5.5V5a3 3 0 0 0-3-3z"></path><circle cx="9" cy="13" r="1"></circle><circle cx="15" cy="13" r="1"></circle><path d="M9 17h6"></path></svg>'
const modeIconSvg = computed(() => {
  if (currentMode.value === 'assist') return ICON_ASSIST
  return ICON_HUMAN
})

const isAssignedConversation = computed(() => props.assigned)

// 联系人是普通聊天：没有 ticket、没有 assigned tag、没有 transfer/claim 控件。
// 通过 _raw.member 识别（MainView 选中联系人时构造的 fake conversation 会带这个字段）。
const isContactChat = computed(() => !!props.conversation?._raw?.member)

// --- Ticket claim ---
function onClaimTicket() {
  claiming.value = true
  emit('claimTicket', props.conversation?.ticket_id)
  // Reset states after emission; the parent will handle the API call
  claiming.value = false
  showClaimBanner.value = false
}

// --- Ticket transfer ---
// 工单转移弹层。设计要点：
//   - 仅在已认领工单（即 isAssignedConversation === true）时显示入口；
//   - TicketTransferDialog 内部从 juggleim HTTP API 拉群成员作为候选目标；
//   - 提交时父组件（MainView）负责调 POST /jmate/tickets/:id/transfer 并
//     处理成功 / 失败 / 版本冲突的副作用；
//   - expected_version 用于并发冲突检测（17012），如果不传后端会按缺省行为处理。
const transferOpen = ref(false)
const transferring = ref(false)
const headerMenuOpen = ref(false)
function toggleHeaderMenu(event) {
  event.stopPropagation()
  headerMenuOpen.value = !headerMenuOpen.value
}
function selectHeaderAction(action) {
  headerMenuOpen.value = false
  if (action === 'transfer') openTransfer()
}
function openTransfer() {
  if (!props.conversation?.ticket_id) {
    console.warn('[ChatMain] openTransfer: missing ticket_id')
    return
  }
  transferOpen.value = true
}
function closeTransfer() {
  if (transferring.value) return  // 提交进行中，禁止关闭
  transferOpen.value = false
}
function onTicketTransferConfirm(payload) {
  // payload: { user_id, nickname, note }
  // 服务端契约只用 { assignee_id }，其他字段仅用于本地状态更新。
  transferring.value = true
  emit('transferTicket', {
    ticket_id: props.conversation.ticket_id,
    assignee_id: payload.user_id,
    to_assignee_name: payload.nickname || payload.user_id,  // 服务端不回名 → 用 UI 选中的
    note: payload.note || ''
  })
}
// 切换会话时强制关闭弹层，避免跨 ticket 数据残留
watch(() => props.conversation?.conversationId, () => {
  if (transferOpen.value) transferOpen.value = false
  headerMenuOpen.value = false
  ensurePeerStatus()
})

// peerUserId（= props.peerSourceId）变化时重查在线状态。
// 关键场景：customers/info 是异步的，进入会话时 peerSourceId 还没拿到，
// 首次 ensurePeerStatus 会因 userId 为空直接 return；等 info 返回、
// MainView 把 source_id 透下来后再补一次。
watch(peerUserId, (uid) => {
  if (!uid) return
  ensurePeerStatus()
}, { immediate: true })

// 当前显示用的工单 ID —— 优先用短 ID 友好显示；找不到就退到原始 id
const ticketDisplayId = computed(() => {
  const t = props.conversation?.name || ''
  return t.startsWith('#') ? t : `#${t}`
})

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function loadHistory() {
  if (!props.conversation) return
  if (!juggle || !im.isConnected()) return
  if (loadingMore.value) return
  loadingMore.value = true
  try {
    const oldest = imMessages[0]
    const params = {
      conversationType: props.conversation.conversationType,
      conversationId: props.conversation.conversationId,
      time: oldest ? oldest.sentTime : 0
    }
    const result = await juggle.getMessages(params)
    console.log('[ChatMain] loadHistory', params, result)
    const incoming = result?.messages || []
    const isFinished = !!result?.isFinished
    for (const m of incoming) {
      hydrateTranslation(m)
      if (!imMessages.find((x) => x.messageId && x.messageId === m.messageId)) {
        if (m.conversationType === ConversationType.GROUP) {
          m.readPercent = 0
        }
        // The SDK returns newest-first. We maintain an oldest-first list
        // (so the latest message renders at the bottom — standard IM UX),
        // so prepend each history page.
        imMessages.unshift(m)
      }
    }
    isHistoryFinished.value = isFinished
  } catch (e) {
    console.warn('[ChatMain] loadHistory failed', e)
  } finally {
    loadingMore.value = false
  }
}

const scrollEl = ref(null)
async function scrollToBottom() {
  await nextTick()
  if (scrollEl.value) {
    scrollEl.value.scrollTop = scrollEl.value.scrollHeight
  }
}

function clearThinkingState() {
  thinkingMsg.value = null
  if (thinkingTimer) {
    clearTimeout(thinkingTimer)
    thinkingTimer = null
  }
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

function startThinkingTimer() {
  // Only clear any existing timer — do NOT clear thinkingMsg
  if (thinkingTimer) {
    clearTimeout(thinkingTimer)
    thinkingTimer = null
  }
  thinkingTimer = setTimeout(() => {
    if (thinkingMsg.value) {
      thinkingMsg.value = { ...thinkingMsg.value, timeout: true, countdown: COUNTDOWN_SECONDS }
      // Start countdown
      countdownTimer = setInterval(() => {
        if (!thinkingMsg.value) {
          clearInterval(countdownTimer)
          countdownTimer = null
          return
        }
        const next = thinkingMsg.value.countdown - 1
        if (next <= 0) {
          clearThinkingState()
        } else {
          thinkingMsg.value = { ...thinkingMsg.value, countdown: next }
        }
      }, 1000)
    }
  }, 200000)
}

function onScroll() {
  const el = scrollEl.value
  if (!el) return
  // imMessages is oldest-first; new history pages are PREPENDED. To fetch
  // more history, the user scrolls UP (toward index 0, the oldest end).
  // The "distance from bottom" check works because the scroll position is
  // measured against the visible scroll area — scrolling up means we're
  // farther from the bottom.
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  if (distanceFromBottom > 200 && !loadingMore.value && !isHistoryFinished.value) {
    const prevHeight = el.scrollHeight
    loadMore().then(() => {
      nextTick(() => {
        const newHeight = el.scrollHeight
        // The user is anchored at a fixed distance from the bottom; after
        // prepending history, keep that same visual position.
        if (newHeight > prevHeight) {
          el.scrollTop = el.scrollTop + (newHeight - prevHeight)
        }
      })
    })
  }
}

async function loadMore() {
  if (isHistoryFinished.value) return
  await loadHistory()
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

function buildBaseMessage(name, content) {
  return {
    conversationType: props.conversation.conversationType,
    conversationId: props.conversation.conversationId,
    name,
    content,
    isSender: true,
    tid: utils.getUUID(),
    sender: juggle.getCurrentUser?.() || {}
  }
}

async function sendText(text) {
  if (!props.conversation || !text) return
  clearThinkingState()
  if (!juggle || !im.isConnected()) {
    emit('send', text)
    return
  }
  const content = { content: text }
  const base = buildBaseMessage(MessageType.TEXT, content)
  // Reply quote
  if (replyTo.value) {
    base.referMsg = replyTo.value
  }
  // Optimistic insert — list is oldest-first, so push to the end (bottom).
  const optimistic = {
    ...base,
    sentState: SentState.SENDING,
    sentTime: Date.now()
  }
  imMessages.push(optimistic)
  scrollToBottom()
  // Clear reply state
  const wasReply = replyTo.value
  replyTo.value = null
  try {
    const { sentTime, messageId, messageIndex } = await juggle.sendMessage(base, {
      onbefore: (message) => {
        // The SDK rewrites fields here. We re-find the optimistic entry by
        // tid because MESSAGE_RECEIVED may have already swapped our object
        // out — holding a stale reference would silently lose updates.
        const idx = imMessages.findIndex((m) => m.tid === optimistic.tid)
        if (idx >= 0) {
          Object.assign(imMessages[idx], message, {
            sentState: SentState.SENDING,
            sentTime: message.sentTime || Date.now()
          })
        }
      }
    })
    const idx = imMessages.findIndex((m) => m.tid === optimistic.tid)
    if (idx >= 0) {
      Object.assign(imMessages[idx], {
        sentTime,
        messageId,
        messageIndex,
        sentState: SentState.SUCCESS
      })
    }
  } catch (err) {
    const idx = imMessages.findIndex((m) => m.tid === optimistic.tid)
    if (idx >= 0) {
      Object.assign(imMessages[idx], { sentState: SentState.FAILED })
    }
    console.warn('[ChatMain] send failed', err)
  }
  return wasReply
}

async function onSend(text) {
  // 未认领的工单不允许直接发消息 — 必须先认领。
  // 既挡住发送按钮，也挡住回车键（MessageSender 在 submit 之前会 emit send）。
  if (!isAssignedConversation.value && !isContactChat.value) {
    if (!text || !text.trim()) {
      showClaimBanner.value = true
    }
    return
  }
  sendEndTyping()
  await sendText(text)
}

function canSendTyping() {
  if (!props.conversation || isCurrentGroup.value) return false
  return !!(juggle && im.isConnected())
}

function sendTypingStatus(type) {
  if (!canSendTyping()) return
  im.sendTyping(props.conversation, { type }).catch((e) => {
    console.warn('[ChatMain] sendTyping failed', e)
  })
}

function sendStartTyping(force = false) {
  if (!canSendTyping()) return
  const now = Date.now()
  if (!force && now - typingStartSentAt < 3000) return
  typingStartSentAt = now
  sendTypingStatus(TYPING_STATUS.START)
}

function sendEndTyping() {
  if (!canSendTyping()) return
  typingStartSentAt = 0
  sendTypingStatus(TYPING_STATUS.END)
}

function onComposerInput(value) {
  composerText.value = value
  if (value.trim()) {
    // Don't send typing for unassigned tickets
    if (!!isAssignedConversation.value || isContactChat.value) {
      sendStartTyping()
    }
    if (!isAssignedConversation.value && !isContactChat.value) {
      showClaimBanner.value = true
    }
  } else {
    if (!!isAssignedConversation.value || isContactChat.value) {
      sendEndTyping()
    }
    showClaimBanner.value = false
  }
}

function onComposerFocus() {
  if (!!isAssignedConversation.value || isContactChat.value) {
    sendStartTyping(true)
  }
}

function onResend(message) {
  if (!juggle) return
  // Re-find by tid in case the array's reference has shifted.
  const idx = imMessages.findIndex((m) => m === message || m.tid === message.tid)
  if (idx < 0) return
  Object.assign(imMessages[idx], { sentState: SentState.SENDING })
  juggle
    .sendMessage({
      conversationType: imMessages[idx].conversationType,
      conversationId: imMessages[idx].conversationId,
      name: imMessages[idx].name || MessageType.TEXT,
      content: imMessages[idx].content
    })
    .then(({ sentTime, messageId, messageIndex }) => {
      Object.assign(imMessages[idx], {
        sentTime,
        messageId,
        messageIndex,
        sentState: SentState.SUCCESS
      })
    })
    .catch(() => {
      Object.assign(imMessages[idx], { sentState: SentState.FAILED })
    })
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

async function onAttach({ file }) {
  if (!file) return
  if (!props.conversation) {
    toast.error('请先选择一个会话')
    return
  }
  if (!juggle) {
    toast.error('IM 未连接，请先登录')
    return
  }
  if (!im.isConnected()) {
    toast.error('IM 正在连接，请稍后再试')
    return
  }
  const ct = (file.type || '').toLowerCase()
  const sender = juggle.getCurrentUser?.() || {}
  const tid = utils.getUUID()

  // IMAGE
  if (ct.startsWith('image/')) {
    // Compute dimensions via a temp <img>.
    const dataUrl = URL.createObjectURL(file)
    const dims = await imageDims(dataUrl).catch(() => ({}))
    // The image renderer reads `content.url`. Seed it with the local blob
    // URL so the optimistic preview shows up before upload completes.
    // We don't push to imMessages here — the SDK's onbelow callback will
    // hand us the same `tid` so the entry is added exactly once.
    const base = {
      conversationType: props.conversation.conversationType,
      conversationId: props.conversation.conversationId,
      isSender: true,
      sender,
      tid,
      name: MessageType.IMAGE,
      percent: 0,
      sentState: SentState.SENDING,
      localUrl: dataUrl,
      content: { file, height: dims.h, width: dims.w, type: ct, url: dataUrl }
    }
    try {
      await juggle.sendImageMessage(base, {
        onbefore: (msg) => {
          // Single source of truth: the SDK's clone is the one entry in
          // imMessages. We patch sentTime and push once.
          Object.assign(msg, { sentTime: Date.now(), sentState: SentState.SENDING })
          imMessages.push(msg)
          scrollToBottom()
        },
        onprogress: ({ percent, message }) => {
          const p = Number(percent?.toFixed?.(0) ?? percent)
          const target = imMessages.find((m) => m.tid === message?.tid)
          if (target) {
            target.percent = p
            target.sentState = SentState.UPLOADING
          }
        }
      })
      const target = imMessages.find((m) => m.tid === tid)
      if (target) {
        target.percent = 100
        target.sentState = SentState.SUCCESS
      }
    } catch (e) {
      reportUploadError(e, '图片', tid)
    }
    return
  }

  // VIDEO
  if (ct.startsWith('video/')) {
    const dims = await videoDims(file).catch(() => ({}))
    const localUrl = URL.createObjectURL(file)
    const base = {
      conversationType: props.conversation.conversationType,
      conversationId: props.conversation.conversationId,
      isSender: true,
      sender,
      tid,
      name: MessageType.VIDEO,
      percent: 0,
      sentState: SentState.SENDING,
      localUrl,
      content: { file, height: dims.h, width: dims.w, url: localUrl }
    }
    try {
      await juggle.sendVideoMessage(base, {
        onbefore: (msg) => {
          Object.assign(msg, { sentTime: Date.now(), sentState: SentState.SENDING })
          imMessages.push(msg)
          scrollToBottom()
        },
        onprogress: ({ percent }) => {
          const target = imMessages.find((m) => m.tid === tid)
          if (target) {
            target.percent = Math.round(percent)
            target.sentState = SentState.UPLOADING
          }
        }
      })
      const target = imMessages.find((m) => m.tid === tid)
      if (target) {
        target.percent = 100
        target.sentState = SentState.SUCCESS
      }
    } catch (e) {
      reportUploadError(e, '视频', tid)
    }
    return
  }

  // FILE (and everything else)
  const base = {
    conversationType: props.conversation.conversationType,
    conversationId: props.conversation.conversationId,
    isSender: true,
    sender,
    tid,
    name: MessageType.FILE,
    percent: 0,
    sentState: SentState.SENDING,
    content: { file, name: file.name, type: ct, size: file.size }
  }
  try {
    await juggle.sendFileMessage(base, {
      onbefore: (msg) => {
        Object.assign(msg, { sentTime: Date.now(), sentState: SentState.SENDING })
        imMessages.push(msg)
        scrollToBottom()
      },
      onprogress: ({ percent, message }) => {
        const target = imMessages.find((m) => m.tid === message?.tid)
        if (target) {
          target.percent = Math.round(percent)
          target.sentState = SentState.UPLOADING
        }
      }
    })
    const target = imMessages.find((m) => m.tid === tid)
    if (target) {
      target.percent = 100
      target.sentState = SentState.SUCCESS
    }
  } catch (e) {
    reportUploadError(e, '文件', tid)
  }
}

function imageDims(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.width, h: img.height })
    img.onerror = reject
    img.src = url
  })
}

// Convert an SDK upload error to a human-readable message. The SDK reports
// a numeric `code` and a `msg` string. UPLOAD_PLUGIN_ERROR (code 1302 in
// the bundled SDK) is by far the most common cause of failure here: it
// means the IM client was initialized without an upload plugin, so files
// can never reach the server.
function describeUploadError(err, kind) {
  const code = err?.code ?? err?.error?.code
  if (code === 1302 || /UPLOAD_PLUGIN/i.test(String(err?.msg || err?.error?.msg || ''))) {
    return `${kind}上传失败：未配置对象存储后端，请联系管理员`
  }
  if (err?.msg) return `${kind}上传失败：${err.msg}`
  if (err?.error?.msg) return `${kind}上传失败：${err.error.msg}`
  return `${kind}上传失败`
}

function reportUploadError(err, kind, tid) {
  console.warn(`[ChatMain] ${kind} upload failed`, err)
  toast.error(describeUploadError(err, kind))
  const target = imMessages.find((m) => m.tid === tid)
  if (target) target.sentState = SentState.FAILED
}

function videoDims(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      resolve({ w: v.videoWidth, h: v.videoHeight })
      URL.revokeObjectURL(url)
    }
    v.onerror = (e) => {
      reject(e)
      URL.revokeObjectURL(url)
    }
    v.src = url
  })
}

// ---------------------------------------------------------------------------
// Right-click on a message
// ---------------------------------------------------------------------------

function onMessageContext({ event, message }) {
  if (!event || !message) return
  // Position the menu near the click.
  let x = event.clientX
  let y = event.clientY
  // Align the menu+emoji pair to the bubble edge: outgoing messages
  // sit on the right of the screen so we dock the pair to the right
  // of the click (they extend LEFT); incoming messages are on the
  // left so we dock to the left of the click (they extend RIGHT).
  const align = message.isSender ? 'right' : 'left'
  messageMenuState.value = { show: true, x, y, align, message }
}

function onMessageMenuClose() {
  // Closing the menu also closes the companion emoji bar; the design
  // treats them as a single right-click "surface".
  messageMenuState.value.show = false
  messageMenuState.value.message = null
  // Reset the resolved menu top so a future re-open re-measures.
  resolvedMenuTop.value = 0
  resolvedMenuBottom.value = 0
  menuFlipped.value = false
}

function onMessageMenuSelect({ key, message }) {
  switch (key) {
    case 'copy': {
      const c = message?.content
      const text = c && typeof c === 'object' ? c.content : c
      if (text) navigator.clipboard?.writeText(String(text)).catch(() => {})
      break
    }
    case 'reply': {
      replyTo.value = message
      break
    }
    case 'translate': {
      requestMessageTranslation(message, { force: true })
      break
    }
    case 'show-translation': {
      if (translationSettings.enabled) message.translationVisible = true
      break
    }
case 'transfer': {
      openTransferDialog(message)
      break
    }
    case 'recall': {
      onRecall(message)
      break
    }
    case 'remove': {
      onRemoveMessage(message)
      break
    }
  }
}

// Quick reaction from the floating emoji pill. Closes the menu after
// adding so the user doesn't see lingering overlays — they already got
// the visual feedback (the bubble itself shows the reaction pill).
// Track the right-click menu's resolved top edge so the companion
// MessageContextEmoji overlay can dock directly above it. We measure
// the live DOM via getBoundingClientRect in nextTick + rAF (the
// teleport mounts first, then styles resolve) and stash the value in
// `resolvedMenuTop`. The watcher resets it back to 0 on close.
const menuFlipped = ref(false)

function onQuickReaction({ name, message }) {
  if (!name || !message) return
  onAddReaction(message, name)
  onMessageMenuClose()
}

async function onAddReaction(message, emojiName) {
  if (!juggle) return
  message.reactions = message.reactions || {}
  const list = message.reactions[emojiName] || []
  const currentUserId = juggle.getCurrentUser?.()?.id
  // Optimistic toggle: if the user already has this reaction, remove it.
  const idx = list.findIndex((r) => r.value === currentUserId)
  if (idx >= 0) {
    list.splice(idx, 1)
    if (!list.length) delete message.reactions[emojiName]
    else message.reactions[emojiName] = list
    try {
      await juggle.removeMessageReaction({
        conversationType: message.conversationType,
        conversationId: message.conversationId,
        messageId: message.messageId,
        reactionId: emojiName
      })
    } catch (e) {
      // Re-add on failure
      list.push({ key: emojiName, value: currentUserId, user: { id: currentUserId } })
      message.reactions[emojiName] = list
    }
  } else {
    list.push({ key: emojiName, value: currentUserId, user: { id: currentUserId } })
    message.reactions[emojiName] = list
    try {
      await juggle.addMessageReaction({
        conversationType: message.conversationType,
        conversationId: message.conversationId,
        messageId: message.messageId,
        reactionId: emojiName
      })
    } catch (e) {
      // Roll back
      const j = list.findIndex((r) => r.value === currentUserId)
      if (j >= 0) list.splice(j, 1)
      if (!list.length) delete message.reactions[emojiName]
    }
  }
}

function onMessageReaction({ emoji, message }) {
  onAddReaction(message, emoji.name)
}

async function onRecall(message) {
  if (!juggle || !message) return
  try {
    const result = await juggle.recallMessage(message)
    // SDK replaces the message in-place with a RECALL_INFO-shaped object.
    const idx = imMessages.findIndex((m) => m.messageId === message.messageId)
    if (idx >= 0) {
      imMessages.splice(idx, 1, { ...result, name: MessageType.RECALL_INFO })
    }
  } catch (e) {
    console.warn('[ChatMain] recall failed', e)
  }
}

async function onRemoveMessage(message) {
  if (!juggle || !message) return
  const { conversationId, conversationType, messageId, messageIndex, sentTime, tid } = message
  try {
    await juggle.removeMessages([
      { conversationId, conversationType, messageId, messageIndex, sentTime, tid }
    ])
    const idx = imMessages.findIndex(
      (m) => m.tid === tid || m.messageId === messageId
    )
    if (idx >= 0) imMessages.splice(idx, 1)
  } catch (e) {
    console.warn('[ChatMain] removeMessage failed', e)
  }
}

async function openTransferDialog(message) {
  transferState.value = { show: true, message, targets: [] }
  if (!juggle || typeof juggle.getConversations !== 'function') return
  try {
    const result = await juggle.getConversations({})
    const list = result?.conversations || []
    // The dialog filters out the source conversation itself.
    transferState.value = { show: true, message, targets: list }
  } catch (e) {
    console.warn('[ChatMain] fetch transfer targets failed', e)
  }
}

async function onTransferConfirm({ conversations }) {
  if (!juggle || !transferState.value.message) return
  const src = transferState.value.message
  // For each target conversation, send a merge-forwarded message.
  for (const target of conversations) {
    const shortName = im.msgShortFormat(src)
    const labels = [
      {
        content: shortName,
        userName: src.sender?.name || src.sender?.id || '',
        userId: src.sender?.id || '',
        portrait: src.sender?.portrait || ''
      }
    ]
    const title = `聊天记录`
    try {
      await juggle.sendMergeMessage({
        conversationId: target.conversationId,
        conversationType: target.conversationType,
        messages: [src],
        previewList: labels,
        title
      })
    } catch (e) {
      console.warn('[ChatMain] transfer failed', e)
    }
  }
  transferState.value = { show: false, message: null, targets: [] }
}

// ---------------------------------------------------------------------------
// Image preview
// ---------------------------------------------------------------------------

function onImagePreview({ url }) {
  previewerUrl.value = url
  previewerOpen.value = true
}

function closePreviewer() {
  previewerOpen.value = false
  previewerUrl.value = ''
}

// ---------------------------------------------------------------------------
// IM event handlers
// ---------------------------------------------------------------------------

function isCurrentConversation(message) {
  if (!props.conversation || !message) return false
  return (
    message.conversationId === props.conversation.conversationId &&
    message.conversationType === props.conversation.conversationType
  )
}

function clearPeerTyping() {
  peerTyping.value = false
  if (receiveTypingTimer) {
    clearTimeout(receiveTypingTimer)
    receiveTypingTimer = null
  }
}

function onTypingMessage(message) {
  const isTyping = message?.content?.type === TYPING_STATUS.START
  peerTyping.value = isTyping
  if (receiveTypingTimer) {
    clearTimeout(receiveTypingTimer)
    receiveTypingTimer = null
  }
  if (isTyping) {
    receiveTypingTimer = setTimeout(() => {
      peerTyping.value = false
      receiveTypingTimer = null
    }, 5000)
  }
}

// 当前打开会话收到新消息时，把这条会话的未读清零。
// SDK 会发 CLEAR_UNREAD → CONVERSATION_CHANGED，Conversations 组件
// 的 mapConversation 会基于 unreadCount 重渲染列表项。
async function clearCurrentUnread() {
  if (!juggle || !im.isConnected()) return
  const conv = props.conversation
  if (!conv?.conversationId || !conv?.conversationType) return
  // 取最新一条已展示消息的 unreadIndex；若没有就传 0
  const last = imMessages[imMessages.length - 1]
  const unreadIndex = Number(last?.unreadIndex ?? last?.messageIndex ?? 0) || 0
  try {
    await juggle.clearUnreadcount([{
      conversationType: conv.conversationType,
      conversationId: conv.conversationId,
      unreadIndex
    }])
  } catch (e) {
    console.warn('[ChatMain] clearUnreadcount failed', e)
  }
}

function onMessageReceived(message) {
  if (!message) return
  // 2026-07-21：入口诊断日志。每条 MESSAGE_RECEIVED 都打一条，方便排查
  // "onMessageReceived 根本没被 SDK 推" / "isCurrentConversation 把消息过滤了"
  // / "走到 else if 但没 emit" 这类问题。稳定后可以删。
  if (!isCurrentConversation(message)) {
    // ChatMain remains mounted while another conversation receives a message.
    // Electron still translates that incoming text and persists its local
    // attribute, so opening the conversation later can hydrate it immediately.
    if (!message.isSender && !message.isStatus && message.name !== MSG_NAME.TYPING_NTF &&
        translationSettings.enabled && isTranslatableMessage(message)) {
      requestMessageTranslation(message, { silent: true })
    }
    console.log('[ChatMain] onMessageReceived ignored (not current conversation)', {
      msgId: message.messageId, tid: message.tid,
      msgCid: message.conversationId, msgCtype: message.conversationType
    })
    return
  }
  // The SDK may deliver an "isStatus" typing notification via MESSAGE_RECEIVED
  // for the typing message type. We don't render those.
  if (message.isStatus || message.name === MSG_NAME.TYPING_NTF) {
    onTypingMessage(message)
    return
  }
  // Check if this is a receipt for our own sent message (already in imMessages
  // with isSender=true).
  const idx = imMessages.findIndex(
    (m) =>
      (message.messageId && m.messageId === message.messageId) ||
      (message.tid && m.tid === message.tid)
  )
  const isSelfReceipt = (idx >= 0 && imMessages[idx].isSender) || message.isSender
  if (idx >= 0) {
    // Already in the list (e.g. our optimistic entry) — preserve reactive
    // identity by mutating in place rather than splice-replacing.
    Object.assign(imMessages[idx], message)
  } else {
    // New incoming — push to the end (bottom of oldest-first list).
    imMessages.push(message)
  }
  const activeMessage = idx >= 0 ? imMessages[idx] : message
  hydrateTranslation(activeMessage)
  if (!isSelfReceipt && translationSettings.enabled && isTranslatableMessage(activeMessage)) {
    requestMessageTranslation(activeMessage, { silent: true })
  }
  // Thinking bubble: show when the other party sends a message (agent needs
  // to process and respond). Clear when our own message arrives (e.g. the
  // agent's auto-reply coming back from the server).
  if (isSelfReceipt) {
    clearThinkingState()
  }
  // 2026-07-20：辅助回复模式（当前工单已 binded 一个 agent）下，
  // 客户新消息进来时通知 MainView 去 streamAgentChat 拿 AI 建议。
  // 人工回复（无 selectedAgent）下不触发。
  // 跳过自己发出的回执（同上 isSelfReceipt 已 return thinking）。
  // 2026-07-20 v2 排查更新：之前这条分支"看起来应该触发但实际不触发"，
  // 把每个守卫都拆开方便定位。message.content 可能是 string 也可能是
  // { content: '...', type: ... } 对象，统一抽 text 后再判空。
  else if (!isSelfReceipt) {
    const selected = props.selectedAgent
    const c = message?.content
    const text = c && typeof c === 'object' ? c.content : c
    if (selected && selected.id && text) {
      // 命中：辅助态 + 客户消息有内容 → 触发 stream
      console.log('[ChatMain] trigger agent-assist', {
        agentId: selected.id,
        msgShape: typeof c,
        textPreview: String(text).slice(0, 30)
      })
      thinkingMsg.value = { tid: 'thinking_' + Date.now(), timestamp: Date.now() }
      console.log('[ChatMain] thinking bubble shown------', selected.id, text, thinkingMsg.value)
      startThinkingTimer()
      emit('requestAgentSuggestion', {
        agentId: selected.id,
        customerMessage: String(text)
      })
      // 当前打开的会话收到客户消息 → 清未读（异步，不阻塞流式触发）
      clearCurrentUnread()
    } else {
      // 守卫失败：打印关键字段方便排查"为什么没触发"
      console.log('[ChatMain] skip agent-assist', {
        hasSelected: !!selected,
        agentId: selected?.id,
        msgShape: typeof c,
        hasText: !!text
      })
    }
    // 人工回复模式（无 selectedAgent）：客户消息同样需要清未读
    clearCurrentUnread()
  }
  scrollToBottom()
  // 不论是否当前会话：让 MainView 通知会话列表按当前 filter 重拉一次
  // （不在此处判断 isCurrentConversation，因为 filter 命中与否由 Conversations 决定）。
  emit('conversationChanged')
}

function onMessageRecalled(notify) {
  if (!notify) return
  if (!isCurrentConversation(notify)) return
  const recalledId = notify?.content?.messageId
  if (!recalledId) return
  const idx = imMessages.findIndex((m) => m.messageId === recalledId)
  if (idx >= 0) {
    imMessages.splice(idx, 1, {
      ...notify,
      name: MessageType.RECALL_INFO
    })
  }
}

function onMessageUpdated(notify) {
  if (!notify) return
  if (!isCurrentConversation(notify)) return
  const idx = imMessages.findIndex(
    (m) => m.messageId && m.messageId === notify.messageId
  )
  if (idx >= 0) {
    Object.assign(imMessages[idx], {
      isUpdated: true,
      content: notify.content
    })
    delete imMessages[idx].translation
  }
}

function onMessageRead(notify) {
  if (!notify) return
  if (!isCurrentConversation(notify)) return
  const list = notify.messages || []
  for (const r of list) {
    const idx = imMessages.findIndex(
      (m) => m.messageId && m.messageId === r.messageId
    )
    if (idx < 0) continue
    const msg = imMessages[idx]
    if (isCurrentGroup.value) {
      Object.assign(msg, {
        readCount: r.readCount,
        unreadCount: r.unreadCount
      })
    } else {
      Object.assign(msg, { isRead: true })
    }
  }
}

function onMessageReactionChanged(notify) {
  if (!notify) return
  if (!isCurrentConversation(notify)) return
  const idx = imMessages.findIndex(
    (m) => m.messageId && m.messageId === notify.messageId
  )
  if (idx < 0) return
  const msg = imMessages[idx]
  msg.reactions = msg.reactions || {}
  for (const item of notify.reactions || []) {
    const { isRemove, key, value, user } = item
    const list = msg.reactions[key] || []
    const j = list.findIndex((r) => r.value === value)
    if (isRemove) {
      if (j >= 0) list.splice(j, 1)
    } else if (j < 0) {
      list.push({ key, value, user })
    }
    if (!list.length) delete msg.reactions[key]
    else msg.reactions[key] = list
  }
}

function onMessageRemoved(notify) {
  if (!notify) return
  if (!isCurrentConversation(notify)) return
  for (const r of notify.messages || []) {
    const idx = imMessages.findIndex(
      (m) => m.tid === r.tid || m.messageId === r.messageId
    )
    if (idx >= 0) imMessages.splice(idx, 1)
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

watch(
  () =>
    props.conversation && [
      props.conversation.conversationId,
      props.conversation.conversationType
    ],
  () => {
    imMessages.splice(0, imMessages.length)
    isHistoryFinished.value = false
    replyTo.value = null
    clearPeerTyping()
    typingStartSentAt = 0
    clearThinkingState()
    if (props.conversation && juggle && im.isConnected()) {
      loadHistory().then(scrollToBottom)
    }
  },
  { immediate: true }
)


onMounted(() => {
  ensurePeerStatus()
  emitter.on(EVENT_NAME.TRANSLATION_SETTINGS_CHANGED, onTranslationSettingsChanged)
  if (!juggle?.on) return
  juggle.on(Event.MESSAGE_RECEIVED, onMessageReceived)
  juggle.on(Event.MESSAGE_RECALLED, onMessageRecalled)
  juggle.on(Event.MESSAGE_UPDATED, onMessageUpdated)
  juggle.on(Event.MESSAGE_READ, onMessageRead)
  juggle.on(Event.MESSAGE_REACTION_CHANGED, onMessageReactionChanged)
  juggle.on(Event.MESSAGE_REMOVED, onMessageRemoved)
  document.addEventListener('click', closeAllMenus)
})

onBeforeUnmount(() => {
  clearPeerTyping()
  sendEndTyping()
  emitter.off(EVENT_NAME.TRANSLATION_SETTINGS_CHANGED, onTranslationSettingsChanged)
  if (!juggle?.off) return
  juggle.off(Event.MESSAGE_RECEIVED, onMessageReceived)
  juggle.off(Event.MESSAGE_RECALLED, onMessageRecalled)
  juggle.off(Event.MESSAGE_UPDATED, onMessageUpdated)
  juggle.off(Event.MESSAGE_READ, onMessageRead)
  juggle.off(Event.MESSAGE_REACTION_CHANGED, onMessageReactionChanged)
  juggle.off(Event.MESSAGE_REMOVED, onMessageRemoved)
  document.removeEventListener('click', closeAllMenus)
})

function closeAllMenus() {
  headerMenuOpen.value = false
  if (messageMenuState.value.show) {
    messageMenuState.value.show = false
    messageMenuState.value.message = null
  }
}

// ---------------------------------------------------------------------------
// Header / takeover helpers (kept from the pre-IM version)
// ---------------------------------------------------------------------------

// 2026-07-21：点 × 删除当前流式建议条目（按 trace_id）。
//   不动其他会话、不自动清理 —— 用户明确"只有手动 × 才删"。
// 旧的 dismissSuggestions（整组关闭）已下线。
function handleRejectSuggestion(entry) {
  if (!entry?.traceId) return
  emit('clearStreamSuggestion', entry.traceId)
}

// header 上的 ×：清掉当前会话的全部流式建议（按 sid）。
function handleCloseAllSuggestions() {
  emit('clearAllStreamSuggestions')
}

// 流式建议采用：把 entry.content 填入 composer；流式且为空时拒绝采用，
//   避免半成品被发出。emit('useSuggestion', entry) 留给 MainView 做后续埋点。
function handleSuggestionClick(entry) {
  if (!entry) return
  const text = entry.content || ''
  if (entry.streaming && !text) return
  composerText.value = text
  replyTo.value = null
  // 采用后清掉当前会话的全部 AI 建议（用户已选定，无需保留）。
  emit('clearAllStreamSuggestions')
  nextTick(() => {
    const el = document.querySelector('.jm-sender__input')
    el?.focus()
  })
  emit('useSuggestion', entry)
}

function onCancelReply() {
  replyTo.value = null
}

// 对外暴露：父组件 MainView 通过 ref.`notifyTransferResult` 通知弹层处理结果。
// result = { ok: boolean, message?: string, to_assignee_name?: string }
function notifyTransferResult(result) {
  if (!result) return
  if (result.ok) {
    transferring.value = false
    transferOpen.value = false
  } else {
    transferring.value = false
    // 失败保留弹层，等待用户决定（重选 / 关闭）
    console.warn('[ChatMain] transfer failed:', result.message)
  }
}

defineExpose({ notifyTransferResult, openTransfer })
</script>

<template>
  <main class="tyn-chat-main" :class="{ 'group-chat': isGroup }">
    <!-- Chat Header -->
    <div v-if="conversation || isGroup" class="tyn-chat-header">
      <div class="tyn-chat-header__info">
        <Avatar
          class="tyn-chat-header__avatar"
          :name="isGroup ? (groupName || '群') : (conversation?.name || '?')"
          :avatar="isGroup ? '' : (conversation?.portrait || conversation?.avatar || '')"
          size="md"
        />
        <div class="tyn-chat-header__meta">
          <div class="tyn-chat-header__name">
            {{ isGroup ? groupName : (conversation?.name || '') }}
            <span
              v-if="platformTag"
              class="tyn-chat-header__platform-tag"
              :style="{ color: platformTag.color, backgroundColor: platformTag.color + '14' }"
            >
              {{ platformTag.label }}
            </span>
          </div>
          <div class="tyn-chat-header__sub">
            <!-- 群聊：协作中 -->
            <span v-if="isGroup" class="tyn-chat-header__sub-state">
              <span class="tyn-chat-header__dot"></span>{{ groupAgentCount }} 个 Agent 协作中
            </span>
            <!-- 私聊：在线 / 正在输入中 二选一 -->
            <template v-else>
              <span v-if="!peerTyping" class="tyn-chat-header__sub-state">
                <span
                  class="tyn-chat-header__dot"
                  :class="{ 'tyn-chat-header__dot--offline': !peerOnline }"
                ></span>{{ peerStatusText }}
              </span>
              <span v-else class="tyn-chat-header__sub-state tyn-chat-header__sub-state--typing">
                <span class="tyn-chat-header__typing-dots" aria-hidden="true">
                  <span></span><span></span><span></span>
                </span>
                正在输入中
              </span>
            </template>
          </div>
        </div>
      </div>
      <div class="tyn-chat-header__actions" v-if="isAssignedConversation && !isContactChat">
        <div
          class="tyn-chat-header__agent-mode"
          :data-mode="currentMode"
          :title="modeText"
        >
          <span class="tyn-chat-header__mode-icon" aria-hidden="true" v-html="modeIconSvg"></span>
          <span class="tyn-chat-header__mode-dot"></span>
          <span class="tyn-chat-header__mode-text">{{ modeText }}</span>
        </div>
        <div v-if="!isGroup" class="tyn-chat-header__more-wrap">
          <button
            class="tyn-chat-header__more"
            type="button"
            title="更多功能"
            aria-label="更多功能"
            :aria-expanded="headerMenuOpen"
            @click="toggleHeaderMenu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
          </button>
          <div v-if="headerMenuOpen" class="tyn-chat-header__action-menu" @click.stop>
            <button type="button" class="tyn-chat-header__action-item" @click="selectHeaderAction('transfer')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
              <span>转移</span>
            </button>
          </div>
        </div>
      </div>
      <div class="tyn-chat-header__actions" v-if="!isAssignedConversation && !isContactChat">
        <button
          class="tyn-btn tyn-btn--sm tyn-btn--primary"
          @click="onClaimTicket"
          :disabled="claiming"
        >
          {{ claiming ? '分配中...' : '分配给我' }}
        </button>
      </div>
    </div>

    <!-- Messages Area -->
    <div class="jm-messages" ref="scrollEl" @scroll="onScroll">
      <template v-if="isGroup">
        <!-- Group mode: legacy rendering kept so the existing Agent-group UX
             continues to work. -->
        <div
          v-for="(msg, index) in messages"
          :key="index"
          class="tyn-msg"
          :class="msg.type === 'user' ? 'tyn-msg--outgoing' : 'tyn-msg--incoming'"
        >
          <div class="tyn-msg__avatar">
            {{ msg.type === 'user' ? '👤' : msg.agentEmoji }}
          </div>
          <div>
            <div v-if="msg.type !== 'user'" class="tyn-msg__agent-name">
              {{ msg.agentName }}
            </div>
            <div class="tyn-msg__bubble">{{ msg.text }}</div>
            <div class="tyn-msg__time">{{ msg.type === 'user' ? '你 · 刚刚' : '刚刚' }}</div>
          </div>
        </div>
      </template>
      <template v-else>
        <div v-if="rows.length === 0 && !conversation" class="tyn-empty-state">
          <div class="tyn-empty-state__icon">💬</div>
          <div class="tyn-empty-state__text">暂无会话</div>
        </div>
        <template v-else>
          <!-- The "no more" / "loading" indicators sit at the OLDEST end of
               the list. With oldest-first rendering, that's the visual top
               of the scroll area — where the user lands when they scroll
               up to look for older history. -->
          <div v-if="loadingMore" class="jm-messages__loading">加载中…</div>
          <div v-else-if="isHistoryFinished && rows.length > 0" class="jm-messages__end">
            — 已无更多消息 —
          </div>
          <div
            v-if="rows.length === 0 && conversation"
            class="tyn-empty-state"
          >
            <div class="tyn-empty-state__icon">💬</div>
            <div class="tyn-empty-state__text">暂无消息</div>
          </div>
          <MessageItem
            v-for="row in rows"
            :key="row.tid || row.messageId || `${row.name}-${row.sentTime}`"
            :message="row"
            :prev-message="prevByIndex.get(row)"
            :is-group="isCurrentGroup"
            @resend="onResend"
            @context="onMessageContext"
            @reaction="onMessageReaction"
            @preview="onImagePreview"
            @translation-retry="(message) => requestMessageTranslation(message, { force: true })"
          />
          <!-- Thinking bubble: shown while waiting for agent reply (AI辅助模式) -->
          <div
            v-if="thinkingMsg && !isCurrentGroup && props.selectedAgent"
            class="jm-thinking-bubble"
            :class="{ 'jm-thinking-bubble--timeout': thinkingMsg.timeout }"
          >
            <div v-if="!thinkingMsg.timeout" class="jm-thinking-bubble__dots">
              <span class="jm-thinking-bubble__dot"></span>
              <span class="jm-thinking-bubble__dot"></span>
              <span class="jm-thinking-bubble__dot"></span>
            </div>
            <span class="jm-thinking-bubble__text">
              {{ thinkingMsg.timeout ? `${thinkingMsg.countdown}s 后关闭` : '正在思考中' }}
            </span>
            <button class="jm-thinking-bubble__close"  v-if="thinkingMsg.timeout" @click="clearThinkingState" title="关闭">✕</button>
          </div>
        </template>
      </template>
    </div>


    <!-- Reply quote banner -->
    <ReplyQuote v-if="replyTo && !isGroup" :message="replyTo" @cancel="onCancelReply" />

    <!-- Ticket Claim Banner —— 紧贴输入框上方，提示坐席认领。
         这个 banner 之前放在 header 下方，但消息列表很长时离 composer 太远，
         用户感知不到"现在要分配"。挪到这里后，无论消息多长 banner 始终
         钉在输入框上方。 -->
    <div v-if="showClaimBanner" class="tyn-claim-banner animate-slideDown">
      <div class="tyn-claim-banner__row">
        <div class="tyn-claim-banner__text">
          此对话未分配给您。您想要将此对话分配给自己吗？
          <span
            class="tyn-claim-banner__action"
            :class="{ 'is-busy': claiming }"
            role="button"
            tabindex="0"
            @click="onClaimTicket"
            @keydown.enter.prevent="onClaimTicket"
            @keydown.space.prevent="onClaimTicket"
          >
            <span class="tyn-claim-banner__arrow" aria-hidden="true">→</span>
            <span>{{ claiming ? '分配中...' : '分配给我' }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- 2026-07-21：流式回复建议卡片，贴在输入框上方。
         数据来自 MainView 按 trace_id 维护的 streamSuggestions（当前会话过滤后）。
         streaming=true 时显示脉冲点；content 随 token 增量更新；done 后保留展示。
         点 × → emit('clearStreamSuggestion', traceId)，仅删当前条目。 -->
    <div v-if="streamSuggestions.length > 0" class="jm-suggestion-stream animate-slideDown">
      <div class="jm-suggestion-stream__header">
        <span class="jm-suggestion-stream__pulse"></span>
        <span class="jm-suggestion-stream__title">
          AI 回复建议 · {{ streamSuggestions.length }} 条
        </span>
        <span
          class="jm-suggestion-stream__close"
          role="button"
          aria-label="关闭建议"
          @click="handleCloseAllSuggestions"
        >×</span>
      </div>
      <button
        v-for="entry in streamSuggestions"
        :key="entry.traceId"
        type="button"
        class="jm-suggestion-stream__item"
        :class="{ 'is-streaming': entry.streaming }"
        @click="handleSuggestionClick(entry)"
      >
        <div class="jm-suggestion-stream__body">
          <div class="jm-suggestion-stream__text">{{ entry.content || (entry.streaming ? 'AI 在思考…' : '（空）') }}</div>
        </div>
        <span
          v-if="entry.streaming"
          class="jm-suggestion-stream__dots"
          aria-label="生成中"
        >●●●</span>
      </button>
    </div>

    <!-- Chat Input (P0+ text + P1 attachments) -->
    <MessageSender
      :model-value="composerText"
      :placeholder="conversation ? `发送消息给 ${conversation.name || ''}` : '输入消息...'"
      :send-disabled="!isAssignedConversation && !isContactChat"
      :translation-enabled="translationAvailable"
      :translations-visible="translationSettings.enabled"
      :default-target-lang="translationSettings.targetLang"
      @update:model-value="onComposerInput"
      @focus="onComposerFocus"
      @blur="sendEndTyping"
      @send="onSend"
      @attach="onAttach"
    />

    <!-- Ticket Detail Drawer -->
    <!-- Image lightbox -->
    <ImagePreviewer :show="previewerOpen" :url="previewerUrl" @close="closePreviewer" />

    <!-- Message right-click menu -->
    <MessageMenu
      v-if="messageMenuState.show"
      ref="messageMenuRef"
      :message="messageMenuState.message"
      :x="messageMenuState.x"
      :y="messageMenuState.y"
      :align="messageMenuState.align"
      :translation-enabled="translationAvailable"
      @select="onMessageMenuSelect"
      @close="onMessageMenuClose"
    />

    <!-- Floating quick-reaction pill. Always shown alongside the menu
         in the .fig-aligned design — no separate "表情回复" button.
         `menuTop` is the parent's measured top edge of the menu so
         the pill docks directly above it (no height drift). -->
    <MessageContextEmoji
      v-if="messageMenuState.show"
      :message="messageMenuState.message"
      :x="messageMenuState.x"
      :y="messageMenuState.y"
      :align="messageMenuState.align"
      :menu-flipped="menuFlipped"
      @select="onQuickReaction"
      @close="onMessageMenuClose"
    />

    <!-- Transfer target picker (合并转发消息用，勿动) -->
    <TransferDialog
      :show="transferState.show"
      :conversations="transferState.targets"
      :source="conversation"
      title="选择转发的会话"
      @confirm="onTransferConfirm"
      @cancel="transferState.show = false"
    />

    <!-- 工单转移弹层 —— 把工单转给 ticket 关联 inbox 内其他客服（v3：按 ticket_id 查；仅显示 avatar + nickname） -->
    <TicketTransferDialog
      :show="transferOpen"
      :ticket-id="conversation?.ticket_id || ''"
      :ticket-display-id="ticketDisplayId"
      :current-assignee-name="'我'"
      :fetch-candidates="fetchTransferCandidates"
      @confirm="onTicketTransferConfirm"
      @cancel="closeTransfer"
    />
  </main>
</template>

<style scoped>
.jm-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-soft);
}

.jm-messages__loading,
.jm-messages__end {
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
  padding: 8px 0;
}

/* Ticket Header */
.tyn-ticket-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-bottom: 1px solid var(--border-primary, #e0e0e0);
}

.tyn-ticket-header__info {
  flex: 1;
}

.tyn-ticket-header__title {
  font-weight: 600;
  font-size: 15px;
  color: var(--text-1, #333);
  margin-bottom: 2px;
}

.tyn-ticket-header__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-3, #999);
}

.tyn-ticket-header__status {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.tyn-ticket-header__status.status-0 {
  background: var(--surface-danger, #fef2f2);
  color: var(--text-danger, #dc2626);
}

.tyn-ticket-header__status.status-1 {
  background: var(--surface-warning, #fffbeb);
  color: var(--text-warning, #d97706);
}

.tyn-ticket-header__status.status-2 {
  background: var(--surface-success, #f0fdf4);
  color: var(--text-success, #16a34a);
}

.tyn-ticket-header__id {
  font-family: monospace;
}

/* Ticket Claim Banner —— 紧贴输入框上方，border-top 做分割线 */
.tyn-claim-banner {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 10px 16px;
  background: linear-gradient(180deg, #f5f8ff 0%, #eaf1fc 100%);
  border-top: 1px solid var(--border-info, #c7dcfb);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

/* 顶部小 handle（类底部抽屉的视觉提示） */
.tyn-claim-banner__handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(74, 144, 226, 0.25);
  margin: 2px auto 8px;
}

.tyn-claim-banner__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tyn-claim-banner__text {
  font-size: 13px;
  color: #334155;
  line-height: 1.5;
  flex: 1;
}

/* 「分配给我」—— 用 div 表现成可点击的浅蓝色文字链接 */
.tyn-claim-banner__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #4A90E2;
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease, background 0.15s ease;
}

.tyn-claim-banner__action:hover {
  color: #2E6FBF;
  background: rgba(74, 144, 226, 0.08);
}

.tyn-claim-banner__action:active {
  color: #1F5BA0;
  background: rgba(74, 144, 226, 0.14);
}

.tyn-claim-banner__action:focus-visible {
  outline: 2px solid rgba(74, 144, 226, 0.4);
  outline-offset: 1px;
}

.tyn-claim-banner__action.is-busy {
  color: #94a3b8;
  cursor: progress;
  pointer-events: none;
}

.tyn-claim-banner__arrow {
  font-size: 14px;
  line-height: 1;
  transition: transform 0.2s ease;
}

.tyn-claim-banner__action:hover .tyn-claim-banner__arrow {
  transform: translateX(2px);
}

/* Animation for slide down */
.animate-slideDown {
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Thinking bubble */
.jm-thinking-bubble {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin: 4px 0;
  border-radius: 12px;
  background: var(--bg-secondary, #f0f0f0);
  max-width: fit-content;
}

.jm-thinking-bubble--timeout {
  background: var(--surface-danger, #fef2f2);
}

.jm-thinking-bubble__dots {
  display: flex;
  align-items: center;
  gap: 3px;
}

.jm-thinking-bubble__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-3, #999);
  animation: dot-bounce 1.4s infinite ease-in-out both;
}

.jm-thinking-bubble--timeout .jm-thinking-bubble__dot {
  animation: none;
  background: var(--text-danger, #ef4444);
}

.jm-thinking-bubble__dot:nth-child(1) {
  animation-delay: -0.32s;
}

.jm-thinking-bubble__dot:nth-child(2) {
  animation-delay: -0.16s;
}

.jm-thinking-bubble__text {
  font-size: 13px;
  color: var(--text-2, #666);
}

.jm-thinking-bubble--timeout .jm-thinking-bubble__text {
  color: var(--text-danger, #ef4444);
}

.jm-thinking-bubble__close {
  background: none;
  border: none;
  color: var(--text-3, #999);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  margin-left: 4px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}

.jm-thinking-bubble__close:hover {
  color: var(--text-1, #333);
  background: rgba(0, 0, 0, 0.06);
}

/* === 2026-07-21 流式回复建议（streamSuggestions 卡片列表）===
   复用 --ai / --ai-faint / --text-* 变量，保持与 tyn-suggestion 一致的视觉 */
@keyframes dot-bounce {
  0%, 80%, 100% {
    transform: scale(0.4);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.jm-suggestion-stream {
  margin: 8px 20px 0;
  padding: 10px 12px;
  background: linear-gradient(90deg, var(--ai-faint), #fff);
  border: 1px dashed var(--ai);
  border-radius: var(--r);
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  max-height: 240px;
  overflow-y: auto;
}
.jm-suggestion-stream__header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--ai);
  margin-bottom: 2px;
}
.jm-suggestion-stream__title {
  flex: 1;
  min-width: 0;
}
.jm-suggestion-stream__pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ai);
  animation: dot-bounce 1.2s ease-in-out infinite;
}
.jm-suggestion-stream__item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  font: inherit;
  color: inherit;
  border-radius: 6px;
  transition: background-color 0.15s ease;
}
.jm-suggestion-stream__item:hover {
  background: var(--bg-mute, rgba(0,0,0,0.04));
}
.jm-suggestion-stream__item.is-streaming {
  background: rgba(124, 92, 255, 0.06);
}
.jm-suggestion-stream__body {
  flex: 1;
  min-width: 0;
}
.jm-suggestion-stream__text {
  font-size: 13px;
  color: var(--text-1, #1f1f1f);
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}
.jm-suggestion-stream__dots {
  font-size: 8px;
  letter-spacing: 2px;
  color: var(--ai);
  animation: dot-bounce 1.2s ease-in-out infinite;
  align-self: center;
  flex-shrink: 0;
}
.jm-suggestion-stream__close {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  color: var(--text-3, #999);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
  user-select: none;
}
.jm-suggestion-stream__close:hover {
  background: var(--bg-mute, rgba(0,0,0,0.06));
  color: var(--text-1, #1f1f1f);
}

</style>
