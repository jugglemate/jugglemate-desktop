<script setup>
/**
 * Conversations
 * ------------------------------------------------------------------
 * 整合"二级过滤侧栏 + 会话列表"为一整个组件：
 *   - 左：视图（4 个：我的 / 待分配 / AI 托管中 / 全部）
 *        平台（4 个：全部 / Web / Telegram / JuggleChat）
 *   - 右：会话列表（搜索 / 未读 dot / 时间 / 标签 / 头像）
 * 组合过滤：视图 ∩ 平台
 *
 * 视图 → tag 的映射（只给后端 getConversations 用）：
 *   mine        → CONVERSATION_TAG_ID.MY_TICKET
 *   unassigned  → '!assigned'
 *   ai_takeover → 不传 tag（前端按 im.isInTakeoverTag 过滤，== 接管中会话列表）
 *   all         → 不传 tag
 * 平台 → 平台 tag：
 *   all / 其它   → 不传 / 传对应 platform 字符串
 *   说明：IM 的 getConversations 是否支持按 platform 过滤取决于后端实现，
 *   暂时前端 in-memory 用 convo.platform 二次过滤（与现有 isVisible 模式一致）。
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import im from '../common/im'
import {
  MSG_NAME,
  CONVERSATION_TAG_ID,
  PLATFORM,
  PLATFORM_META,
  VIEW,
  VIEW_META
} from '../common/enum'
import ConversationMenu from './ConversationMenu.vue'
import Avatar from './Avatar.vue'

// ---------------------------------------------------------------------------
// Props / Emits
// ---------------------------------------------------------------------------
const props = defineProps({
  // 当前激活的会话 id（高亮列表里对应项）
  activeId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['select', 'conversation-op', 'suggestion-received'])

// ---------------------------------------------------------------------------
// 视图 + 平台状态（默认值：我的 + 全部）
// ---------------------------------------------------------------------------
const currentView = ref(VIEW.MINE)
const currentPlatform = ref(PLATFORM.ALL)

// 视图 / 平台项：直接由 enum 派生
const viewItems = computed(() =>
  Object.values(VIEW)
    .map((k) => ({ key: k, ...VIEW_META[k] }))
    .sort((a, b) => a.order - b.order)
)
const platformItems = computed(() =>
  Object.values(PLATFORM)
    .filter((k) => k !== PLATFORM.ALL)
    .map((k) => ({ key: k, ...PLATFORM_META[k] }))
    .sort((a, b) => a.order - b.order)
)

// 各 filter 下的未读/待办数量（MainView 之前就这么占位）
const filterCounts = reactive({
  [VIEW.MINE]: 10,
  [VIEW.UNASSIGNED]: 10,
  [VIEW.AI_TAKEOVER]: 10,
  [VIEW.ALL]: 10,
  [PLATFORM.WEB]: 10,
  [PLATFORM.TELEGRAM]: 10,
  [PLATFORM.JUGGLECHAT]: 10
})

function selectView(key) {
  currentView.value = key
}

function selectPlatform(key) {
  currentPlatform.value = key
}

// ---------------------------------------------------------------------------
// IM 集成（跟 ConversationList 同款骨架）
// ---------------------------------------------------------------------------
const juggle = im.getCurrent()
const { Event } = juggle || im

const imConversations = reactive([])
const imReady = ref(false)
const tops = reactive([])
const typingTimers = new Map()

// 本地兜底数据（IM 还没接上时用）
const conversations = reactive([])

// 视图 → 传给 juggle.getConversations 的 tag 参数
function buildTagParamForView(view) {
  if (view === VIEW.MINE) return CONVERSATION_TAG_ID.MY_TICKET
  if (view === VIEW.UNASSIGNED) return '!' + CONVERSATION_TAG_ID.ASSIGNED
  // ai_takeover / all — 留给前端过滤
  return undefined
}

// 视图在前端的二次过滤（"AI 托管中" = 接管中会话）
// AI 托管中直接复用 im.js 的接管 tag set（im.isInTakeoverTag），
// 跟原 ConversationList 的"接管中" tab 一个意思。
function matchViewInFrontend(convo, view) {
  if (view === VIEW.AI_TAKEOVER) return im.isInTakeoverTag(convo)
  return true
}

// 平台在前端的二次过滤（按 convo.platform 字符串判等，case-insensitive）
function matchPlatformInFrontend(convo, platform) {
  if (!platform || platform === PLATFORM.ALL) return true
  if (!convo?.platform) return false
  return String(convo.platform).toLowerCase() === platform
}

const filteredConversations = computed(() => {
  return imConversations.filter((c) =>
    matchViewInFrontend(c, currentView.value) &&
    matchPlatformInFrontend(c, currentPlatform.value)
  )
})

// 头像 / 名字 / 预览 / 时间 字段映射
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

function shortFormat(message) {
  if (!message) return ''
  if (typeof message === 'string') return message
  const { name, content } = message
  if (!content) return ''
  if (name === MSG_NAME.TICKET_ASSIGN) return im.formatTicketAssignPreview(content)
  if (typeof content === 'string') return content
  if (content.content !== undefined && content.content !== null) return String(content.content)
  if (content.text) return content.text
  if (message.type === 'image' || message.image) return '[图片]'
  if (message.type === 'voice' || message.voice) return '[语音]'
  if (message.type === 'video' || message.video) return '[视频]'
  if (message.type === 'file' || message.file) return '[文件]'
  if (message.type === 'location' || message.location) return '[位置]'
  if (message.type === 'card' || message.card) return '[名片]'
  return '[消息]'
}

function getConversationId(c) { return c?.conversationId || c?.id || '' }

// 头像渐变：复用示例里的风格，用 name 的 charCode 选 6 套之一
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#FFB199,#FF0844)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
  'linear-gradient(135deg,#14B8A6,#0EA5E9)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#3B82F6)',
  'linear-gradient(135deg,#A78BFA,#F472B6)'
]
function avatarBg(name) {
  const i = (name || '').charCodeAt(0) % AVATAR_GRADIENTS.length
  return AVATAR_GRADIENTS[i]
}
function avatarLetter(name) {
  return (name || '').charAt(0) || '?'
}

// 把 im 会话映射成视图/模板需要的字段
function mapConversation(c) {
  const name = c.conversationName || c.name || ''
  return {
    id: c.conversationId,
    conversationId: c.conversationId,
    conversationType: c.conversationType,
    name: c.conversationTitle,
    portrait: c.conversationPortrait || '',
    preview: shortFormat(c.latestMessage),
    time: formatTime(c.sortTime),
    unread: c.unreadCount || 0,
    unreadTag: c.unreadTag,
    isTop: !!c.isTop,
    isTakeover: im.isInTakeoverTag(c),
    platform: 'Telegram', // c.platform || '',  // TODO: juggle.getConversations 里 platform 字段暂时没传
    tags: c.tags || [],
    _raw: c
  }
}

function upsert(list, convo) {
  const idx = list.findIndex((c) => c.id === convo.id)
  if (idx >= 0) list.splice(idx, 1, { ...list[idx], ...convo })
  else list.push(convo)
}

function getConvKey(conversation) {
  return `${conversation?.conversationType}_${getConversationId(conversation)}`
}

function removeConversations(targets) {
  const ids = new Set(targets.map((c) => c.id))
  for (let i = imConversations.length - 1; i >= 0; i--) {
    if (ids.has(imConversations[i].id)) imConversations.splice(i, 1)
  }
}

// ---------------------------------------------------------------------------
// IM event handlers
// ---------------------------------------------------------------------------
function onConversationChanged(conversation) {
  if (!conversation) return
  upsert(imConversations, mapConversation(conversation))
  imReady.value = true
}

function onConversationRemoved(conversation) {
  if (!conversation) return
  const idx = imConversations.findIndex((c) => c.id === getConversationId(conversation))
  if (idx >= 0) imConversations.splice(idx, 1)
}

function onMessageReceived(message) {
  if (!message) return
  const cid = getConversationId(message)
  if (!cid) return
  const target = imConversations.find((c) => c.id === cid)
  if (target) {
    target.preview = shortFormat(message)
    target.time = formatTime(message.sentTime)
  }
}

function onStateChanged() {
  if (juggle?.isConnected && juggle.isConnected()) fetchConversations()
}

function onConversationTop(payload) {
  // 顶置变更时只更新顺序，不重拉
  if (!payload) return
  // 占位：实际重排可在 upsert + 排序时统一处理
  fetchConversations()
}

async function fetchConversations() {
  if (!juggle?.getConversations) {
    console.warn('[Conversations] juggle.getConversations not available')
    return
  }
  const tag = buildTagParamForView(currentView.value)
  console.warn('[Conversations] fetchConversations with tag', tag)
  try {
    const result = await juggle.getConversations(tag ? { tag } : {})
    console.log('[Conversations] fetchConversations result', result)
    const list = result?.conversations || []
    im.syncTakeoverTagFromList(list)
    imConversations.splice(0, imConversations.length, ...list.map(mapConversation))
    imReady.value = true
  } catch (e) {
    console.error('[Conversations] fetchConversations failed', e)
  }
}

// 视图切换时可能需要重新 fetch（带 tag 的视图）
watch(currentView, (v) => {
  if (v === VIEW.MINE || v === VIEW.UNASSIGNED) {
    fetchConversations()
  }
  // ai_takeover / all 都可以复用已 fetch 的数据
})

// ---------------------------------------------------------------------------
// 点击会话 → 通知父组件展示 chat
// ---------------------------------------------------------------------------
function onConvoClick(convo) {
  if (!convo) return
  emit('select', convo)
}

function onConvoContextMenu(e, convo) {
  if (!convo) return
  e.preventDefault()
  e.stopPropagation()
  menuState.value = { show: true, x: e.clientX, y: e.clientY, conversation: convo }
}

const menuState = ref({ show: false, x: 0, y: 0, conversation: null })
function closeMenu() { menuState.value = { show: false, x: 0, y: 0, conversation: null } }
function onMenuSelect({ key, conversation }) {
  if (key === 'remove') removeConversations([conversation])
  emit('conversation-op', { key, conversation })
  closeMenu()
}

let menuDocHandler = null
onMounted(() => {
  if (!juggle?.on) return
  if (juggle.isConnected && juggle.isConnected()) fetchConversations()
  else juggle.on(Event.STATE_CHANGED, onStateChanged)
  juggle.on(Event.CONVERSATION_CHANGED, onConversationChanged)
  juggle.on(Event.CONVERSATION_ADDED, onConversationChanged)
  juggle.on(Event.CONVERSATION_REMOVED, onConversationRemoved)
  juggle.on(Event.MESSAGE_RECEIVED, onMessageReceived)
  juggle.on(Event.CONVERSATION_TOP, onConversationTop)

  menuDocHandler = () => { if (menuState.value.show) closeMenu() }
  document.addEventListener('click', menuDocHandler)
  document.addEventListener('contextmenu', menuDocHandler)
})
onBeforeUnmount(() => {
  if (!juggle?.off) return
  juggle.off(Event.STATE_CHANGED, onStateChanged)
  juggle.off(Event.CONVERSATION_CHANGED, onConversationChanged)
  juggle.off(Event.CONVERSATION_ADDED, onConversationChanged)
  juggle.off(Event.CONVERSATION_REMOVED, onConversationRemoved)
  juggle.off(Event.MESSAGE_RECEIVED, onMessageReceived)
  juggle.off(Event.CONVERSATION_TOP, onConversationTop)
  if (menuDocHandler) {
    document.removeEventListener('click', menuDocHandler)
    document.removeEventListener('contextmenu', menuDocHandler)
  }
})

// 顶置/最新活动排序
const sortedConversations = computed(() => {
  const list = [...filteredConversations.value].sort((a, b) => {
    if (a.isTop !== b.isTop) return a.isTop ? -1 : 1
    const ta = a._raw?.latestMessage?.sentTime || 0
    const tb = b._raw?.latestMessage?.sentTime || 0
    return tb - ta
  })
  console.log('sortedConversations', list, filteredConversations)
  return list;
})
</script>

<template>
  <div class="conversations">
    <!-- 左：过滤侧栏 -->
    <aside class="conv-filter">
      <!-- 视图组 -->
      <div class="conv-filter__group">
        <div class="conv-filter__group-title">视图</div>
        <button
          v-for="it in viewItems"
          :key="it.key"
          class="conv-filter__item"
          :class="{ 'conv-filter__item--active': currentView === it.key }"
          @click="selectView(it.key)"
        >
          <span
            v-if="it.icon"
            class="conv-filter__item-icon"
            v-html="it.icon"
            aria-hidden="true"
          ></span>
          <span class="conv-filter__item-label">{{ it.label }}</span>
          <span
            v-if="filterCounts[it.key]"
            class="conv-filter__item-badge"
          >{{ filterCounts[it.key] }}</span>
        </button>
      </div>

      <!-- 平台组 -->
      <div class="conv-filter__group">
        <div class="conv-filter__group-title">平台</div>
        <button
          v-for="it in platformItems"
          :key="it.key"
          class="conv-filter__item"
          :class="{ 'conv-filter__item--active': currentPlatform === it.key }"
          @click="selectPlatform(it.key)"
        >
          <span class="conv-filter__dot" :style="{ background: it.color }"></span>
          <span class="conv-filter__item-label">{{ it.label }}</span>
          <span
            v-if="filterCounts[it.key]"
            class="conv-filter__item-badge"
          >{{ filterCounts[it.key] }}</span>
        </button>
      </div>
    </aside>

    <!-- 右：会话列表 -->
    <aside class="conv-list-wrap">
      <div class="conv-list-head">
        <h3>会话 <span class="conv-list-head__sub">{{ sortedConversations.length }} 进行中</span></h3>
        <div class="conv-list-head__tools">
          <button title="刷新"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
        </div>
      </div>

      <div class="conv-list-search">
        <div class="conv-list-search__inner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input placeholder="搜索访客 / 会话 ID / 关键词">
        </div>
      </div>

      <div class="conv-list">
        <div
          v-for="convo in sortedConversations"
          :key="convo.id"
          class="conv-item"
          :class="{
            'conv-item--active': activeId === convo.id,
            'conv-item--unread': convo.unread > 0
          }"
          @click="onConvoClick(convo)"
          @contextmenu="onConvoContextMenu($event, convo)"
        >
          <div class="conv-item__avatar" :style="{ background: avatarBg(convo.name) }">
            <Avatar
              :name="convo.name"
              :avatar="convo.portrait"
              :platform="convo.platform"
              size="md"
            />
            <span
              v-if="convo.platform"
              class="conv-item__plat-dot"
              :style="{ background: PLATFORM_META[convo.platform?.toLowerCase?.()]?.color || '#6B7280' }"
            ></span>
          </div>
          <div class="conv-item__info">
            <div class="conv-item__row1">
              <span class="conv-item__name" :class="{ 'conv-item__name--unread': convo.unread > 0 }">
                {{ convo.name }}
              </span>
              <span class="conv-item__time">{{ convo.time }}</span>
            </div>
            <div class="conv-item__preview">{{ convo.preview }}</div>
            <div v-if="convo.platform || convo.isTakeover" class="conv-item__tags">
              <span
                v-if="convo.platform"
                class="tag tag-info"
              >{{ PLATFORM_META[convo.platform?.toLowerCase?.()]?.label || convo.platform }}</span>
              <span v-if="convo.isTakeover" class="tag tag-ai">AI</span>
            </div>
          </div>
        </div>

        <div v-if="sortedConversations.length === 0" class="conv-list__empty">
          暂无匹配的会话
        </div>
      </div>
    </aside>

    <!-- 右键菜单（保持跟 ConversationList 同款） -->
    <ConversationMenu
      v-if="menuState.show"
      :show="menuState.show"
      :x="menuState.x"
      :y="menuState.y"
      :conversation="menuState.conversation"
      @select="onMenuSelect"
      @close="closeMenu"
    />
  </div>
</template>

<style scoped>
.conversations {
  display: flex;
  height: 100%;
  min-width: 460px;        /* 锁死 520，让 ChatMain 走 flex:1 */
  flex-shrink: 0;
  background: var(--bg-soft);
}

/* ============== 左：过滤侧栏 ============== */
.conv-filter {
  /* width: 200px; */
  min-width: 160px;
  background: var(--bg);
  border-right: 1px solid var(--border);
  overflow-y: auto;
}

.conv-filter__group {
  padding: 8px 6px 4px;
}

.conv-filter__group-title {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 600;
  padding: 6px 10px 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.conv-filter__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px 7px 13px;
  border: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  border-radius: var(--r);
  cursor: pointer;
  text-align: left;
  transition: var(--t-fast);
}
.conv-filter__item-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  opacity: 0.85;
}
.conv-filter__item-icon svg {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.conv-filter__item--active .conv-filter__item-icon {
  opacity: 1;
}
.conv-filter__item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: transparent;
  transition: var(--t-fast);
}
.conv-filter__item:hover {
  background: var(--bg-mute);
  color: var(--text-1);
}
.conv-filter__item--active {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 500;
}
.conv-filter__item--active::before {
  background: var(--primary);
}
.conv-filter__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.conv-filter__item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-filter__item-badge {
  font-size: 11px;
  color: var(--text-2);
  background: var(--bg-mute);
  padding: 1px 7px;
  border-radius: var(--r-full);
  min-width: 20px;
  text-align: center;
}
.conv-filter__item--active .conv-filter__item-badge {
  background: var(--primary);
  color: #fff;
}

/* ============== 右：会话列表 ============== */
.conv-list-wrap {
  width: 300px;           
  min-width: 300px;
  flex: 0 0 300px;
  background: var(--bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.conv-list-head {
  padding: 14px 16px 15px;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.conv-list-head h3 {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.conv-list-head__sub {
  color: var(--text-3);
  font-weight: 400;
  font-size: 12px;
}
.conv-list-head__tools {
  display: flex;
  gap: 4px;
}
.conv-list-head__tools button {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  color: var(--text-3);
  border: 0;
  background: transparent;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: var(--t-fast);
}
.conv-list-head__tools button:hover {
  background: var(--bg-mute);
  color: var(--text-1);
}

.conv-list-search {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-soft);
}
.conv-list-search__inner {
  position: relative;
}
.conv-list-search__inner svg {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  width: 14px;
  height: 14px;
}
.conv-list-search__inner input {
  width: 100%;
  padding: 7px 10px 7px 32px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  font-size: 13px;
  background: var(--bg-soft);
  color: var(--text-1);
  transition: var(--t-fast);
}
.conv-list-search__inner input:focus {
  outline: none;
  border-color: var(--primary);
  background: #fff;
}

.conv-list {
  flex: 1;
  overflow-y: auto;
}

.conv-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
  display: flex;
  gap: 10px;
  position: relative;
  transition: var(--t-fast);
}
.conv-item:hover {
  background: var(--bg-soft);
}
.conv-item--active {
  background: var(--primary-faint);
}
.conv-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--primary);
}
.conv-item--unread {
  background: #FCFDFF;
}
.conv-item--unread::after {
  content: '';
  position: absolute;
  left: 6px;
  top: 18px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
}
.conv-item__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  position: relative;
}
.conv-item__plat-dot {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
}
.conv-item__info {
  flex: 1;
  min-width: 0;
}
.conv-item__row1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 3px;
}
.conv-item__name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.conv-item__name--unread {
  font-weight: 600;
}
.conv-item__time {
  color: var(--text-3);
  font-size: 11px;
  flex-shrink: 0;
}
.conv-item__preview {
  color: var(--text-2);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-item__tags {
  margin-top: 5px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.conv-list__empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

/* 通用 tag 样式（跟 module-2-3.html 一致） */
.tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.6;
  flex-shrink: 0;
}
.tag-ai { background: var(--ai-soft); color: var(--ai); }
.tag-info { background: var(--info-soft); color: var(--info); }
</style>
