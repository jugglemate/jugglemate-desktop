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
 * 视图 + 平台都直接走 IM 后端 getConversations：
 *   协议层 QryConversationsReq.tag 是单个 string，没有"多 tag AND"语义，
 *   所以 fetchConversations() 会各发一次请求，
 *   视图带 viewTag、平台带 platformTag，前端按 conversationId 求交集。
 * 视图 → buildViewTagParams(view) 返回 { tag?, exceptTag? }：
 *   mine        → { tag: CONVERSATION_TAG_ID.MY_TICKET }
 *   unassigned  → { exceptTag: CONVERSATION_TAG_ID.ASSIGNED } （协议层 exceptTag 字段）
 *   ai_takeover → { tag: TAKEOVER_TAG_ID }
 *   all         → {} （不传 tag / exceptTag）
 * 平台 → platformTag：
 *   all / 其它  → 不传 / 传对应 platform 字符串（web / telegram / jugglechat）
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import im from '../common/im'
import {
  MSG_NAME,
  CONVERSATION_TAG_ID,
  PLATFORM,
  PLATFORM_TAG_ID,
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

const emit = defineEmits(['select', 'conversation-op', 'suggestion-received', 'view-change'])

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

// 各 filter 下的未读/待办数量。
// 由 fetchUnreadCounts() 通过 im.getTotalUnreadcount({ tag }) 动态填充。
// 注意：getTotalUnreadcount 协议层 QryTotalUnreadCountReq.filter 只支持 tag，
// **不支持 exceptTag**，所以"未分配"（exceptTag=assigned）这个维度的未读数无法用该接口表达，
// 默认保持 0（模板里 v-if 也会判断 filterCounts[it.key] 为 0 不显示）。
const filterCounts = reactive({
  [VIEW.MINE]: 0,
  [VIEW.UNASSIGNED]: 0,   // 协议层不支持 exceptTag，固定为 0
  [VIEW.AI_TAKEOVER]: 0,
  [VIEW.ALL]: 0,
  [PLATFORM.WEB]: 0,
  [PLATFORM.TELEGRAM]: 0,
  [PLATFORM.JUGGLECHAT]: 0
})

// "未分配"（exceptTag=assigned）没法用 getTotalUnreadcount 算未读，
// 这里给 UI 一个静态标记。
const UNREAD_UNSUPPORTED_VIEWS = new Set([VIEW.UNASSIGNED])
function isUnreadSupported(view) {
  return !UNREAD_UNSUPPORTED_VIEWS.has(view)
}

function selectView(key) {
  currentView.value = key
  // 通知父组件：当前激活的二级视图变化了。
  emit('view-change', key)
}

// 平台列 toggle：再点已选项 = 取消选中（回到 PLATFORM.ALL）。
// 视图组有"全部"项所以是单选；平台组没有"全部"项，靠再点一次取消。
// watch(currentPlatform) 会触发 fetchConversations()，所以这里只要负责状态切换。
function selectPlatform(key) {
  currentPlatform.value = currentPlatform.value === key ? PLATFORM.ALL : key
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
//   ai_takeover → { tag: jm_takeover }
//   all         → {}
function buildViewTagParams(view) {
  if (view === VIEW.MINE) return { tag: CONVERSATION_TAG_ID.MY_TICKET }
  if (view === VIEW.UNASSIGNED) return { exceptTag: CONVERSATION_TAG_ID.ASSIGNED }
  if (view === VIEW.AI_TAKEOVER) return { tag: im.TAKEOVER_TAG_ID }
  return {}
}

// 平台 → juggle.getConversations 的 tag 参数
//   ALL 不传 tag；其它（web / telegram / jugglechat）直接当 tag 用。
// 协议层 QryConversationsReq.tag 是单个 string，没有"多 tag AND"的语义，
// 所以"视图"和"平台"必须各发一次 getConversations，再前端求交集。
// 这部分逻辑在 fetchConversations() 里实现。
function buildTagParamForPlatform(platform) {
  if (!platform || platform === PLATFORM.ALL) return undefined
  return platform
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
    isTakeover: im.isInTakeoverTag(c),
    // juggle.getConversations 返回的 c.platform 是小写字符串（web / telegram / jugglechat）。
    // 模板里 conv-item__plat-dot 用这个字段决定颜色。
    platform: (c.platform || '').toLowerCase(),
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
  console.warn('[Conversations] fetchConversations viewParams=', viewParams, 'platformTag=', platformTag)
  try {
    // 协议层 QryConversationsReq.tag 是单值，所以视图 / 平台要各发一次。
    // - 视图：tag / exceptTag 任选其一（buildViewTagParams 决定），无则空对象
    // - 平台：web / telegram / jugglechat 作为 tag
    // - 至少一方无 tag 时，那一方走"全量"，与另一方做交集。
    //
    // 另外多发一次"无 tag"的全量拉，专用做 im.takeoverTagConversations 的镜像同步。
    // 接管 tag 同步必须用全量：视图 + 平台交集之后的 viewConvos 是不完整的，
    // 如果用它去 sync，会把"其他平台/其他视图里被托管的会话"从本地 Set 里清掉。
    // 这条调用和视图渲染无关，失败也不能影响主流程。
    const calls = [
      juggle.getConversations(viewParams),
      platformTag
        ? juggle.getConversations({ tag: platformTag })
        : Promise.resolve(null),
      // 全量拉，用于接管 tag 同步。和视图/平台过滤无关，单独发。
      juggle.getConversations({}).catch((e) => {
        console.warn('[Conversations] 全量拉取失败，跳过接管 tag 同步', e)
        return null
      })
    ]
    const [viewList, platformList, fullList] = await Promise.all(calls)
    const viewConvos = (viewList?.conversations) || []
    const platformConvos = platformList ? (platformList.conversations || []) : null
    let list
    if (platformConvos) {
      // 平台带 tag：取两个集合的交集（按 conversationId）。
      const platformIds = new Set(platformConvos.map((c) => c.conversationId || c.id))
      list = viewConvos.filter((c) => platformIds.has(c.conversationId || c.id))
    } else {
      // 平台 = ALL：直接用视图结果。
      list = viewConvos
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

// 视图或平台变化时都重新走 IM 拉取。
// - 视图：mine / unassigned / ai_takeover / all 都会影响 tag 维度，必须重拉。
// - 平台：web / telegram / jugglechat 也是后端 tag，必须重拉。
// 同时刷新未读数（侧栏 filterCounts 徽标）。
// 切视图/平台：fetchUnreadCounts 自己拉全量分桶，并行即可。
// 注意：即使切了平台（比如 Web），其它平台（telegram/jugglechat）的未读数仍要保持更新，
// 不能只算当前平台。fetchUnreadCounts 基于全量列表算所有维度，所以不会丢。
watch(currentView, () => Promise.all([fetchConversations(), fetchUnreadCounts()]))
watch(currentPlatform, () => Promise.all([fetchConversations(), fetchUnreadCounts()]))

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
//   jm_takeover    → VIEW.AI_TAKEOVER
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
  let fullList = []
  try {
    const res = await juggle.getConversations({})
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
      return
    } catch (e) {
      console.warn('[Conversations] fetchUnreadCounts fallback failed', e)
      return
    }
  }
  // 1) 前端分桶（基于全量列表）
  const local = bucketUnreadByTags(fullList)
  // 2) 写入：4 视图 + 3 平台 + ALL（VIEW.ALL 和 PLATFORM.ALL 共享 all）
  filterCounts[VIEW.MINE] = local.mine
  filterCounts[VIEW.AI_TAKEOVER] = local.takeover
  filterCounts[VIEW.UNASSIGNED] = local.unassigned
  filterCounts[VIEW.ALL] = local.all
  filterCounts[PLATFORM.WEB] = local.web
  filterCounts[PLATFORM.TELEGRAM] = local.telegram
  filterCounts[PLATFORM.JUGGLECHAT] = local.jugglechat
  filterCounts[PLATFORM.ALL] = local.all
}

// 前端按 _raw.tags / platform 字段分桶计算未读总数。
// 必须在 imConversations 已填充时调用（>= 1 条），否则结果全是 0。
// 接受 getConversations 返回的**原始对象**（c.unreadCount / c.tags / c.platform），
// 也兼容 mapConversation 映射后的对象（c.unread = c.unreadCount），用 ?? 双兜底。
function bucketUnreadByTags(list) {
  let mine = 0, takeover = 0, assigned = 0,
      web = 0, telegram = 0, jugglechat = 0, all = 0
  for (const c of list) {
    // 兼容两种字段：mapConversation 后的 c.unread，原 SDK 对象的 c.unreadCount
    const unread = Number(c.unread ?? c.unreadCount ?? 0)
    if (unread <= 0) continue
    const tags = c.tags || []
    const isMine = tags.some(t => t?.tag === CONVERSATION_TAG_ID.MY_TICKET)
    const isTakeover = tags.some(t => t?.tag === im.TAKEOVER_TAG_ID)
    const isAssigned = tags.some(t => t?.tag === CONVERSATION_TAG_ID.ASSIGNED)
    if (isMine) mine += unread
    if (isTakeover) takeover += unread
    if (isAssigned) assigned += unread
    // platform 字段：mapConversation 后是 toLowerCase()，原始对象可能大小写不一
    const plat = (c.platform || '').toLowerCase()
    if (plat === PLATFORM_TAG_ID.WEB) web += unread
    else if (plat === PLATFORM_TAG_ID.TELEGRAM) telegram += unread
    else if (plat === PLATFORM_TAG_ID.JUGGLECHAT) jugglechat += unread
    all += unread
  }
  // UNASSIGNED = 总 - assigned
  const unassigned = Math.max(0, all - assigned)
  return {
    mine, takeover, unassigned, all,
    web, telegram, jugglechat, assigned
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

// 暴露给父组件的方法。
// refresh() 主动触发一次「拉 IM 会话 + 拉未读数」，用于父组件在工单认领后
// 让左侧 mine 视图立刻反映 my_ticket tag 的变化。
defineExpose({
  refresh() {
    return Promise.all([fetchConversations(), fetchUnreadCounts()])
  }
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

    <!-- 右：会话列表（IM 会话，过滤维度由组件内部视图/平台侧栏决定） -->
    <aside class="conv-list-wrap">
      <div class="conv-list-head">
        <h3>会话 <span class="conv-list-head__sub">{{ sortedConversations.length }} 进行中</span></h3>
        <div class="conv-list-head__tools">
          <button title="刷新"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
        </div>
      </div>

      <div class="conv-list-search">
        <div class="conv-list-search__inner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input placeholder="搜索访客 / 会话 ID / 关键词">
        </div>
      </div>

      <div class="conv-list">
        <slot name="list">
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
.tag-ai { background: var(--ai-soft); color: var(--ai); }
.tag-info { background: var(--info-soft); color: var(--info); }
</style>
