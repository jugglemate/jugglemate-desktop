<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import im from '../common/im'
import { MSG_NAME, TYPING_STATUS, SESSION_FILTER, CONVERSATION_TAG_ID } from '../common/enum'
import ConversationMenu from './ConversationMenu.vue'
import Avatar from './Avatar.vue'

const props = defineProps({
  activeId: {
    type: String,
    default: null
  },
  filter: {
    type: String,
    default: 'all' // all, unassigned, takeover
  }
})

const emit = defineEmits(['select', 'conversationOp', 'suggestionReceived'])

// ---------------------------------------------------------------------------
// IM integration (mirrors snailchat's conversation-list.vue flow)
// ---------------------------------------------------------------------------
const juggle = im.getCurrent()
const { Event, ConnectionState } = juggle || im

const imConversations = reactive([])   // mapped IM conversations
const imReady = ref(false)              // set true after first successful fetch
const tops = reactive([])               // pinned conversations
const typingTimers = new Map()

// ---------------------------------------------------------------------------
// Local conversation data. Owned by this component so the parent only needs
// to control filter / active state — the list itself is self-contained.
// IM events, when connected, will replace this list at runtime.
// ---------------------------------------------------------------------------
const conversations = reactive([])

// Format a Unix-ms timestamp into a short label (HH:mm / 周X / M/D).
function formatTime(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const dayDiff = (now - d) / 86400000
  if (dayDiff < 7) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// Short preview for a message. Mirrors snailchat's im.msgShortFormat() but
// inlined for now — will be promoted to im.js once we have a fuller IM message
// type catalog.
function shortFormat(message) {
  if (!message) return ''
  if (typeof message === 'string') return message
  const { name, content } = message
  if (!content) return ''

  // 自定义消息：jgm:ticketassign — 工单分配 / 认领
  if (name === MSG_NAME.TICKET_ASSIGN) {
    return formatTicketAssignPreview(content)
  }

  if (typeof content === 'string') {
    // 字符串型 content：自定义消息已经在上面的 name 判断里被消化掉了，
    // 走到这里只剩纯文本 / 已被 SDK 序列化的文本消息，原样展示即可。
    return content
  }
  console.log('[ConversationList] -------------', content.type)
  if (content.content !== undefined && content.content !== null) return String(content.content)
  if (content.text) return content.text
  if (content.type === 'image' || content.image) return '[图片]'
  if (content.type === 'voice' || content.voice) return '[语音]'
  if (content.type === 'video' || content.video) return '[视频]'
  if (content.type === 'file' || content.file) return '[文件]'
  if (content.type === 'location' || content.location) return '[位置]'
  if (content.type === 'card' || content.card) return '[名片]'
  return '[消息]'
}

// 与 im.js 里同名函数保持一致，渲染 jgm:ticketassign 消息的预览文本。
// assign_type: 0 = 自助认领, 1 = 分配给他人。
function formatTicketAssignPreview(rawContent) {
  const payload = parseTicketAssignContent(rawContent)
  if (!payload) return '[工单分配]'
  const op = payload.operator?.nickname || ''
  const ae = payload.assignee?.nickname || ''
  if (payload.assign_type === 0) {
    return ae ? `${ae} 认领了工单` : '已认领工单'
  }
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

function getConversationId(conversation) {
  return conversation?.conversationId || conversation?.id || ''
}

function isSameConversation(source, target) {
  const sourceId = getConversationId(source)
  const targetId = getConversationId(target)
  if (!sourceId || !targetId) return false
  const sourceType = source?.conversationType
  const targetType = target?.conversationType
  if (sourceType !== undefined && targetType !== undefined && sourceType !== targetType) {
    return false
  }
  return sourceId === targetId
}

function isActiveConversation(conversation) {
  return !!props.activeId && getConversationId(conversation) === props.activeId
}

function hasUnreadTag(conversation) {
  const unreadTag = conversation?.unreadTag
  if (unreadTag === undefined || unreadTag === null) return false
  if (im.UnreadTag?.UNREAD !== undefined) return unreadTag === im.UnreadTag.UNREAD
  return !!unreadTag
}

function hasUnread(conversation) {
  return (conversation?.unread || 0) > 0 || hasUnreadTag(conversation)
}

function unreadBadgeText(conversation) {
  const unread = conversation?.unread || 0
  if (unread > 0) return unread > 99 ? '99+' : String(unread)
  if (hasUnreadTag(conversation)) return '1'
  return ''
}

function applyUnreadCount(conversation, count) {
  if (!conversation) return
  conversation.unread = count
  conversation.unreadCount = count
  if (conversation._raw) {
    conversation._raw.unreadCount = count
    if (im.UnreadTag?.READ !== undefined) conversation._raw.unreadTag = im.UnreadTag.READ
  }
  if (im.UnreadTag?.READ !== undefined) conversation.unreadTag = im.UnreadTag.READ
}

function getUnreadIndex(conversation, fallback) {
  if (fallback !== undefined && fallback !== null) return fallback
  return conversation?.latestUnreadIndex
    ?? conversation?._raw?.latestUnreadIndex
    ?? conversation?.latestMessage?.unreadIndex
    ?? conversation?._raw?.latestMessage?.unreadIndex
    ?? 0
}

function clearLocalUnread(conversation) {
  const targets = [
    conversation,
    imConversations.find((item) => isSameConversation(item, conversation)),
    tops.find((item) => isSameConversation(item, conversation))
  ].filter(Boolean)
  targets.forEach((item) => applyUnreadCount(item, 0))
}

async function clearUnreadCount(conversation, unreadIndex) {
  if (!conversation || !juggle?.clearUnreadcount) return
  const conversationId = getConversationId(conversation)
  const conversationType = conversation.conversationType
  if (!conversationId || conversationType === undefined || conversationType === null) return

  clearLocalUnread(conversation)
  try {
    await juggle.clearUnreadcount({
      conversationId,
      conversationType,
      unreadIndex: getUnreadIndex(conversation, unreadIndex)
    })
  } catch (e) {
    console.warn('[ConversationList] clearUnreadCount failed', e)
  }
}

function setTyping(conversation, isTyping) {
  const targets = [
    imConversations.find((item) => isSameConversation(item, conversation)),
    tops.find((item) => isSameConversation(item, conversation))
  ].filter(Boolean)
  targets.forEach((item) => {
    item.isTyping = isTyping
  })
}

function onTypingMessage(message) {
  if (!message) return
  const key = `${message.conversationType}_${message.conversationId}`
  const isTyping = message.content?.type === TYPING_STATUS.START
  setTyping(message, isTyping)
  if (typingTimers.has(key)) {
    clearTimeout(typingTimers.get(key))
    typingTimers.delete(key)
  }
  if (isTyping) {
    typingTimers.set(key, setTimeout(() => {
      setTyping(message, false)
      typingTimers.delete(key)
    }, 5000))
  }
}

function clearTypingTimer(conversation) {
  const key = `${conversation?.conversationType}_${getConversationId(conversation)}`
  if (!typingTimers.has(key)) return
  clearTimeout(typingTimers.get(key))
  typingTimers.delete(key)
}

function removeFromList(list, conversation) {
  const idx = list.findIndex((item) => isSameConversation(item, conversation))
  if (idx >= 0) list.splice(idx, 1)
}

function removeConversations(conversations = []) {
  conversations.forEach((conversation) => {
    clearTypingTimer(conversation)
    removeFromList(imConversations, conversation)
    removeFromList(tops, conversation)
    if (isSameConversation(menuState.value.conversation, conversation)) {
      closeMenu()
    }
  })
}

// Avatar rendering is delegated to the shared `Avatar` component. The
// mapped conversation only needs to carry the SDK's name + portrait;
// color and initial are computed by Avatar from `name`.

function mapImConversation(c) {
  const name = c.conversationAlias || c.conversationTitle || c.conversationId
  return {
    id: c.conversationId,
    // Preserve the IM-shaped keys too so consumers (ChatMain) can talk
    // to the SDK without having to look up the raw record.
    conversationId: c.conversationId,
    conversationType: c.conversationType,
    name,
    portrait: c.conversationPortrait || '',
    preview: shortFormat(c.latestMessage),
    time: formatTime(c.latestMessage?.sentTime),
    unread: c.unreadCount || 0,
    unreadCount: c.unreadCount || 0,
    unreadTag: c.unreadTag,
    latestUnreadIndex: c.latestUnreadIndex,
    isTop: !!c.isTop,
    // "接管中" is backed by a server-side tag (see im.TAKEOVER_TAG_ID).
    // The reactive set in im.js is the source of truth for the filter
    // — we mirror it onto each row purely so the template can show a
    // badge or label without re-checking the SDK on every render.
    isTakeover: im.isInTakeoverTag(c),
    undisturbType: c.undisturbType,
    isDisturb: c.undisturbType === 1,
    isMute: c.mute,
    platform: c.platform,
    _raw: c
  }
}

function upsert(list, convo) {
  const idx = list.findIndex((c) => c.id === convo.id)
  if (idx >= 0) {
    list.splice(idx, 1, { ...list[idx], ...convo, isTyping: list[idx].isTyping })
  } else {
    list.push(convo)
  }
  // Sort by latest activity — top-pinned handled separately in template
  list.sort((a, b) => {
    const ta = a._raw?.sortTime || a._raw?.latestMessage?.sentTime || 0
    const tb = b._raw?.sortTime || b._raw?.latestMessage?.sentTime || 0
    return tb - ta
  })
}

// --- IM event handlers ----------------------------------------------------
function onConversationChanged({ conversations = [] } = {}) {
  for (const c of conversations) {
    // 过滤 agentMsgBot 会话
    if (c.conversationId === 'agentMsgBot') continue
    const mapped = mapImConversation(c)
    if (isActiveConversation(mapped) && mapped.unread > 0) {
      void clearUnreadCount(mapped)
    }
    upsert(imConversations, mapped)
  }
  imReady.value = true
}

function onMessageReceived(message) {
  if (!message) return

  // agentMsgBot 消息：解析 [session:xxx|agent:yyy] 前缀，通知 MainView
  if (message.sender?.id === 'agentMsgBot') {
    const text = message.content?.content || ''
    const match = text.match(/^\[session:(.+?)\|agent:(.+?)\]\s?([\s\S]*)/)
    
    if (match) {
      console.log('[ConversationList] agentMsgBot suggestion emitted:', match[1], match[2], match[3])
      emit('suggestionReceived', {
        session_id: match[1],
        unique_name: match[2],
        content: match[3] || text,
        msg_id: message.messageId || message.msgId
      })
    } else {
      console.warn('[ConversationList] agentMsgBot content missing session prefix:', text)
    }
    return
  }

  if (message.isStatus || message.name === MSG_NAME.TYPING_NTF) {
    onTypingMessage(message)
    return
  }
  const idx = imConversations.findIndex((c) => c.id === message.conversationId)
  if (idx >= 0) {
    const item = imConversations[idx]
    item.preview = shortFormat(message)
    item.time = formatTime(message.sentTime)
    item.latestUnreadIndex = getUnreadIndex(item, message.unreadIndex)
    if (item._raw) item._raw.latestUnreadIndex = item.latestUnreadIndex
    if (isActiveConversation(item)) {
      void clearUnreadCount(item, message.unreadIndex)
      return
    }
    if (!item.isDisturb && !message.isSender) {
      item.unread = (item.unread || 0) + 1
      item.unreadCount = item.unread
      if (item._raw) item._raw.unreadCount = item.unread
    }
  }
}

function onConversationTop({ conversations = [] } = {}) {
  // Refresh the tops list. Snailchat's pattern: tops is its own list driven
  // by juggle.getTopConversations() / a CONVERSATION_TOP event.
  tops.splice(0, tops.length, ...conversations.filter(c => c.conversationId !== 'agentMsgBot').map(mapImConversation))
}

function onConversationRemoved({ conversations = [] } = {}) {
  removeConversations(conversations)
  imReady.value = true
}

// --- Connect lifecycle ----------------------------------------------------
// 根据当前 filter 计算要传给 juggle.getConversations 的 tag 参数。
//   mine       — tag = my_ticket（精确匹配）
//   unassigned — tag = '!assigned'（反向匹配，需要服务端支持；
//                 如果服务端只支持精确匹配，下面的 reconcile 兜底会再次过滤）
//   all        — 不传 tag，拉全部
// SDK 的 QryConversationsReq 协议里 tag 是 string，falsy 时不序列化到请求里。
function buildTagParamForFilter(filter) {
  if (filter === SESSION_FILTER.MINE) return CONVERSATION_TAG_ID.MY_TICKET
  if (filter === SESSION_FILTER.UNASSIGNED) return '!' + CONVERSATION_TAG_ID.ASSIGNED
  // SESSION_FILTER.ALL 或未知值 — 不传 tag
  return undefined
}

async function fetchConversations() {
  if (!juggle?.getConversations) {
    console.warn('[ConversationList] fetchConversations skipped — juggle.getConversations not available')
    return
  }
  const tag = buildTagParamForFilter(props.filter)
  try {
    console.log('[ConversationList] fetchConversations — calling juggle.getConversations()', { filter: props.filter, tag })
    const result = await juggle.getConversations(tag ? { tag } : {})
    console.log('[ConversationList] getConversations result:', { 
      count: result?.conversations?.length || 0,
      hasConversations: !!result?.conversations
    })
    const list = result?.conversations || []
    // Mirror each conversation's `tags` field into the local takeover-tag
    // set before mapping, so the rows we render already carry the right
    // isTakeover flag on first paint. This also reconciles state on a
    // fresh login (the SDK returns existing tag memberships).
    im.syncTakeoverTagFromList(list)
    // assigned / my_ticket 本地 set 同步。和 takeover 一样的 reconcile 模式：
    // 先清空再用 server 视图重写，多设备、SDK 推送都能自然覆盖。
    im.syncTicketTagsFromList(list)

    // 前端兜底过滤：unassigned 要求 tag != assigned。如果服务端支持
    // tag='!assigned' 的反向查询，list 里已经只剩未分配的；否则这里再
    // 按本地同步出来的 assignedTagConversations set 过滤一次。mine/all
    // 不需要这个兜底 — mine 是精确匹配、all 是不筛选。
    let filteredList = list
    if (props.filter === SESSION_FILTER.UNASSIGNED) {
      filteredList = list.filter((c) => !im.isInAssignedTag(c))
    }

    imConversations.splice(0, imConversations.length,
      ...filteredList.filter(c => c.conversationId !== 'agentMsgBot').map(mapImConversation))
    imReady.value = true
    console.log('[ConversationList] Conversations loaded: total', imConversations.length)
  } catch (e) {
    console.warn('[ConversationList] fetchConversations failed', e)
  }
}

function onStateChanged({ state }) {
  console.log('[ConversationList] onStateChanged — state:', state, 'expected CONNECTED:', im.ConnectionState?.CONNECTED)
  if (state === ConnectionState?.CONNECTED) {
    fetchConversations()
  }
}

// 切 tab 时要重新拉会话列表。filter 是 prop，父组件（MainView）改
// sidebarFilters 的 key 时这里会拿到新值。否则会一直显示上一 tab 的结果。
// 没连接就不拉（等 STATE_CHANGED 再拉）。
// 切之前先清空本地列表，避免用户看到上一 tab 的内容短暂残留。
watch(() => props.filter, (val) => {
  console.log('[ConversationList] filter changed →', val)
  imConversations.splice(0, imConversations.length)
  if (juggle?.isConnected && juggle.isConnected()) {
    fetchConversations()
  }
})

onMounted(() => {
  // juggle 由 main.js 入口的 im.init() 保证已经初始化好（im.init() 是幂等的）。
  // 如果还取不到 juggle，说明启动路径有问题，直接 warn 返回避免下游炸。
  if (!juggle?.on) {
    console.warn('[ConversationList] juggle not initialized — im.init() was not called before component mount?')
    return
  }
  console.log('[ConversationList] onMounted — juggle.isConnected():', juggle.isConnected?.())

  // Fetch initial data if already connected; otherwise wait for the event.
  if (juggle.isConnected && juggle.isConnected()) {
    console.log('[ConversationList] already connected, fetching conversations immediately')
    fetchConversations()
  } else {
    console.log('[ConversationList] not connected yet, waiting for STATE_CHANGED event')
    juggle.on(Event.STATE_CHANGED, onStateChanged)
  }

  juggle.on(Event.CONVERSATION_CHANGED, onConversationChanged)
  juggle.on(Event.CONVERSATION_ADDED, onConversationChanged)
  juggle.on(Event.CONVERSATION_REMOVED, onConversationRemoved)
  juggle.on(Event.MESSAGE_RECEIVED, onMessageReceived)
  juggle.on(Event.CONVERSATION_TOP, onConversationTop)
})

onBeforeUnmount(() => {
  typingTimers.forEach((timer) => clearTimeout(timer))
  typingTimers.clear()
  if (!juggle?.off) return
  juggle.off(Event.STATE_CHANGED, onStateChanged)
  juggle.off(Event.CONVERSATION_CHANGED, onConversationChanged)
  juggle.off(Event.CONVERSATION_ADDED, onConversationChanged)
  juggle.off(Event.CONVERSATION_REMOVED, onConversationRemoved)
  juggle.off(Event.MESSAGE_RECEIVED, onMessageReceived)
  juggle.off(Event.CONVERSATION_TOP, onConversationTop)
})

// Re-fetch if filter changes are observed to be useful? No — filter is
// client-side, no need to re-fetch.

// Right-click state for the conversation list menu.
const menuState = ref({ show: false, x: 0, y: 0, conversation: null })
let menuContextHandler = null

function onContextMenu(event, convo) {
  if (!convo) return
  event.preventDefault()
  event.stopPropagation()
  menuState.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    conversation: convo
  }
}

function closeMenu() {
  menuState.value = { show: false, x: 0, y: 0, conversation: null }
}

function onMenuSelect({ key, conversation }) {
  if (key === 'remove') {
    removeConversations([conversation])
  }
  emit('conversationOp', { key, conversation })
}

onMounted(() => {
  // Close on any global click so the menu doesn't get stuck open.
  menuContextHandler = () => {
    if (menuState.value.show) closeMenu()
  }
  document.addEventListener('click', menuContextHandler)
  document.addEventListener('contextmenu', menuContextHandler)
})

onBeforeUnmount(() => {
  if (menuContextHandler) {
    document.removeEventListener('click', menuContextHandler)
    document.removeEventListener('contextmenu', menuContextHandler)
  }
})

// ---------------------------------------------------------------------------
// Display merge: prefer IM data when it has anything, otherwise fall back to
// the local demo data owned by this component.
// ---------------------------------------------------------------------------
const displayConversations = computed(() => {
  if (imReady.value && imConversations.length > 0) return imConversations
  return conversations
})

function isVisible(convo) {
  // mine / unassigned / all 三个分类已经在 fetchConversations 里通过
  // getConversations 的 tag 参数 + 前端兜底过滤处理掉了，本组件拿到的
  // imConversations 已经是过滤后的结果，不需要再判断。只有 takeover 是
  // 留在本地做的（"接管中" 跟会话分类是两条独立的轴）。
  if (props.filter === 'takeover') {
    return im.isInTakeoverTag(convo)
  }
  return true
}

const visibleConversations = computed(() =>
  displayConversations.value.filter(isVisible)
)

const topConversations = computed(() => {
  // In demo mode, treat nothing as "top" — the local demo data has no isTop.
  // In IM mode, return the tops list.
  if (imReady.value && imConversations.length > 0) return tops
  return []
})

function handleSelect(convo) {
  void clearUnreadCount(convo)
  emit('select', convo)
}

</script>

<template>
  <div class="tyn-sidebar__convos">
    <!-- Pinned / top conversations (IM only) -->
    <div v-if="topConversations.length" class="tyn-sidebar__tops">
      <div
        v-for="item in topConversations"
        :key="item.id"
        class="tyn-topitem"
        :title="item.name"
      >
        <div class="tyn-topitem__avatar">
          <Avatar
            :name="item.name"
            :avatar="item.portrait"
            :platform="item.platform"
            size="sm"
          />
        </div>
        <div class="tyn-topitem__name">{{ item.name }}</div>
      </div>
    </div>

      <div
        v-for="convo in visibleConversations"
        :key="convo.id"
        class="tyn-convo-item"
        :class="{
          active: convo.id === activeId,
          'is-top': convo.isTop,
          'is-disturb': convo.isDisturb
        }"
        @click="handleSelect(convo)"
        @contextmenu="onContextMenu($event, convo)"
      >
        <Avatar
          class="tyn-convo-item__avatar"
          :name="convo.name"
          :avatar="convo.portrait"
          :platform="convo.platform"
          size="md"
        />
        <div class="tyn-convo-item__info">
          <div class="tyn-convo-item__name">
            <span class="tyn-convo-item__name-text">{{ convo.name }}</span>
            <span v-if="convo.time" class="tyn-convo-item__time">{{ convo.time }}</span>
          </div>
          <div
            class="tyn-convo-item__preview"
            :class="{ 'is-typing': convo.isTyping }"
          >
            <span v-if="convo.isDisturb" class="tyn-convo-item__disturb" aria-label="免打扰">🔕</span>
            <span v-if="convo.isTyping" class="tyn-convo-item__typing">
              <span class="tyn-convo-item__typing-loader" aria-hidden="true">
                <span class="tyn-convo-item__typing-dot"></span>
                <span class="tyn-convo-item__typing-dot"></span>
                <span class="tyn-convo-item__typing-dot"></span>
              </span>
              <span>对方正在输入</span>
            </span>
            <template v-else>{{ convo.preview }}</template>
          </div>
        </div>
        <div
          v-if="hasUnread(convo)"
          class="tyn-convo-item__badge"
          :class="{
            'tyn-convo-item__badge--mute': convo.isDisturb,
            'tyn-convo-item__badge--dot': convo.isDisturb && (convo.unread || 0) === 0
          }"
        >
          <template v-if="!convo.isDisturb || (convo.unread || 0) > 0">
            {{ unreadBadgeText(convo) }}
          </template>
        </div>
      </div>

      <div v-if="visibleConversations.length === 0" class="tyn-sidebar__empty">
        <template v-if="!imReady">正在加载会话…</template>
        <template v-else-if="filter === 'unassigned'">没有待分配工单</template>
        <template v-else-if="filter === 'takeover'">没有正在接管的会话</template>
        <template v-else>暂无会话</template>
      </div>
    </div>

    <!-- Agent groups (preserved from the current project) -->
    <!-- <div class="tyn-sidebar__groups">
      <div class="tyn-sidebar__groups-label">Agent 群组</div>
      <slot name="groups"></slot>
    </div> -->

    <ConversationMenu
      v-if="menuState.show"
      :conversation="menuState.conversation"
      :x="menuState.x"
      :y="menuState.y"
      @select="onMenuSelect"
      @close="closeMenu"
    />
</template>

<style scoped>
.tyn-sidebar__empty {
  padding: 32px 16px;
  text-align: center;
  color: #B0B8C1;
  font-size: 13px;
}

.tyn-convo-item__disturb {
  margin-right: 4px;
  font-size: 11px;
}

.tyn-convo-item__preview {
  min-height: 16px;
  line-height: 16px;
}

.tyn-convo-item__preview.is-typing {
  color: #00a870;
}

.tyn-convo-item__typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 16px;
  line-height: 16px;
  font-size: 11px;
  color: inherit;
  vertical-align: top;
}

.tyn-convo-item__typing-loader {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 2px;
  flex-shrink: 0;
}

.tyn-convo-item__typing-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  animation: jmTypingBreathe 1.1s infinite ease-in-out;
}

.tyn-convo-item__typing-dot:nth-child(2) {
  animation-delay: 0.9s;
}

.tyn-convo-item__typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes jmTypingBreathe {
  0%,
  100% {
    transform: scale(0.8);
    opacity: 0.6;
  }

  50% {
    transform: scale(1.1);
    opacity: 1;
  }
}
</style>
