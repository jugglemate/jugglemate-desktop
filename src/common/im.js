import { reactive } from 'vue'
import JuggleChat from '../libs/juggleim-es-1.9.13'
import { CONFIG } from '../config'
import Storage from './storage'
import { STORAGE, MSG_NAME } from './enum'

const { Event, ConnectionState, ErrorType } = JuggleChat

let juggle = null
let stateListener = null
// Connection state tracking so callers can avoid issuing duplicate connect() calls.
let _connecting = false

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
  const option = {
    appkey: CONFIG.APP_KEY,
    upload: OSS,
    serverList: CONFIG.IM_SERVERS
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
      { name: MSG_NAME.REPLAY_MSG, isCount: true, isStorage: true }
    ])
  }
  // Keep the takeover-tag local set in sync with the SDK. The events come
  // back from the server after a successful addConversationsToTag /
  // removeConversationsFromTag call, so the local state will reflect the
  // authoritative answer once the round-trip completes — even if the call
  // was triggered from another device.
  if (typeof juggle.on === 'function') {
    juggle.on(Event.TAG_CONVERSATION_ADDED, (payload) => applyTagChange('add', payload))
    juggle.on(Event.TAG_CONVERSATION_REMOVED, (payload) => applyTagChange('remove', payload))
  }
  return juggle
}

function getCurrent() {
  return juggle
}

function isConnected() {
  return !!(juggle && juggle.isConnected && juggle.isConnected())
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
    if (success) success(juggle.getCurrentUser())
    return
  }

  teardownListener()
  _connecting = true
  stateListener = ({ state }) => {
    console.log('[im] state changed:', state)
    if (state === ConnectionState.CONNECTED) {
      _connecting = false
      const imUser = juggle.getCurrentUser()
      console.log('[im] CONNECTED — imUser:', imUser)
      // Refresh the stored token with whatever the IM server returned.
      const stored = Storage.get(STORAGE.USER_TOKEN) || {}
      Storage.set(STORAGE.USER_TOKEN, { ...stored, ...imUser })
      if (success) success(imUser)
    } else if (state === ConnectionState.DISCONNECTED) {
      _connecting = false
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
  // The takeover tag is per-user — clear the local mirror so a different
  // account signing in on the same browser doesn't see stale rows.
  takeoverTagConversations.clear()
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
  if (name === MSG_NAME.FRIEND_NTF) return '[好友通知]'
  if (name === MessageType.RECALL_INFO) return '[撤回了一条消息]'
  if (name === MessageType.CALL_1V1_FINISHED) return '[通话结束]'
  return '[消息]'
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
