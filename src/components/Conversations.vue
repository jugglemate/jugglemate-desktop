<script setup>
/**
 * Conversations
 * ------------------------------------------------------------------
 * 整合"二级过滤侧栏 + 会话列表"为一整个组件：
 *   - 左：视图（3 个：我的 / 待分配 / 全部）
 *        平台（4 个：全部 / Web / Telegram / JuggleChat）
 *        工单状态（4 个：全部 / 待处理 / 处理中 / 重新打开）
 *   - 右：会话列表（搜索 / 未读 dot / 时间 / 标签 / 头像）
 * 组合过滤：视图 ∩ 平台 ∩ 工单状态（三维求交）
 *
 * 视图 / 平台 / 工单状态 都直接走 IM 后端 getConversations：
 *   协议层 QryConversationsReq.tag 是单个 string，没有"多 tag AND"语义，
 *   所以 fetchConversations() 会各发一次请求，
 *   视图带 viewParams、平台带 platformTag、状态带 statusTag，
 *   前端按 conversationId 求三集合交集。
 * 视图 → buildViewTagParams(view) 返回 { tag?, exceptTag? }：
 *   mine        → { tag: CONVERSATION_TAG_ID.MY_TICKET }
 *   unassigned  → { exceptTag: CONVERSATION_TAG_ID.ASSIGNED } （协议层 exceptTag 字段）
  *   all         → {} （不传 tag / exceptTag）
 * 平台 → platformTag（2026-07-13 修订：见下 buildTagParamForPlatform）
 * 工单状态 → statusTag（2026-07-13 新增）：
 *   默认空选中 → undefined （不传 tag）
 *   pending     → 'ticket_status_pending'
 *   processing  → 'ticket_status_processing'
 *   reopen      → 'ticket_status_reopen'
 *   交互：再点已选项 = 取消选中（与平台列同构），无单独的"全部"项
 *   （closed 业务态已移除，前端 enum 保留 STATUS_CLOSED 以兼容 server 极端情况）
 * 平台 → platformTag（2026-07-13 修订：走新的全局 tag）：
 *   default     → undefined （不传 tag）
 *   web         → TICKET_GLOBAL_TAG.CHANNEL_WIDGET   ('channel_widget')
 *   telegram    → TICKET_GLOBAL_TAG.CHANNEL_TELEGRAM ('channel_telegram')
 *   jugglechat  → TICKET_GLOBAL_TAG.CHANNEL_JUGGLEIM ('channel_juggleim')
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import im from '../common/im'
import {
  MSG_NAME,
  CONVERSATION_TAG_ID,
  PLATFORM,
  PLATFORM_TAG_ID,
  PLATFORM_META,
  TICKET_GLOBAL_TAG,
  TICKET_STATUS_TAG,
  TICKET_STATUS_TAG_META,
  VIEW,
  VIEW_META
} from '../common/enum'
import { resolvePlatformMeta } from '../common/platform-utils'
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

const emit = defineEmits(['select', 'conversation-op', 'view-change'])

// ---------------------------------------------------------------------------
// 视图 + 平台 + 工单状态（默认值：我的 + 全部 + 全部）
// ---------------------------------------------------------------------------
const currentView = ref(VIEW.MINE)
const currentPlatform = ref(PLATFORM.ALL)
// 工单状态筛选（2026-07-13 新增）。
// 默认不选择（ref('') ＝「全部」＝不传 tag），与视图完全独立，
// 用户需主动点击状态项才会下发 status tag。
// 状态列的"全部"用空串 '' 表示，对应 buildTagParamForStatus 返 undefined 不传 tag。
const currentStatus = ref('')
const filtersCollapsed = ref(false)
const searchKeyword = ref('')

// 视图 / 平台 / 状态项：直接由 enum 派生
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
// 状态项：2026-07-13 修订——去掉"全部"项，只渲染 3 个业务态。
// 默认空选中 = 不传 tag（点击已选项再点 = 取消），交互与平台列完全同构。
const statusItems = computed(() =>
  Object.values(TICKET_STATUS_TAG)
    .filter((k) => k !== TICKET_STATUS_TAG.ALL)
    .map((k) => ({ key: k, ...TICKET_STATUS_TAG_META[k] }))
    .sort((a, b) => a.order - b.order)
)

// 各 filter 下的未读/待办数量。
// 由 fetchUnreadCounts() 通过 im.getTotalUnreadcount({ tag }) 动态填充。
// 注意：getTotalUnreadcount 协议层 QryTotalUnreadCountReq.filter 只支持 tag，
// **不支持 exceptTag**，所以"未分配"（exceptTag=assigned）这个维度的未读数无法用该接口表达，
// 默认保持 0（模板里 v-if 也会判断 filterCounts[it.key] 为 0 不显示）。
const filterCounts = reactive({
  [VIEW.MINE]: 0,
  [VIEW.UNASSIGNED]: 0,   // 协议层不支持 exceptTag，固定为 0
  [VIEW.ALL]: 0,
  [PLATFORM.WEB]: 0,
  [PLATFORM.TELEGRAM]: 0,
  [PLATFORM.JUGGLECHAT]: 0,
  [PLATFORM.WATCHAPP]: 0,
  // 工单状态桶（2026-07-13 新增），每个 key 来自 TICKET_STATUS_TAG
  [TICKET_STATUS_TAG.PENDING]: 0,
  [TICKET_STATUS_TAG.PROCESSING]: 0,
  [TICKET_STATUS_TAG.REOPEN]: 0
  // ALL（空串）不参与 reactive key，会和 VIEW.ALL 共享
})

// "未分配"（exceptTag=assigned）没法用 getTotalUnreadcount 算未读，
// 这里给 UI 一个静态标记。
const UNREAD_UNSUPPORTED_VIEWS = new Set([VIEW.UNASSIGNED])
function isUnreadSupported(view) {
  return !UNREAD_UNSUPPORTED_VIEWS.has(view)
}

function selectView(key) {
  currentView.value = key
  // 工单状态列完全独立于视图 —— 切视图不再覆盖状态选择。
  // 状态默认值由 currentStatus 的初始 ref('') 决定（=不传 tag 走「全部」）。
  // 通知父组件：当前激活的二级视图变化了。
  emit('view-change', key)
}

// 平台列 toggle：再点已选项 = 取消选中（回到 PLATFORM.ALL）。
// 视图组有"全部"项所以是单选；平台组没有"全部"项，靠再点一次取消。
// watch(currentPlatform) 会触发 fetchConversations()，所以这里只要负责状态切换。
function selectPlatform(key) {
  currentPlatform.value = currentPlatform.value === key ? PLATFORM.ALL : key
}

// 工单状态列 toggle：与平台列同构——单选 + 再点取消（回到 ALL/空串）。
//   ALL ('')   → 不传 tag
//   PENDING    → ticket_status_pending
//   PROCESSING → ticket_status_processing
//   REOPEN     → ticket_status_reopen
// watch(currentStatus) 会触发 fetchConversations()，所以这里只要负责状态切换。
function selectStatus(key) {
  currentStatus.value = currentStatus.value === key ? '' : key
}

function toggleFilters() {
  filtersCollapsed.value = !filtersCollapsed.value
}

// ---------------------------------------------------------------------------
// IM 集成
// ---------------------------------------------------------------------------
const juggle = im.getCurrent()
const { Event } = juggle || im

const imConversations = reactive([])
const imReady = ref(false)
const tops = reactive([])
const typingTimers = new Map()

// 本地兜底数据（IM 还没接上时用）
const conversations = reactive([])

// 视图 → juggle.getConversations 的过滤参数。
// 协议层 QryConversationsReq 里 tag 和 exceptTag 是两个独立字段，
// "未分配"用 exceptTag=assigned 才符合协议语义（不要把 '!' 前缀塞进 tag）。
//   mine        → { tag: MY_TICKET }
//   unassigned  → { exceptTag: ASSIGNED }
//   all         → {}
function buildViewTagParams(view) {
  if (view === VIEW.MINE) return { tag: CONVERSATION_TAG_ID.MY_TICKET }
  if (view === VIEW.UNASSIGNED) return { exceptTag: CONVERSATION_TAG_ID.ASSIGNED }
  return {}
}

// 平台 → juggle.getConversations 的 tag 参数（2026-07-13 修订）。
// 不再直接用 PLATFORM.WEB/TELEGRAM/JUGGLECHAT 当 tag，而是映射到新的全局 tag：
//   web        → TICKET_GLOBAL_TAG.CHANNEL_WIDGET   ('channel_widget')
//   telegram   → TICKET_GLOBAL_TAG.CHANNEL_TELEGRAM ('channel_telegram')
//   jugglechat → TICKET_GLOBAL_TAG.CHANNEL_JUGGLEIM ('channel_juggleim')
// PLATFORM.* 仍保留作为 UI 标识 key（filter state / filterCounts 键）。
// 协议层 QryConversationsReq.tag 是单个 string，没有"多 tag AND"的语义，
// 所以"视图 / 平台 / 状态"必须各发一次 getConversations，前端求交集。
function buildTagParamForPlatform(platform) {
  if (!platform || platform === PLATFORM.ALL) return undefined
  if (platform === PLATFORM.WEB) return TICKET_GLOBAL_TAG.CHANNEL_WIDGET
  if (platform === PLATFORM.TELEGRAM) return TICKET_GLOBAL_TAG.CHANNEL_TELEGRAM
  if (platform === PLATFORM.JUGGLECHAT) return TICKET_GLOBAL_TAG.CHANNEL_JUGGLEIM
  if (platform === PLATFORM.WATCHAPP) return TICKET_GLOBAL_TAG.CHANNEL_WATCHAPP
  // 兜底：未知 key 不传 tag，避免打错字符串
  return undefined
}

// 工单状态 → juggle.getConversations 的 tag 参数（2026-07-13 新增）
//   ALL（空串 ''）/ 未选中 → undefined（不传 tag）
//   pending / processing / reopen → 对应的 TICKET_GLOBAL_TAG.STATUS_* 字符串
function buildTagParamForStatus(status) {
  if (!status) return undefined
  return status
}

// imConversations 已经是"当前视图 ∩ 当前平台"的最终结果，
// 不要再做前端过滤，直接透传给模板。
const filteredConversations = computed(() => imConversations)

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
  if (name === MSG_NAME.TICKET_REASSIGN) return im.formatTicketReassignPreview(content)
  if (name === MSG_NAME.ANIMATION_STICKER) return '[表情]'
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

const ticketStatusMeta = {
  [TICKET_GLOBAL_TAG.STATUS_PENDING]: { label: '待处理', className: 'tag-status--pending' },
  [TICKET_GLOBAL_TAG.STATUS_PROCESSING]: { label: '处理中', className: 'tag-status--processing' },
  [TICKET_GLOBAL_TAG.STATUS_CLOSED]: { label: '已关闭', className: 'tag-status--closed' },
  [TICKET_GLOBAL_TAG.STATUS_REOPEN]: { label: '重新打开', className: 'tag-status--reopen' }
}

function resolveTicketStatus(conversation) {
  const tags = Array.isArray(conversation?.tags) ? conversation.tags : []
  for (const tag of tags) {
    const tagId = typeof tag === 'string' ? tag : tag?.id
    if (ticketStatusMeta[tagId]) return ticketStatusMeta[tagId]
  }
  return null
}

// 把 im 会话映射成视图/模板需要的字段。
// 保留这些 key（默认 false/undefined），是为了和工单会话对象保持 shape 一致，
// 让 ChatMain / MainView 用同一套判空逻辑（工单业务字段由后端工单接口注入）。
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
    // 平台标识：优先从 tags 找 channel_* 标记（web / telegram / jugglechat /
    // watchapp），没有 channel tag 时再兜底 c.platform / c.platformKey。
    // 统一输出成 PLATFORM_TAG_ID.* 的小写字符串，保留原 shape 让
    // conv-item__plat-icon / tag label / 分桶（filterCounts）继续按字符串判断。
    platform: resolvePlatformMeta(c)?.key || '',
    tags: c.tags || [],
    // 保留 key 是为了和工单对象 shape 一致。
    isTicket: false,
    status: undefined,
    ticket_id: c.conversationId,
    _raw: c
  }
}


// 关键：SDK 推 CONVERSATION_CHANGED / CONVERSATION_ADDED 事件时，
// 对象可能是稀疏的（只带 id + unreadCount / 一些简单字段，没有 conversationTitle / portrait），
// 常见场景：
// 1) 收到新消息时 SDK 内部 createConversation(message) 创建的会话
//    → 推 CONVERSATION_ADDED，但只来自 message，title/portrait 都是 undefined
// 2) CLEAR_UNREAD 推回的对象只有 unreadIndex，没有 unreadCount 也没有 title
//
// 修复策略：
// 1) 已存在会话：只 merge 非空字段 + 关键字段兜底（防覆盖）
// 2) 新会话：检查关键字段（name / sortTime），**任何一个缺失就不 push**，
//    避免 UI 上出现 "?" 头像 + 空名字 + 空时间的空行。
//    调度一次 fetchUnreadCounts → 全量 getConversations({}) 会拉回完整数据再覆盖。
function upsert(list, convo) {
  const idx = list.findIndex((c) => c.id === convo.id)
  if (idx >= 0) {
    const existing = list[idx]
    const merged = { ...existing }
    for (const k of Object.keys(convo)) {
      const v = convo[k]
      if (v === undefined || v === null || v === '') continue
      merged[k] = v
    }
    for (const k of ['name', 'preview', 'time', 'portrait', 'conversationTitle', 'conversationPortrait', 'sortTime']) {
      if ((merged[k] === undefined || merged[k] === null || merged[k] === '') && existing[k]) {
        merged[k] = existing[k]
      }
    }
    list.splice(idx, 1, merged)
  } else {
    // 新会话：检查关键字段是否缺失
    const hasName = convo.name || convo.conversationTitle
    const hasTime = convo.time || convo.sortTime
    if (!hasName || !hasTime) {
      // 关键字段缺失 → 暂不 push 到 UI。
      // 调度一次全量刷新（debounce 100ms），下次 getConversations({}) 会拉回完整数据。
      // 同时在 _pendingConversationIds 里记下这个 id，fetchConversations 时重点拉一次。
      console.warn('[Conversations] upsert 跳过空字段新会话，调度全量补全', { id: convo.id, hasName, hasTime })
      scheduleUnreadRefresh()
      return
    }
    list.push(convo)
  }
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
  // 多端同步：另一端已读/收到新消息时 SDK 会推这条事件过来。
  // 行内 unread 已经被 mapConversation 用最新的 unreadCount 覆盖，
  // 但侧栏 filterCounts 是分桶算的，需要重新拉一次全量来重新分桶。
  scheduleUnreadRefresh()
}

function onConversationRemoved(conversation) {
  if (!conversation) return
  const idx = imConversations.findIndex((c) => c.id === getConversationId(conversation))
  if (idx >= 0) imConversations.splice(idx, 1)
  // 列表里少了一条：侧栏未读分桶要重新算
  scheduleUnreadRefresh()
}

function onMessageReceived(message) {
  if (!message) return
  const cid = getConversationId(message)
  if (!cid) return
  const target = imConversations.find((c) => c.id === cid)
  if (target) {
    target.preview = shortFormat(message)
    target.time = formatTime(message.sentTime)
    // 新消息：如果是别人发的（不是当前用户），该会话的未读 +1。
    // SDK 推过来的 message 会有 from / senderId / isSender 之类的字段判断"是否自己发的"。
    // 没有可靠字段时不递增（避免重复计数），依赖后续 CONVERSATION_CHANGED 兜底。
    const isFromOther = !(message.isSender || message.fromSelf)
    if (isFromOther) {
      target.unread = (target.unread || 0) + 1
    }
  } else {
    // 列表里没这条会话（被过滤了/还没拉过来）：不处理，等下一次拉列表
  }
  // 收到新消息立即调度一次侧栏未读刷新（debounce 避免短时间内风暴）
  scheduleUnreadRefresh()
}

async function onStateChanged() {
  if (juggle?.isConnected && juggle.isConnected()) {
    // 并行：fetchUnreadCounts 自己拉全量分桶，不依赖 fetchConversations
    await Promise.all([fetchConversations(), fetchUnreadCounts()])
  }
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
  const viewParams = buildViewTagParams(currentView.value)
  const platformTag = buildTagParamForPlatform(currentPlatform.value)
  const statusTag = buildTagParamForStatus(currentStatus.value)
  console.warn('[Conversations] fetchConversations viewParams=', viewParams,
    'platformTag=', platformTag, 'statusTag=', statusTag)
  try {
    // 协议层 QryConversationsReq.tag 是单值，所以视图 / 平台 / 状态 要各发一次。
    // - 视图：tag / exceptTag 任选其一（buildViewTagParams 决定），无则空对象
    // - 平台：web / telegram / jugglechat 作为 tag
    // - 状态：ticket_status_pending / ticket_status_processing / ticket_status_reopen 作为 tag
    // - 至少一方无 tag 时，那一方走"全量"，与其他方做交集。
    //
    // 另外多发一次"无 tag"的全量拉，专用做 im.takeoverTagConversations 的镜像同步。
    // 接管 tag 同步必须用全量：视图 + 平台 + 状态 交集之后的 list 是不完整的，
    // 如果用它去 sync，会把"其他平台/其他视图里被托管的会话"从本地 Set 里清掉。
    // 这条调用和视图渲染无关，失败也不能影响主流程。
    // 收件箱仅显示群组会话（conversationType = GROUP = 2）。
    // 视图 / 平台 / 状态 tag 过滤逻辑保留不变，叠加在群组范围上做交集。
    const GROUP_TYPE = 2
    const calls = [
      juggle.getConversations({ ...viewParams, conversationType: GROUP_TYPE }),
      platformTag
        ? juggle.getConversations({ tag: platformTag, conversationType: GROUP_TYPE })
        : Promise.resolve(null),
      statusTag
        ? juggle.getConversations({ tag: statusTag, conversationType: GROUP_TYPE })
        : Promise.resolve(null),
      // 全量拉，用于接管 tag 同步。和视图/平台/状态过滤无关，单独发。
      // 同样限定在群组范围内，避免把私聊会话的接管 tag 也同步过来。
      juggle.getConversations({ conversationType: GROUP_TYPE }).catch((e) => {
        console.warn('[Conversations] 全量拉取失败，跳过接管 tag 同步', e)
        return null
      })
    ]
    const [viewList, platformList, statusList, fullList] = await Promise.all(calls)
    const viewConvos = (viewList?.conversations) || []
    const platformConvos = platformList ? (platformList.conversations || []) : null
    const statusConvos = statusList ? (statusList.conversations || []) : null
    // 三集合求交：viewConvos ∩ platformConvos（可选）∩ statusConvos（可选）
    let list = viewConvos
    if (platformConvos) {
      const platformIds = new Set(platformConvos.map((c) => c.conversationId || c.id))
      list = list.filter((c) => platformIds.has(c.conversationId || c.id))
    }
    if (statusConvos) {
      const statusIds = new Set(statusConvos.map((c) => c.conversationId || c.id))
      list = list.filter((c) => statusIds.has(c.conversationId || c.id))
    }
    // 接管 tag 用全量同步（fullList 才是服务端接管 tag 的真实视图）。
    if (fullList) {
      im.syncTakeoverTagFromList(fullList.conversations || [])
    }
    imConversations.splice(0, imConversations.length, ...list.map(mapConversation))
    imReady.value = true
  } catch (e) {
    console.error('[Conversations] fetchConversations failed', e)
  }
}

// 视图或平台或工单状态变化时都重新走 IM 拉取。
// - 视图：mine / unassigned / all 都会影响 tag 维度，必须重拉。
// - 平台：web / telegram / jugglechat 也是后端 tag，必须重拉。
// - 工单状态（2026-07-13 新增）：ticket_status_* 也是后端 tag，必须重拉。
// 同时刷新未读数（侧栏 filterCounts 徽标）。
// 切视图/平台/状态：fetchUnreadCounts 自己拉全量分桶，并行即可。
// 注意：即使切了状态（比如 processing），其它状态的未读数仍要保持更新，
// 不能只算当前状态。fetchUnreadCounts 基于全量列表算所有维度，所以不会丢。
watch(currentView, () => Promise.all([fetchConversations(), fetchUnreadCounts()]))
watch(currentPlatform, () => Promise.all([fetchConversations(), fetchUnreadCounts()]))
watch(currentStatus, () => Promise.all([fetchConversations(), fetchUnreadCounts()]))

// 调度刷新未读：debounce 把短时间内的多个事件合并成一次 fetchUnreadCounts。
// 触发场景：MESSAGE_RECEIVED 风暴、CONVERSATION_CHANGED 多端同步、CONVERSATION_REMOVED 等。
// 不 debounce 会导致连续几次接口轰炸。
let _unreadRefreshTimer = null
function scheduleUnreadRefresh(delay = 100) {
  if (_unreadRefreshTimer) return
  _unreadRefreshTimer = setTimeout(() => {
    _unreadRefreshTimer = null
    fetchUnreadCounts().catch((e) => {
      console.warn('[Conversations] scheduled fetchUnreadCounts failed', e)
    })
  }, delay)
}

// 拉未读数：
// 已知问题：服务端 getTotalUnreadcount 忽略 filter.tag 参数（已经过日志确认），
// 无论传不传 tag 都返回"全账号总未读数"。所以 6 个 tag 维度必须在**前端分桶**算。
//
// 数据源：imConversations 里的 _raw.tags（来自 getConversations 协议层）。
// tag 字段约定：
//   my_ticket      → VIEW.MINE
//   assigned       → 取反 = VIEW.UNASSIGNED（不带 assigned 的会话）
//   web/telegram/jugglechat → PLATFORM 对应项
//
// 兜底：imConversations 为空时再退到一次 getTotalUnreadcount({}) 拿全量，
// 保证侧栏起码有个数显示。
async function fetchUnreadCounts() {
  // 不依赖 imConversations（视图子集），自己发一次"无 tag"的 getConversations 拿全量会话。
  // 用全量分桶：7 个 tag 维度（4 视图 + 3 平台）一次算完，不受当前视图/平台选择影响。
  // 登录后 onMounted / onStateChanged / watch 都会调一次，所以"全部"和"具体分类"
  // 都是登录即拉到，不是切到才拉。
  //
  // 兜底：拿不到全量时退到 getTotalUnreadcount({}) 拿单点。
  if (!juggle?.getConversations) return
  // 未读数也只在群组范围内统计；保留 GROUP_TYPE 常量。
  const GROUP_TYPE = 2
  let fullList = []
  try {
    const res = await juggle.getConversations({ conversationType: GROUP_TYPE })
    fullList = (res?.conversations) || []
  } catch (e) {
    console.warn('[Conversations] fetchUnreadCounts 全量拉取失败, 走兜底', e)
  }
  // 兜底：全量没拉到
  if (fullList.length === 0 && juggle?.getTotalUnreadcount) {
    try {
      const res = await im.getTotalUnreadcount({})
      const total = Number(res?.count || 0)
      // 兜底场景下没法分桶，VIEW.ALL / PLATFORM.ALL 拿兜底数，其他保持 0
      filterCounts[VIEW.ALL] = total
      filterCounts[PLATFORM.ALL] = total
      // 兜底也同步 inboxUnreadTotal —— 全账号总未读就是收件箱未读
      // 必须写 .value：im 暴露的是 Ref，赋值给 im.inboxUnreadTotal 会把 default
      // export 对象上的 ref 字段覆盖成普通数字，订阅方再读 .value 会拿到 undefined。
      im.inboxUnreadTotal.value = total
      return
    } catch (e) {
      console.warn('[Conversations] fetchUnreadCounts fallback failed', e)
      return
    }
  }
  // 1) 前端分桶（基于全量列表）
  const local = bucketUnreadByTags(fullList)
  // 2) 写入：4 视图 + 3 平台 + 3 工单状态 + ALL
  //    （VIEW.ALL 和 PLATFORM.ALL 共享 all；工单状态 ALL 用空串 key，不入 reactive map）
  filterCounts[VIEW.MINE] = local.mine
  filterCounts[VIEW.UNASSIGNED] = local.unassigned
  filterCounts[VIEW.ALL] = local.all
  filterCounts[PLATFORM.WEB] = local.web
  filterCounts[PLATFORM.TELEGRAM] = local.telegram
  filterCounts[PLATFORM.JUGGLECHAT] = local.jugglechat
  filterCounts[PLATFORM.WATCHAPP] = local.watchapp
  filterCounts[PLATFORM.ALL] = local.all
  // 工单状态（2026-07-13 新增）：键来自 TICKET_STATUS_TAG.*（非空值）
  filterCounts[TICKET_STATUS_TAG.PENDING] = local.statusPending
  filterCounts[TICKET_STATUS_TAG.PROCESSING] = local.statusProcessing
  filterCounts[TICKET_STATUS_TAG.REOPEN] = local.statusReopen
  // 同步到 im 单例的 inboxUnreadTotal.value，让 NavSidebar 上「收件箱」badge 跟着刷新。
  // 触发条件：fetchUnreadCounts 本身已经被 onStateChanged / watch(currentView|Platform)
  // / scheduleUnreadRefresh（新消息 / CONVERSATION_CHANGED / REMOVED / 清未读）
  // 覆盖，所以新消息到达、用户清未读、切视图/平台时 badge 都会自动更新。
  // 写 .value 才能触发订阅方的重算（NavSidebar 的 inboxBadge computed 依赖 .value）。
  im.inboxUnreadTotal.value = local.all
}

// 前端按 _raw.tags / platform 字段分桶计算未读总数。
// 必须在 imConversations 已填充时调用（>= 1 条），否则结果全是 0。
// 接受 getConversations 返回的**原始对象**（c.unreadCount / c.tags / c.platform），
// 也兼容 mapConversation 映射后的对象（c.unread = c.unreadCount），用 ?? 双兜底。
function bucketUnreadByTags(list) {
  let mine = 0, assigned = 0,
      web = 0, telegram = 0, jugglechat = 0, watchapp = 0, all = 0,
      statusPending = 0, statusProcessing = 0, statusReopen = 0
  for (const c of list) {
    // 兼容两种字段：mapConversation 后的 c.unread，原 SDK 对象的 c.unreadCount
    const unread = Number(c.unread ?? c.unreadCount ?? 0)
    if (unread <= 0) continue
    const tags = c.tags || []
    // 协议层 tag 元素形状是 {id, name, type}（juggleim-es formatConversations
    // 把 converTags 的 {tag, tagName, tagType} 映射成 {id, name, type}）。
    // 之前用 t?.tag 是 SDK 内部变量名，写错了 → 分桶永远 0。
    const isMine = tags.some(t => t?.id === CONVERSATION_TAG_ID.MY_TICKET)
    const isAssigned = tags.some(t => t?.id === CONVERSATION_TAG_ID.ASSIGNED)
    if (isMine) mine += unread
    if (isAssigned) assigned += unread
    // platform 字段：mapConversation 后是 toLowerCase()，原始对象可能大小写不一
    const plat = (c.platform || '').toLowerCase()
    if (plat === PLATFORM_TAG_ID.WEB) web += unread
    else if (plat === PLATFORM_TAG_ID.TELEGRAM) telegram += unread
    else if (plat === PLATFORM_TAG_ID.JUGGLECHAT) jugglechat += unread
    else if (plat === PLATFORM_TAG_ID.WATCHAPP) watchapp += unread
    // 工单状态分桶（2026-07-13 新增）：基于 TICKET_GLOBAL_TAG.STATUS_* 字符串
    const isStatusPending = tags.some(t => t?.id === TICKET_GLOBAL_TAG.STATUS_PENDING)
    const isStatusProcessing = tags.some(t => t?.id === TICKET_GLOBAL_TAG.STATUS_PROCESSING)
    const isStatusReopen = tags.some(t => t?.id === TICKET_GLOBAL_TAG.STATUS_REOPEN)
    if (isStatusPending) statusPending += unread
    if (isStatusProcessing) statusProcessing += unread
    if (isStatusReopen) statusReopen += unread
    all += unread
  }
  // UNASSIGNED = 总 - assigned
  const unassigned = Math.max(0, all - assigned)
  return {
    mine, unassigned, all,
    web, telegram, jugglechat, assigned,
    web, telegram, jugglechat, watchapp, assigned,
    statusPending, statusProcessing, statusReopen
  }
}

// ---------------------------------------------------------------------------
// 点击会话 → 通知父组件展示 chat
// ---------------------------------------------------------------------------
// 清未读：
// - 本地 imConversations 里该行 unread 乐观置 0（不等 SDK 推回事件）。
// - 调 im.clearUnreadCount(convo) 走协议 ClearUnreadReq；SDK 收到响应后会推
//   CONVERSATION_CHANGED 事件，mapConversation 会用最新的 unreadCount 重写该行，
//   与本地乐观置 0 幂等。
// - 调完 SDK 接口后再 fetchUnreadCounts() 一次刷新侧栏徽标（filterCounts）。
async function clearConversationUnread(convo) {
  if (!convo) return
  // 1) 乐观清零
  const target = imConversations.find(
    (c) => c.conversationId === convo.conversationId && c.conversationType === convo.conversationType
  )
  if (target && target.unread > 0) {
    target.unread = 0
  }
  // 2) 走 SDK 协议
  // _raw 是 getConversations 返回的原始对象（mapConversation 里赋值），
  // 含 unreadIndex 字段，能直接给 ClearUnreadReq.conversations 用。
  const raw = convo._raw || convo
  console.log('[Conversations] clearUnreadCount request:', {
    conversationId: raw.conversationId,
    conversationType: raw.conversationType,
    unreadIndex: raw.unreadIndex,
    unreadCount: raw.unreadCount
  })
  const ok = await im.clearUnreadCount(raw)
  console.log('[Conversations] clearUnreadCount result:', { ok })
  if (!ok) {
    // SDK 内部吞了具体错误，这里加一层更详细的 debug
    console.warn(
      '[Conversations] clearUnreadCount failed; 检查 _raw 字段是否齐全。',
      'SDK 要求 ClearUnreadReq.conversations[].unreadIndex（latestReadIndex）'
    )
  }
  // 3) 刷新侧栏未读徽标。失败不阻塞 click 行为。
  fetchUnreadCounts().catch((e) => {
    console.warn('[Conversations] post-click fetchUnreadCounts failed', e)
  })
}

function onConvoClick(convo) {
  if (!convo) return
  emit('select', convo)
  // 异步清未读，不阻塞 emit（父组件马上切到 chat 视图）。
  void clearConversationUnread(convo)
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
onMounted(async () => {
  if (!juggle?.on) return
  if (juggle.isConnected && juggle.isConnected()) {
    // fetchUnreadCounts 现在自己拉全量分桶，不依赖 fetchConversations 的结果。
    // 并行发，登录即拉到所有维度（4 视图 + 3 平台 + ALL）。
    await Promise.all([fetchConversations(), fetchUnreadCounts()])
  }
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

const displayedConversations = computed(() => {
  const keyword = searchKeyword.value.trim().toLocaleLowerCase()
  if (!keyword) return sortedConversations.value

  return sortedConversations.value.filter((conversation) => {
    const raw = conversation?._raw || {}
    const searchableValues = [
      conversation?.name,
      conversation?.id,
      conversation?.conversationId,
      conversation?.customerId,
      conversation?.userid,
      conversation?.preview,
      conversation?.subtitle,
      conversation?.platform,
      raw?.targetId,
      raw?.conversationId,
      raw?.conversationTitle,
      shortFormat(raw?.latestMessage)
    ]
    return searchableValues.some((value) =>
      String(value ?? '').toLocaleLowerCase().includes(keyword)
    )
  })
})

// 暴露给父组件的方法。
// refresh() 主动触发一次「拉 IM 会话 + 拉未读数」，用于父组件在工单认领后
// 让左侧 mine 视图立刻反映 my_ticket tag 的变化。
// refreshOne(conversation) 只刷单条：调 IM SDK 的 getConversation 拿最新 raw
// conversation，再用 mapConversation 包一层 upsert 进 imConversations ——
// 不重拉整个列表。工单认领成功后 SDK 端 addConversationsToTag 已经把 assigned
// tag 落库，但 SDK 本地缓存的 tags 不会立即更新；调一次 getConversation 拿
// 权威视图，再回灌到 UI / currentConversation 即可。
defineExpose({
  refresh() {
    return Promise.all([fetchConversations(), fetchUnreadCounts()])
  },
  async refreshOne(conversation) {
    if (!conversation) return null
    const convKey = getConversationId(conversation)
    if (!convKey) return null
    try {
      const result = await im.getConversation(conversation)
      const fresh = result?.conversation
      if (!fresh) return null
      const wrapped = mapConversation(fresh)
      upsert(imConversations, wrapped)
      return wrapped
    } catch (e) {
      console.warn('[Conversations] refreshOne failed', e)
      return null
    }
  }
})
</script>

<template>
  <div class="conversations" :class="{ 'conversations--filter-collapsed': filtersCollapsed }">
    <!-- 左：过滤侧栏 -->
    <aside class="conv-filter" :class="{ 'conv-filter--collapsed': filtersCollapsed }">
      <!-- 视图组 -->
      <div class="conv-filter__group">
        <div class="conv-filter__group-title">视图</div>
        <button
          v-for="it in viewItems"
          :key="it.key"
          class="conv-filter__item"
          :class="{ 'conv-filter__item--collapsed': filtersCollapsed, 'conv-filter__item--active': currentView === it.key }"
          @click="selectView(it.key)"
        >
          <span
            v-if="it.icon"
            class="conv-filter__item-icon"
            v-html="it.icon"
            aria-hidden="true"
          ></span>
          <span v-if="!filtersCollapsed" class="conv-filter__item-label">{{ it.label }}</span>
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
          :class="{ 'conv-filter__item--collapsed': filtersCollapsed, 'conv-filter__item--active': currentPlatform === it.key }"
          @click="selectPlatform(it.key)"
        >
          <span v-if="!filtersCollapsed" class="conv-filter__dot" :style="{ background: it.color }"></span>
          <span
            v-if="filtersCollapsed"
            class="conv-filter__platform-icon"
            :class="`conv-filter__platform-icon--${it.key}`"
            aria-hidden="true"
            v-html="it.icon"
          ></span>
          <span v-else class="conv-filter__item-label">{{ it.label }}</span>
          <span
            v-if="filterCounts[it.key]"
            class="conv-filter__item-badge"
          >{{ filterCounts[it.key] }}</span>
        </button>
      </div>

      <!-- 工单状态组（2026-07-13 新增，2026-07-13 修订：去掉"全部"项）：
           与平台列同构——单选 + 再点取消（回到空选中 = 不传 tag） -->
      <div class="conv-filter__group">
        <div class="conv-filter__group-title">状态</div>
        <button
          v-for="it in statusItems"
          :key="it.key"
          class="conv-filter__item"
          :class="{ 'conv-filter__item--collapsed': filtersCollapsed, 'conv-filter__item--active': currentStatus === it.key }"
          @click="selectStatus(it.key)"
        >
          <!-- icon 替代色块：默认 currentColor（继承自 .conv-filter__item 黑色），
               选中态由 .conv-filter__item--active 把 color 切到 var(--primary)。 -->
          <span
            v-if="it.icon"
            class="conv-filter__icon"
            aria-hidden="true"
            v-html="it.icon"
          ></span>
          <span v-if="!filtersCollapsed" class="conv-filter__item-label">{{ it.label }}</span>
          <span
            v-if="filterCounts[it.key]"
            class="conv-filter__item-badge"
          >{{ filterCounts[it.key] }}</span>
        </button>
      </div>
    </aside>

    <!-- 右：会话列表（IM 会话，过滤维度由组件内部视图/平台侧栏决定） -->
    <aside class="conv-list-wrap">
      <div class="conv-list-head">
        <h3>
          <button
            class="conv-filter__toggle"
            :class="{ 'conv-filter__toggle--collapsed': filtersCollapsed }"
            :title="filtersCollapsed ? '展开筛选' : '收起筛选'"
            :aria-label="filtersCollapsed ? '展开筛选' : '收起筛选'"
            @click="toggleFilters"
          ><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16M12 12h8M4 18h16"/><path d="m8 9-3 3 3 3"/></svg></button>
          会话 <span class="conv-list-head__sub">{{ displayedConversations.length }} 进行中</span>
        </h3>
      </div>

      <div class="conv-list-search">
        <div class="conv-list-search__inner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input v-model="searchKeyword" placeholder="搜索访客 / 会话 ID / 关键词">
        </div>
      </div>

      <div class="conv-list">
        <slot name="list">
          <div
            v-for="convo in displayedConversations"
            :key="convo.id"
            class="conv-item"
            :class="{
              'conv-item--active': activeId === convo.id,
              'conv-item--unread': convo.unread > 0
            }"
            @click="onConvoClick(convo)"
            @contextmenu="onConvoContextMenu($event, convo)"
          >
            <div class="conv-item__avatar">
              <Avatar
                :name="convo.name"
                :avatar="convo.portrait"
                :platform="convo.platform"
                size="md"
              />
              <span
                v-if="resolvePlatformMeta(convo)?.icon"
                class="conv-item__plat-icon"
                :style="{ color: resolvePlatformMeta(convo)?.color }"
                aria-hidden="true"
                v-html="resolvePlatformMeta(convo)?.icon"
              ></span>
            </div>
            <div class="conv-item__info">
              <div class="conv-item__row1">
                <span class="conv-item__name" :class="{ 'conv-item__name--unread': convo.unread > 0 }">
                  {{ convo.name }}
                </span>
                <span class="conv-item__time">{{ convo.time }}</span>
              </div>
              <div class="conv-item__row2">
                <div class="conv-item__preview">{{ convo.preview }}</div>
                <span
                  v-if="convo.unread > 0"
                  class="conv-item__unread"
                  :title="`${convo.unread} 条未读`"
                >
                  <span class="conv-item__unread-num">{{ convo.unread > 99 ? '99+' : convo.unread }}</span>
                </span>
              </div>
              <div v-if="convo.platform || resolveTicketStatus(convo)" class="conv-item__tags">
                <span v-if="convo.platform" class="tag tag-info">{{ resolvePlatformMeta(convo)?.label || convo.platform }}</span>
                <span
                  v-if="resolveTicketStatus(convo)"
                  class="tag tag-status"
                  :class="resolveTicketStatus(convo).className"
                >{{ resolveTicketStatus(convo).label }}</span>
              </div>
            </div>
          </div>

          <div v-if="displayedConversations.length === 0" class="conv-list__empty">
            {{ searchKeyword.trim() ? '暂无搜索结果' : '暂无匹配的会话' }}
          </div>
        </slot>
      </div>
    </aside>

    <!-- 右键菜单 -->
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
  width: 440px;
  min-width: 440px;
  flex: 0 0 440px;
  background: var(--bg-soft);
  transition: width var(--t), min-width var(--t), flex-basis var(--t);
}
.conversations--filter-collapsed {
  width: 362px;
  min-width: 362px;
  flex-basis: 362px;
}

/* ============== 左：过滤侧栏 ============== */
.conv-filter {
  position: relative;
  width: 140px;
  min-width: 140px;
  background: var(--bg);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  transition: width var(--t), min-width var(--t);
}
.conv-filter--collapsed {
  width: 62px;
  min-width: 62px;
}
.conv-filter--collapsed .conv-filter__group-title {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
}
.conv-filter__toggle {
  width: 20px;
  height: 20px;
  /* margin: 0 5px 0 0; */
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  vertical-align: middle;
  align-self: center;
}
.conv-filter__toggle span {
  display: none;
}
.conv-filter__toggle svg {
  display: block;
  width: 18px;
  height: 18px;
  margin: 0 auto;
}
.conv-filter__toggle--collapsed svg {
  transform: scaleX(-1);
}
.conv-filter__toggle:hover {
  color: var(--primary);
}

.conv-filter__group {
  padding: 8px 6px 4px;
}

.conv-filter__group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
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
  color: var(--text-1);   /* 默认深色：让 status icon 走 currentColor 时也是黑/深灰 */
  font-size: 13px;
  border-radius: var(--r);
  cursor: pointer;
  text-align: left;
  transition: var(--t-fast);
}
.conv-filter__item--collapsed {
  justify-content: center;
  gap: 0;
  padding-left: 8px;
  padding-right: 8px;
}
.conv-filter__item--collapsed .conv-filter__item-icon,
.conv-filter__item--collapsed .conv-filter__icon {
  margin: 0;
}
.conv-filter__item:hover { color: var(--text-1); }   /* 显式保留 hover 颜色 */
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
.conv-filter__platform-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: inherit;
  opacity: 0.85;
}
.conv-filter__platform-icon :deep(svg) {
  display: block;
}
.conv-filter__item--active .conv-filter__platform-icon {
  opacity: 1;
}
/* icon 替代色块（工单状态列）。
   SVG 走 currentColor，颜色由 inline style 注入；和 .conv-filter__dot
   同样占用一行 8x8 的位置，但承载 icon。 */
.conv-filter__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.conv-filter__icon svg {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
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
.conv-item__plat-icon {
  position: absolute;
  bottom: -2px;
  left: -2px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 50%;
  /* Icon SVG is sized at 16x16 in PLATFORM_META; shrink to 12x12 so the
     white circular badge stays 16x16 and reads cleanly against any
     avatar background. */
}
.conv-item__plat-icon :deep(svg) {
  display: block;
  width: 12px;
  height: 12px;
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
.conv-item__row2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.conv-item__unread {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  flex-shrink: 0;
  border-radius: var(--r-full);
  background: var(--danger, #E11D48);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.conv-item__unread-num {
  font-variant-numeric: tabular-nums;
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
  flex: 1;
  min-width: 0;
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
.tag-info { background: var(--info-soft); color: var(--info); }
.tag-status--pending { background: #FFF4E5; color: #B45309; }
.tag-status--processing { background: #EAF3FF; color: #1D6FD6; }
.tag-status--closed { background: #F1F3F5; color: #6B7280; }
.tag-status--reopen { background: #F2EDFF; color: #6D45D6; }
</style>
