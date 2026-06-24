<script setup>
// Central chat panel. Brings together the migration pieces:
//   - MessageItem dispatcher → renders the message bubbles
//   - ImagePreviewer → lightbox for clicked images
//   - MessageMenu / EmojiPicker → right-click on a message
//   - TransferDialog → forwarding target picker
//   - ReplyQuote → "replying to ..." banner above the composer
//   - ConversationList → IM message events (history, realtime, recall, ...)
//   - juggle.sendMessage / sendImageMessage / sendFileMessage / sendVideoMessage
//     / sendMergeMessage / recallMessage / removeMessages / addMessageReaction
//     / removeMessageReaction for the operation side
//
// IM events are subscribed in onMounted; the conversation-change watcher
// re-fetches history. Group read percentages, read state, and per-message
// sentState are pulled directly from the message object — they update via
// the MESSAGE_READ / MESSAGE_UPDATED events.
//
// The component is intentionally self-contained: it accepts the current
// conversation as a prop and emits back only the things MainView needs to
// know about (e.g. conversation menu ops will be wired in P2 via the
// ConversationList side).

import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import im from '../common/im'
import { SERVER_PATH, post, get } from '../services/api'
import { MSG_NAME, TYPING_STATUS } from '../common/enum'
import utils from '../common/utils'
import chatTime from '../common/chat-time-utils'
import toast from '../common/toast'
import MessageItem from './message/MessageItem.vue'
import MessageSender from './MessageSender.vue'
import MessageMenu from './MessageMenu.vue'
import EmojiPicker from './EmojiPicker.vue'
import ImagePreviewer from './ImagePreviewer.vue'
import TransferDialog from './TransferDialog.vue'
import ReplyQuote from './ReplyQuote.vue'

const props = defineProps({
  conversation: {
    type: Object,
    default: null
  },
  // Fallback / demo messages used when the IM SDK isn't connected yet.
  messages: {
    type: Array,
    default: () => []
  },
  suggestions: {
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
  pendingSuggestions: {
    type: Array,
    default: () => []
  },
  // 当前会话的 AI 辅助模式：0=不使用, 1=协同, 2=托管
  autoMode: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['send', 'useSuggestion', 'revokeTakeover', 'clearSuggestion'])

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
let receiveTypingTimer = null
let typingStartSentAt = 0

// Thinking bubble state — shown after sendText until agent replies or timeout
const thinkingMsg = ref(null)
let thinkingTimer = null
let countdownTimer = null
const COUNTDOWN_SECONDS = 10
// Flag to prevent suggestions watch from clearing thinking during adoption flow
const _adoptingSuggestion = ref(false)

// Image preview
const previewerOpen = ref(false)
const previewerUrl = ref('')

// Message right-click menu
const messageMenuState = ref({ show: false, x: 0, y: 0, message: null })
// Emoji picker (sub-menu of message menu)
const emojiPickerState = ref({ show: false, x: 0, y: 0, message: null })
// Transfer dialog
const transferState = ref({ show: false, message: null, targets: [] })

const juggle = im.getCurrent()

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

// The banner is shown when an Agent is in 托管 state. Selection alone
// (driven by MainView's `suggestions`) does NOT trigger the banner — those
// are two independent signals.
const showTakeoverBanner = computed(
  () => !isCurrentGroup.value && !!props.takenOverAgent
)
const takeoverBannerText = computed(() => {
  if (props.takenOverAgent?.name) return `${props.takenOverAgent.name} 助手接管`
  return '客服助手 接管中'
})
// Header status tip. Driven by *selection*, not 托管. The two states are
// independent:
//   - An Agent is selected (operator is writing in its voice) → red tip
//     "{name} 正在协助回复".
//   - Nothing selected → neutral "人工自主回复".
// The 托管 button on the right side is what triggers the takeover banner;
// it does not affect the tip. That keeps the tip meaningful even when no
// 托管 is active.
const takeoverTipText = computed(() => {
  if (props.selectedAgent?.name) return `${props.selectedAgent.name} 正在协助回复`
  return '人工自主回复'
})
const isTipActive = computed(() => !!props.selectedAgent)
function onRevokeTakeover() {
  // Banner's "收回控制" button — the source of truth for the current
  // conversation's 托管 lives in MainView's takeoverByConv map, so we
  // emit and let the parent drop the entry (which also calls the IM
  // tag-remove SDK call to keep the server in sync).
  emit('revokeTakeover')
}

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
    const incoming = result?.messages || []
    const isFinished = !!result?.isFinished
    for (const m of incoming) {
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
  sendEndTyping()
  // If the user is editing a suggestion, submit "edited" feedback before sending
  const sug = editingSuggestion.value
  if (sug) {
    editingSuggestion.value = null
    const conv = props.conversation
    const convId = conv?.conversationId || conv?.id
    const agentId = props.selectedAgent?.id || props.takenOverAgent?.id
    const sId = await lookupSessionId(convId, conv?.conversationType)
    if (sId) {
      post(SERVER_PATH.AGENT_SESSION_FEEDBACK(sId), {
        action: 'edited',
        agent_msg_id: sug.agent_msg_id || '',
        final_reply_text: text || ''
      }).catch((e) => console.warn('[ChatMain] feedback edited failed', e))
    }
  }
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
    sendStartTyping()
  } else {
    sendEndTyping()
  }
}

function onComposerFocus() {
  sendStartTyping(true)
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
  messageMenuState.value = { show: true, x, y, message }
}

function onMessageMenuClose() {
  messageMenuState.value.show = false
  messageMenuState.value.message = null
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
    case 'reaction': {
      // Pop the emoji picker next to the menu.
      const m = messageMenuState.value
      emojiPickerState.value = {
        show: true,
        x: m.x + 8,
        y: m.y,
        message
      }
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

function onEmojiSelect({ name }) {
  const m = emojiPickerState.value.message
  if (!m) return
  onAddReaction(m, name)
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

function onMessageReceived(message) {
  if (!message) return
  if (!isCurrentConversation(message)) return
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
  // Thinking bubble: show when the other party sends a message (agent needs
  // to process and respond). Clear when our own message arrives (e.g. the
  // agent's auto-reply coming back from the server).
  if (isSelfReceipt) {
    clearThinkingState()
  } else if (!isCurrentGroup.value && props.autoMode !== 0) {
    thinkingMsg.value = { tid: 'thinking_' + Date.now(), timestamp: Date.now() }
    startThinkingTimer()
  }
  scrollToBottom()
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

// Auto-scroll to bottom when agent suggestions appear
watch(
  () => props.suggestions?.length ?? 0,
  (len) => {
    if (_adoptingSuggestion.value) {
      _adoptingSuggestion.value = false
      if (len > 0) scrollToBottom()
      return
    }
    if (len > 0) { clearThinkingState(); scrollToBottom() }
  }
)
watch(
  () => props.pendingSuggestions?.length ?? 0,
  (len) => {
    if (_adoptingSuggestion.value) {
      _adoptingSuggestion.value = false
      if (len > 0) scrollToBottom()
      return
    }
    if (len > 0) { clearThinkingState(); scrollToBottom() }
  }
)

onMounted(() => {
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
  if (messageMenuState.value.show) {
    messageMenuState.value.show = false
    messageMenuState.value.message = null
  }
  if (emojiPickerState.value.show) {
    emojiPickerState.value.show = false
  }
}

// ---------------------------------------------------------------------------
// Header / takeover helpers (kept from the pre-IM version)
// ---------------------------------------------------------------------------

// Suggestion feedback: tracks which suggestion is being edited so we can
// submit an "edited" feedback when the user sends the modified text.
const editingSuggestion = ref(null)

async function lookupSessionId(convId, convType) {
  if (!convId) return null
  const sessionId = convId + '_' + String(convType || '')
  try {
    const res = await get(SERVER_PATH.AGENT_SESSION_LOOKUP, { session_id: sessionId })
    if (res?.code === 0 && res.data?.session_id) {
      return res.data.session_id
    }
  } catch (e) {
    console.warn('[ChatMain] session lookup failed', e)
  }
  return null
}

async function handleAdoptSuggestion(suggestion) {
  if (!suggestion) return
  // 仅当有 agent_msg_id 时调用 Feedback API（实时 pending 建议没有）
  if (suggestion.agent_msg_id) {
    const conv = props.conversation
    const convId = conv?.conversationId || conv?.id
    const agentId = props.selectedAgent?.id || props.takenOverAgent?.id
    const sId = await lookupSessionId(convId, conv?.conversationType)
    if (sId) {
      try {
        await post(SERVER_PATH.AGENT_SESSION_FEEDBACK(sId), {
          action: 'adopted',
          agent_msg_id: suggestion.agent_msg_id || '',
          final_reply_text: suggestion.text || ''
        })
      } catch (e) {
        console.warn('[ChatMain] feedback adopted failed', e)
      }
    }
  }
  _adoptingSuggestion.value = true
  emit('clearSuggestion', suggestion.msg_id)
  await sendText(suggestion.text)
}

function handleEditSuggestion(suggestion) {
  handleSuggestionClick(suggestion)
  editingSuggestion.value = suggestion
  // 编辑即视为处理，从 pending 队列清除
  if (suggestion.msg_id) {
    emit('clearSuggestion', suggestion.msg_id)
  }
}

async function handleRejectSuggestion(suggestion) {
  if (!suggestion) return
  // 仅当有 agent_msg_id 时调用 Feedback API
  if (suggestion.agent_msg_id) {
    const conv = props.conversation
    const convId = conv?.conversationId || conv?.id
    const agentId = props.selectedAgent?.id || props.takenOverAgent?.id
    const sId = await lookupSessionId(convId, conv?.conversationType)
    if (sId) {
      try {
        await post(SERVER_PATH.AGENT_SESSION_FEEDBACK(sId), {
          action: 'rejected',
          agent_msg_id: suggestion.agent_msg_id || '',
          reject_reason: ''
        })
      } catch (e) {
        console.warn('[ChatMain] feedback rejected failed', e)
      }
    }
  }
  emit('clearSuggestion', suggestion.msg_id)
}

function handleSuggestionClick(suggestion) {
  // The composer state lives here (passed into MessageSender via v-model),
  // so the click handler should fill the input directly — reaching into the
  // DOM from the parent would be brittle and skip Vue's reactivity.
  if (!suggestion) return
  composerText.value = suggestion.text || ''
  // Drop any pending reply quote: the user is composing a new suggested
  // reply, not responding to the quoted message.
  replyTo.value = null
  nextTick(() => {
    const el = document.querySelector('.jm-sender__input')
    el?.focus()
  })
  emit('useSuggestion', suggestion)
}

function getPlatformLabel(platform) {
  const labels = {
    douyin: '🎵 抖音',
    xhs: '📕 小红书',
    tg: '✈️ Telegram'
  }
  return labels[platform] || ''
}

function onCancelReply() {
  replyTo.value = null
}
</script>

<template>
  <main class="tyn-chat-main" :class="{ 'group-chat': isGroup }">
    <!-- Chat Header -->
    <div v-if="conversation || isGroup" class="tyn-chat-header">
      <div class="tyn-chat-header__info">
        <div class="tyn-chat-header__avatar">
          {{ isGroup ? (groupName || '群').charAt(0) : (conversation?.name || '?').charAt(0) }}
        </div>
        <div>
          <div class="tyn-chat-header__name">
            {{ isGroup ? groupName : (conversation?.name || '') }}
          </div>
          <div class="tyn-chat-header__platform">
            {{
              isGroup
                ? `${groupAgentCount} 个 Agent 协作中`
                : `${getPlatformLabel(conversation?.platform)} · ${peerTyping ? '对方正在输入...' : '在线'}`
            }}
          </div>
        </div>
      </div>
      <div class="tyn-chat-header__actions" v-if="!isGroup">
        <div
          class="tyn-chat-header__takeover-tip"
          :class="{ 'is-active': isTipActive }"
          :title="takeoverTipText"
        >
          <span class="tyn-chat-header__takeover-dot" aria-hidden="true"></span>
          <span class="tyn-chat-header__takeover-text">{{ takeoverTipText }}</span>
        </div>
      </div>
    </div>

    <!-- Takeover Banner -->
    <div v-if="showTakeoverBanner" class="tyn-takeover-banner animate-slideDown">
      <div class="tyn-takeover-banner__text">
        <span class="tyn-takeover-banner__pulse"></span>
        <span>{{ takeoverBannerText }}</span>
      </div>
      <button class="tyn-btn tyn-btn--sm tyn-btn--danger-outline" @click="onRevokeTakeover">
        收回控制
      </button>
    </div>

    <!-- Pending Agent Suggestions -->
    <div v-if="pendingSuggestions.length > 0" class="tyn-takeover-banner animate-slideDown" style="background: var(--surface-warning, #fffbeb); border-color: var(--border-warning, #fbbf24);">
      <div class="tyn-takeover-banner__text">
        <span>{{ pendingSuggestions.length }} 条大模型回复建议待处理</span>
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
          />
          <!-- Thinking bubble: shown while waiting for agent reply (AI辅助模式) -->
          <div
            v-if="thinkingMsg && !isCurrentGroup && autoMode !== 0"
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

    <!-- Agent Suggestions (only in conversation mode) -->
    <div v-if="!isGroup && suggestions.length > 0" class="tyn-agent-suggestions">
      <div class="tyn-agent-suggestions__title">Agent 回复建议</div>
      <div class="tyn-suggestion-cards">
        <div
          v-for="(suggestion, index) in suggestions"
          :key="index"
          class="tyn-suggestion-card"
          @click="handleSuggestionClick(suggestion)"
        >
          <div class="tyn-suggestion-card__agent">{{ suggestion.agent }}</div>
          <div class="tyn-suggestion-card__text">{{ suggestion.text }}</div>
          <div class="tyn-suggestion-card__actions">
            <button class="tyn-btn tyn-btn--xs tyn-btn--primary" @click.stop="handleAdoptSuggestion(suggestion)">采纳</button>
            <button class="tyn-btn tyn-btn--xs" @click.stop="handleEditSuggestion(suggestion)">编辑</button>
            <button class="tyn-btn tyn-btn--xs tyn-btn--ghost" @click.stop="handleRejectSuggestion(suggestion)">拒绝</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Reply quote banner -->
    <ReplyQuote v-if="replyTo && !isGroup" :message="replyTo" @cancel="onCancelReply" />

    <!-- Chat Input (P0+ text + P1 attachments) -->
    <MessageSender
      :model-value="composerText"
      :placeholder="conversation ? `发送消息给 ${conversation.name || ''}` : '输入消息...'"
      @update:model-value="onComposerInput"
      @focus="onComposerFocus"
      @blur="sendEndTyping"
      @send="onSend"
      @attach="onAttach"
    />

    <!-- Image lightbox -->
    <ImagePreviewer :show="previewerOpen" :url="previewerUrl" @close="closePreviewer" />

    <!-- Message right-click menu -->
    <MessageMenu
      v-if="messageMenuState.show"
      :message="messageMenuState.message"
      :x="messageMenuState.x"
      :y="messageMenuState.y"
      @select="onMessageMenuSelect"
      @close="onMessageMenuClose"
    />

    <!-- Emoji picker (sub-menu) -->
    <EmojiPicker
      v-if="emojiPickerState.show"
      :x="emojiPickerState.x"
      :y="emojiPickerState.y"
      @select="onEmojiSelect"
      @close="emojiPickerState.show = false"
    />

    <!-- Transfer target picker -->
    <TransferDialog
      :show="transferState.show"
      :conversations="transferState.targets"
      :source="conversation"
      title="选择转发的会话"
      @confirm="onTransferConfirm"
      @cancel="transferState.show = false"
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
  background: #F8FAFC;
}

.jm-messages__loading,
.jm-messages__end {
  text-align: center;
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 8px 0;
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
  background: var(--text-tertiary, #999);
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
  color: var(--text-secondary, #666);
}

.jm-thinking-bubble--timeout .jm-thinking-bubble__text {
  color: var(--text-danger, #ef4444);
}

.jm-thinking-bubble__close {
  background: none;
  border: none;
  color: var(--text-tertiary, #999);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  margin-left: 4px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}

.jm-thinking-bubble__close:hover {
  color: var(--text-primary, #333);
  background: rgba(0, 0, 0, 0.06);
}

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
</style>
