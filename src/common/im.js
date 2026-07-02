import { reactive, ref } from 'vue'
import JuggleChat from '../libs/juggleim-es-1.9.13'
import { CONFIG } from '../config'
import Storage from './storage'
import { STORAGE, MSG_NAME, CONVERSATION_TAG_ID } from './enum'

const { Event, ConnectionState, ErrorType } = JuggleChat

let juggle = null
let stateListener = null
// Connection state tracking so callers can avoid issuing duplicate connect() calls.
let _connecting = false

// 响应式连接状态 — UI 可以拿来展示「连接中/已连接」之类的状态指示。
export const connectionState = ref(false)

// ---------------------------------------------------------------------------
// Conversation tags (a.k.a. 会话分组).
//
// The IM SDK exposes a "conversation tag" primitive that is the canonical
// place to store user-defined groupings of conversations. The customer-facing
// "接管中" filter on the left sidebar is backed by one of these tags — we
// reserve a fixed tag id (TAKEOVER_TAG_ID) for it. When the operator enables
// 托管 for the active conversation we add it to the tag; when they revoke
// it (or switch away) we remove it. The SDK is the source of truth, but we
// also keep a local reactive Set so the sidebar can re-render without a
// round-trip. The SDK emits TAG_CONVERSATION_ADDED / TAG_CONVERSATION_REMOVED
// events that we listen to in init() to keep the set in sync — including
// when the change came from another device.
// ---------------------------------------------------------------------------
// 工单相关的两个会话 tag id。和 enum.js 里的 CONVERSATION_TAG_ID 一一对应，
// 这里再取个别名方便在文件内引用，并且把它们也声明成可导出的常量。
//   ASSIGNED_TAG_ID  — 工单被认领后，对应会话被打上（全员共享）
//   MY_TICKET_TAG_ID — 仅当前认领人额外打上（用于"我的"过滤）
const ASSIGNED_TAG_ID = CONVERSATION_TAG_ID.ASSIGNED
const MY_TICKET_TAG_ID = CONVERSATION_TAG_ID.MY_TICKET
// 响应式集合，key = `${conversationType}_${conversationId}`。和 takeover 那组
// 一样的设计：SDK 是 source of truth，本地这份 set 是 sidebar 用来做 O(1)
// 渲染判断的镜像。SDK 的 TAG_CONVERSATION_ADDED / TAG_CONVERSATION_REMOVED
// 事件会驱动本地的 add/remove（见下面的 init 监听），包括来自其他设备的变更。
const assignedTagConversations = reactive(new Set())
const myTicketTagConversations = reactive(new Set())

// 判断某会话是否被打上 assigned / my_ticket tag（本地 set 镜像的便捷封装）。
// 注意：tag 是多槽位的，任意一个会话都可以同时在多个 tag 组里。
function isInAssignedTag(c) {
  if (!c) return false
  return assignedTagConversations.has(getConversationKey(c))
}
function isInMyTicketTag(c) {
  if (!c) return false
  return myTicketTagConversations.has(getConversationKey(c))
}

// 把 TAG_CONVERSATION_ADDED / TAG_CONVERSATION_REMOVED 事件分派到对应 tag 的
// 本地 set。和 applyTagChange 的 takeover 版本结构一致，合并为一个分发函数，
// 因为三种 tag（takeover / assigned / my_ticket）的处理方式完全一样。
function applyTicketTagChange(event, payload = {}) {
  const { id, conversations = [] } = payload
  if (id === undefined || id === null) return
  let target = null
  if (id === TAKEOVER_TAG_ID) target = takeoverTagConversations
  else if (id === ASSIGNED_TAG_ID) target = assignedTagConversations
  else if (id === MY_TICKET_TAG_ID) target = myTicketTagConversations
  if (!target) return
  for (const c of conversations) {
    const key = getConversationKey(c)
    if (!key) continue
    if (event === 'add') target.add(key)
    else if (event === 'remove') target.delete(key)
  }
}

// 用拉回来的会话列表同步 assigned / my_ticket 两个本地 set。逻辑和
// reconcileTakeoverTag 完全一样，只是把目标 set 换掉。多次调用是幂等的：
// 先清空再用 server 的视图重写，比增量 patch 简单也更不容易出错。
function syncTicketTagsFromList(list = []) {
  if (!Array.isArray(list)) return { assigned: [], mine: [] }
  const inAssigned = []
  const inMine = []
  for (const c of list) {
    if (!Array.isArray(c.tags)) continue
    const key = getConversationKey(c)
    if (!key) continue
    if (c.tags.some(t => t?.tag === ASSIGNED_TAG_ID)) inAssigned.push(c)
    if (c.tags.some(t => t?.tag === MY_TICKET_TAG_ID)) inMine.push(c)
  }
  assignedTagConversations.clear()
  for (const c of inAssigned) assignedTagConversations.add(getConversationKey(c))
  myTicketTagConversations.clear()
  for (const c of inMine) myTicketTagConversations.add(getConversationKey(c))
  return { assigned: inAssigned, mine: inMine }
}

const TAKEOVER_TAG_ID = 'jm_takeover'
// Keyed by `${conversationType}_${conversationId}` — type is part of the key
// because a private chat and a group chat can share the same numeric id.
// The takeover tag is multi-slot: any number of conversations can be in it
// at once, each tracked independently. The set is the reactive source for
// the sidebar's "接管中" filter.
const takeoverTagConversations = reactive(new Set())

function getConversationKey(c) {
  if (!c) return ''
  const id = c.conversationId || c.id
  if (id === undefined || id === null) return ''
  return `${c.conversationType}_${id}`
}

function isInTakeoverTag(c) {
  if (!c) return false
  return takeoverTagConversations.has(getConversationKey(c))
}

function applyTagChange(event, payload = {}) {
  const { id, conversations = [] } = payload
  if (id !== TAKEOVER_TAG_ID) return
  for (const c of conversations) {
    const key = getConversationKey(c)
    if (!key) continue
    if (event === 'add') takeoverTagConversations.add(key)
    else if (event === 'remove') takeoverTagConversations.delete(key)
  }
}

// Sync the local set with the server's view of the takeover tag, based
// on the freshly fetched conversation list. Multi-slot: every conversation
// carrying the takeover tag is mirrored, none are evicted. Returns the
// conversations that are in the tag (handy for debugging / the caller
// that wants to know "which conversations are currently in the 接管中
// group right now").
async function reconcileTakeoverTag(list = []) {
  if (!Array.isArray(list)) return []
  const tagged = list.filter((c) =>
    Array.isArray(c.tags) && c.tags.some((t) => t?.tag === TAKEOVER_TAG_ID)
  )
  // Single-pass reset of the local state — mirroring the server's view
  // is simpler (and more correct) than patching incrementally. The set
  // is what the sidebar reads.
  takeoverTagConversations.clear()
  for (const c of tagged) {
    takeoverTagConversations.add(getConversationKey(c))
  }
  return tagged
}

// Backwards-compatible entry point. ConversationList calls this after
// fetching conversations to populate the local set; reconcile is the
// actual work, this is just a clear name at the call site.
function syncTakeoverTagFromList(list = []) {
  return reconcileTakeoverTag(list)
}

/**
 * Initialize the JuggleIM client with the configured appkey and server list.
 * Safe to call multiple times — only the first call creates the client.
 */
function init() {
  if (juggle) return juggle
  // OSS 上传适配器在当前项目里没有用到（SDK 内部 upload = upload || {} 兼容 undefined），
  // 这里用 typeof 探测避免「OSS 未声明」抛 ReferenceError。如果将来接 OSS，
  // 在这里 import 然后赋值给 option.upload 即可。
  const option = {
    appkey: CONFIG.APP_KEY,
    serverList: CONFIG.IM_SERVERS
  }
  if (typeof globalThis.OSS !== 'undefined' && globalThis.OSS) {
    option.upload = globalThis.OSS
  }
  juggle = JuggleChat.init(option)
  // Register custom message types. Same names as snailchat's registration so
  // server-side content routing stays compatible. The third flag `isStorage`
  // controls whether messages of this name are persisted to the local DB.
  if (typeof juggle.registerMessage === 'function') {
    juggle.registerMessage([
      { name: MSG_NAME.GROUP_NTF, isCount: true, isStorage: true },
      { name: MSG_NAME.FRIEND_NTF, isCount: true, isStorage: true },
      { name: MSG_NAME.CONTACT_CARD, isCount: true, isStorage: true },
      { name: MSG_NAME.ANIMATION_STICKER, isCount: true, isStorage: true },
      { name: MSG_NAME.TYPING_NTF, isStatus: true },
      { name: MSG_NAME.REPLAY_MSG, isCount: true, isStorage: true },
      { name: MSG_NAME.TICKET_ASSIGN, isCount: true, isStorage: true }
    ])
  }
  // Keep the takeover-tag local set in sync with the SDK. The events come
  // back from the server after a successful addConversationsToTag /
  // removeConversationsFromTag call, so the local state will reflect the
  // authoritative answer once the round-trip completes — even if the call
  // was triggered from another device.
  if (typeof juggle.on === 'function') {
    // 单一分发函数同时接管 takeover / assigned / my_ticket 三种 tag 的本地
    // set 同步。事件来源可能是本机调用，也可能是其他设备 — 两种情况都需要
    // 让本地 set 最终和服务端一致。
    juggle.on(Event.TAG_CONVERSATION_ADDED, (payload) => applyTicketTagChange('add', payload))
    juggle.on(Event.TAG_CONVERSATION_REMOVED, (payload) => applyTicketTagChange('remove', payload))
  }
  return juggle
}

function getCurrent() {
  return juggle
}

function isConnected() {
  // 双写：优先看响应式 ref（用于 watch），但也直接问 SDK 兜底
  // 那些没经过 connect() 的场景（比如 juggle.isConnected 内部状态切换）。
  const fromRef = connectionState.value
  const fromSdk = !!(juggle && juggle.isConnected && juggle.isConnected())
  return fromRef || fromSdk
}

function setConnectionState(connected) {
  if (connectionState.value !== connected) {
    connectionState.value = connected
  }
}

function teardownListener() {
  if (juggle && stateListener && typeof juggle.off === 'function') {
    juggle.off(Event.STATE_CHANGED, stateListener)
  }
  stateListener = null
}

/**
 * Connect to the IM server.
 * @param {object} user - The logged-in user record from Storage (must have user_id and im_token).
 * @param {object} callbacks - { success(user), error(juggle) }
 */
function connect(user, callbacks = {}) {
  init()
  const { success, error } = callbacks

  console.log('[im] connect called — user:', user ? { hasId: !!user.id, hasToken: !!user.token, id: user.id } : null)

  // Idempotent: if already connected, resolve immediately.
  if (juggle.isConnected()) {
    console.log('[im] already connected, resolving success immediately')
    setConnectionState(true)
    if (success) success(juggle.getCurrentUser())
    return
  }

  teardownListener()
  _connecting = true
  setConnectionState(false)
  stateListener = ({ state }) => {
    console.log('[im] state changed:', state)
    if (state === ConnectionState.CONNECTED) {
      _connecting = false
      setConnectionState(true)
      const imUser = juggle.getCurrentUser()
      console.log('[im] CONNECTED — imUser:', imUser)
      // Refresh the stored token with whatever the IM server returned.
      const stored = Storage.get(STORAGE.USER_TOKEN) || {}
      Storage.set(STORAGE.USER_TOKEN, { ...stored, ...imUser })
      if (success) success(imUser)
    } else if (state === ConnectionState.DISCONNECTED) {
      _connecting = false
      setConnectionState(false)
      console.log('[im] DISCONNECTED')
    }
  }
  juggle.on(Event.STATE_CHANGED, stateListener)

  const { id: userId, token } = user || {}
  if (!userId || !token) {
    console.error('[im] connect failed — missing userId or token:', { hasUserId: !!userId, hasToken: !!token })
    if (error) error(juggle, new Error('missing id or token on user record'))
    return
  }

  console.log('[im] calling juggle.connect with userId:', userId, 'token length:', token?.length)
  juggle.connect({ userId, token }).then(
    () => {
      console.log('[im] juggle.connect() resolved')
    },
    (err) => {
      _connecting = false
      setConnectionState(false)
      console.error('[im] juggle.connect() rejected:', err?.message || err)
      if (error) error(juggle, err)
    }
  )
}

/**
 * Disconnect from the IM server and detach the state listener.
 * Safe to call when not connected.
 */
function disconnect() {
  teardownListener()
  setConnectionState(false)
  // The takeover tag is per-user — clear the local mirror so a different
  // account signing in on the same browser doesn't see stale rows.
  // assigned / my_ticket 同样是 per-user 的（my_ticket 的语义是"我的"），
  // 登出时一并清空。
  takeoverTagConversations.clear()
  assignedTagConversations.clear()
  myTicketTagConversations.clear()
  if (juggle && typeof juggle.disconnect === 'function') {
    try {
      juggle.disconnect()
    } catch (e) {
      // swallow — disconnect is best-effort during logout
    }
  }
}

function sendTyping(conversation, content) {
  if (!juggle?.sendMessage || !conversation) return Promise.resolve()
  const { conversationId, conversationType } = conversation
  if (!conversationId || conversationType === undefined || conversationType === null) {
    return Promise.resolve()
  }
  return juggle.sendMessage({
    conversationId,
    conversationType,
    name: MSG_NAME.TYPING_NTF,
    content
  }, { onbefore: () => {} })
}

// ---------------------------------------------------------------------------
// Tag helpers — the only public surface for "接管中" group operations.
// All callers (MainView, ConversationList, etc.) should go through these
// rather than calling juggle.addConversationsToTag directly, so the local
// reactive set stays consistent and the takeover tag id is defined in one
// place.
// ---------------------------------------------------------------------------

// 给指定会话打上 / 摘掉 assigned tag（业务调用点：工单被认领 / 转移 / 释放）。
// 内部构造的 payload 形如 { id: 'assigned', conversations: [...] }，调用
// juggle.addConversationsToTag / removeConversationsFromTag。SDK 本身允许一个
// tag 里装任意多个会话，重复 add 是 no-op，所以幂等。
async function addConversationToAssignedTag(conversation) {
  if (!juggle?.addConversationsToTag) return false
  const payload = buildTicketTagPayload(ASSIGNED_TAG_ID, conversation)
  if (!payload) return false
  try {
    await juggle.addConversationsToTag(payload)
    applyTicketTagChange('add', { id: ASSIGNED_TAG_ID, conversations: payload.conversations })
    return true
  } catch (e) {
    console.warn('[im] addConversationToAssignedTag failed', e)
    return false
  }
}
async function removeConversationFromAssignedTag(conversation) {
  if (!juggle?.removeConversationsFromTag) return false
  const payload = buildTicketTagPayload(ASSIGNED_TAG_ID, conversation)
  if (!payload) return false
  try {
    await juggle.removeConversationsFromTag(payload)
    applyTicketTagChange('remove', { id: ASSIGNED_TAG_ID, conversations: payload.conversations })
    return true
  } catch (e) {
    console.warn('[im] removeConversationFromAssignedTag failed', e)
    return false
  }
}

// 给"我"打 / 摘 my_ticket tag。和 assigned 的实现共用一个 payload 构造函数。
// 注意：my_ticket 是 per-user 的 — 不同账号登录时 SDK 各自维护各自的 tag 成员。
async function addConversationToMyTicketTag(conversation) {
  if (!juggle?.addConversationsToTag) return false
  const payload = buildTicketTagPayload(MY_TICKET_TAG_ID, conversation)
  if (!payload) return false
  try {
    await juggle.addConversationsToTag(payload)
    applyTicketTagChange('add', { id: MY_TICKET_TAG_ID, conversations: payload.conversations })
    return true
  } catch (e) {
    console.warn('[im] addConversationToMyTicketTag failed', e)
    return false
  }
}
async function removeConversationFromMyTicketTag(conversation) {
  if (!juggle?.removeConversationsFromTag) return false
  const payload = buildTicketTagPayload(MY_TICKET_TAG_ID, conversation)
  if (!payload) return false
  try {
    await juggle.removeConversationsFromTag(payload)
    applyTicketTagChange('remove', { id: MY_TICKET_TAG_ID, conversations: payload.conversations })
    return true
  } catch (e) {
    console.warn('[im] removeConversationFromMyTicketTag failed', e)
    return false
  }
}

// 构造 add/remove 助手共用的 payload。和 buildTakeoverTagPayload 同形，但
// 接受 tag id 参数，避开重复代码。返回 null 表示输入不合法，调用方需要早退。
function buildTicketTagPayload(tagId, conversation) {
  if (!conversation) return null
  const conversationId = conversation.conversationId || conversation.id
  if (conversationId === undefined || conversationId === null) return null
  if (conversation.conversationType === undefined || conversation.conversationType === null) return null
  return {
    id: tagId,
    conversations: [{
      conversationType: conversation.conversationType,
      conversationId
    }]
  }
}

function buildTakeoverTagPayload(conversation) {
  if (!conversation) return null
  const conversationId = conversation.conversationId || conversation.id
  if (conversationId === undefined || conversationId === null) return null
  if (conversation.conversationType === undefined || conversation.conversationType === null) {
    return null
  }
  return {
    id: TAKEOVER_TAG_ID,
    conversations: [{
      conversationType: conversation.conversationType,
      conversationId
    }]
  }
}

async function addConversationToTakeoverTag(conversation) {
  if (!juggle?.addConversationsToTag) return false
  const tag = buildTakeoverTagPayload(conversation)
  if (!tag) return false
  // Multi-slot: the tag can hold any number of conversations. The SDK's
  // addConversationsToTag is a set-union — adding a conversation that's
  // already in the tag is a server-side no-op. We still update the local
  // mirror optimistically so the sidebar filter reacts immediately,
  // without waiting for the TAG_CONVERSATION_ADDED echo.
  try {
    await juggle.addConversationsToTag(tag)
    applyTagChange('add', { id: TAKEOVER_TAG_ID, conversations: tag.conversations })
    return true
  } catch (e) {
    console.warn('[im] addConversationToTakeoverTag failed', e)
    return false
  }
}

async function removeConversationFromTakeoverTag(conversation) {
  if (!juggle?.removeConversationsFromTag) return false
  const tag = buildTakeoverTagPayload(conversation)
  if (!tag) return false
  try {
    await juggle.removeConversationsFromTag(tag)
    applyTagChange('remove', { id: TAKEOVER_TAG_ID, conversations: tag.conversations })
    return true
  } catch (e) {
    console.warn('[im] removeConversationFromTakeoverTag failed', e)
    return false
  }
}

async function fetchConversationTags() {
  // Returns the user's full tag list (id + name). Useful when the sidebar's
  // "接管中" filter is clicked: the operator can see which tag groups are
  // available, and the takeover tag's existence is implied by the id used
  // in TAKEOVER_TAG_ID.
  if (!juggle?.getConversationTags) return { tags: [] }
  try {
    const result = await juggle.getConversationTags()
    return { tags: result?.tags || [] }
  } catch (e) {
    console.warn('[im] fetchConversationTags failed', e)
    return { tags: [] }
  }
}

// ---------------------------------------------------------------------------
// Message helpers — used by the conversation list to show "last message" previews
// and by the message bubble dispatcher to route by message.name.
// ---------------------------------------------------------------------------

/**
 * Render a short human label for a message. Mirrors snailchat's msgShortFormat
 * but trimmed: no mention parsing, no language-aware text rewriting. If the
 * caller doesn't have a full conversation, this is still safe to call.
 */
function msgShortFormat(message) {
  if (!message) return ''
  const { MessageType } = JuggleChat
  const { name, content } = message
  if (name === MessageType.TEXT) {
    if (content && typeof content === 'object' && content.content) {
      return String(content.content)
    }
    if (typeof content === 'string') return content
  }
  if (name === MessageType.IMAGE) return '[图片]'
  if (name === MessageType.VOICE) return '[语音]'
  if (name === MessageType.VIDEO) return '[视频]'
  if (name === MessageType.FILE) {
    if (content && content.name) return `[文件] ${content.name}`
    return '[文件]'
  }
  if (name === MessageType.MERGE) return '[合并转发]'
  if (name === MSG_NAME.CONTACT_CARD) return '[名片]'
  if (name === MSG_NAME.ANIMATION_STICKER) return '[表情]'
  if (name === MSG_NAME.TYPING_NTF) return ''
  if (name === MSG_NAME.REPLAY_MSG) return '[群接龙]'
  if (name === MSG_NAME.GROUP_NTF) return '[群通知]'
  if (name === MSG_NAME.TICKET_ASSIGN) return formatTicketAssignPreview(content)
  if (name === MSG_NAME.FRIEND_NTF) return '[好友通知]'
  if (name === MessageType.RECALL_INFO) return '[撤回了一条消息]'
  if (name === MessageType.CALL_1V1_FINISHED) return '[通话结束]'
  return '[消息]'
}

// Render a short preview for a jgm:ticketassign message. The IM SDK
// normally hands us the content as an object, but on freshly parsed
// payloads (or older message records) it can arrive as a JSON string —
// parse defensively so we never blow up the conversation list.
function formatTicketAssignPreview(rawContent) {
  const payload = parseTicketAssignContent(rawContent)
  if (!payload) return '[工单分配]'
  const op = payload.operator?.nickname || ''
  const ae = payload.assignee?.nickname || ''
  if (payload.assign_type === 0) {
    // 自助认领
    return ae ? `${ae} 认领了工单` : '已认领工单'
  }
  // 分配给他人
  if (op && ae) return `由 ${op} 分配给 ${ae}`
  if (ae) return `已分配给 ${ae}`
  return '[工单分配]'
}

function parseTicketAssignContent(rawContent) {
  if (!rawContent) return null
  if (typeof rawContent === 'object') return rawContent
  if (typeof rawContent === 'string') {
    try {
      return JSON.parse(rawContent)
    } catch {
      return null
    }
  }
  return null
}

function isUnreadTag(conversation) {
  if (!conversation || !juggle) return false
  const { UnreadTag } = JuggleChat
  return conversation.unreadTag === UnreadTag.UNREAD
}

// Re-export the SDK enums so callers can do `import im from '@/common/im'; im.MessageType.TEXT`
// without having to import JuggleChat directly. Mirrors snailchat's im.js API.
const {
  ConversationType,
  MessageType,
  ConversationOrder,
  MessageOrder,
  MentionType,
  MentionOrder,
  FileType,
  UndisturbType,
  SentState,
  UnreadTag,
  ConversationTagType,
  MediaType,
  UserType,
  StreamEvent,
  ConversationTopType,
  PlatformType,
  PushChannel,
  UserStatus
} = JuggleChat

export default {
  init,
  getCurrent,
  isConnected,
  isConnecting: () => _connecting,
  connect,
  disconnect,
  sendTyping,
  msgShortFormat,
  isUnreadTag,
  // Tag ("接管中" group) helpers. See TAKEOVER_TAG_ID above.
  TAKEOVER_TAG_ID,
  isInTakeoverTag,
  syncTakeoverTagFromList,
  reconcileTakeoverTag,
  addConversationToTakeoverTag,
  removeConversationFromTakeoverTag,
  fetchConversationTags,
  // Ticket tag helpers. assigned / my_ticket 是工单认领流程用的两个会话 tag。
  ASSIGNED_TAG_ID,
  MY_TICKET_TAG_ID,
  isInAssignedTag,
  isInMyTicketTag,
  syncTicketTagsFromList,
  addConversationToAssignedTag,
  removeConversationFromAssignedTag,
  addConversationToMyTicketTag,
  removeConversationFromMyTicketTag,
  formatTicketAssignPreview,
  // 响应式连接状态 — 用于 UI 展示「连接中 / 已连接」之类的指示
  connectionState,
  Event,
  ConnectionState,
  ErrorType,
  ConversationType,
  MessageType,
  ConversationOrder,
  MessageOrder,
  MentionType,
  MentionOrder,
  FileType,
  UndisturbType,
  SentState,
  UnreadTag,
  ConversationTagType,
  MediaType,
  UserType,
  StreamEvent,
  ConversationTopType,
  PlatformType,
  PushChannel,
  UserStatus
}
