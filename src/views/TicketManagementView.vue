<script setup>
/**
 * TicketManagementView
 * ------------------------------------------------------------------
 * 全量工单管理（仅管理员可见入口，由 NavSidebar.isAdmin 兜底）。
 *
 * 数据：
 *   - 列表：GET /jmate/tickets/list?status=&page=&pageSize=
 *   - 详情：列表项字段直接回显（不再二次拉详情）
 *   - 对话历史：IM SDK juggle.getMessages（按 conversationId=ticket_id 拉）
 *   - 工单转移：复用 TicketTransferDialog；emit confirm → MainView.handleTransferTicket
 *   - 分配：UI 占位（接口后给）
 *
 * 设计原则：
 *   - 跟 Conversations/ChatMain 互不干扰，不复用它们的 ref / 事件
 *   - 历史消息拉取用 abortToken 防止过期请求覆盖
 *   - 工单字段参考 /customers/tickets 命名（见 services/api.js）
 */

import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { SERVER_PATH, get } from '../services/api'
import im from '../common/im'
import TicketTransferDialog from '../components/TicketTransferDialog.vue'
import { fetchTransferCandidates } from '../services/agent'
import Avatar from '../components/Avatar.vue'
import MessageItem from '../components/message/MessageItem.vue'
import {
  PLATFORM_META,
} from '../common/enum.js'

const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: '0', label: '待处理' },
  { key: '1', label: '处理中' },
  { key: '2', label: '已关闭' },
  { key: '3', label: '重新打开' }
]

// 服务端 status 字段（数字）：0 待处理 / 1 处理中 / 2 已关闭 / 3 重新打开
const STATUS_LABEL = {
  0: '待处理',
  1: '处理中',
  2: '已关闭',
  3: '重新打开'
}
const STATUS_TONE = {
  0: 'pending',
  1: 'active',
  2: 'closed',
  3: 'reopened'
}

const PLATFROM_FROM_TAG = {
  widget: 'web',
  telegram: 'telegram',
  jugglechat: 'jugglechat',
  watchapp: 'watchapp'
}

// 工单 → 平台 meta（与 Conversations 列表共用同一套 svg / 颜色）
function platformMetaOf(t) {
  if (!t) return null
  return PLATFORM_META[PLATFROM_FROM_TAG[t.channel_type]]
}

// 会话名称：优先后端返回的 conversation_name / name，再老客户昵称
function conversationNameOf(t) {
  return t?.conversation_name || t?.name || t?.title
    || t?.customer?.nickname || t?.customer?.identifier
    || '-'
}

// 复制 id：与 AgentPanel.copyCustomerValue 同一套 navigator.clipboard 调用。
// 失败只打日志，不弹提示。
async function copyValue(value) {
  if (!value || value === '-') return
  if (!navigator?.clipboard) {
    console.warn('[TicketManagementView] clipboard unavailable')
    return
  }
  try {
    await navigator.clipboard.writeText(String(value))
  } catch (e) {
    console.warn('[TicketManagementView] copy failed', e)
  }
}

// 列表 + 分页
const list = reactive({ items: [], total: 0, page: 1, pageSize: 15 })
const activeStatus = ref('all')
const loading = ref(false)
const listError = ref('')
const keyword = ref('')
const selectedTicketId = ref(null)
const showPreview = ref(false)
const selectedTicket = computed(() => list.items.find((t) => t.ticket_id === selectedTicketId.value) || null)

// 关闭预览：清掉选中并隐藏预览面板
function closePreview() {
  selectedTicketId.value = null
  showPreview.value = false
}

// 列表行点击：选中 + 展示预览
function onSelectTicket(t) {
  if (!t?.ticket_id) return
  selectedTicketId.value = t.ticket_id
  showPreview.value = true
}

// 详情侧
const messages = ref([])
const messagesLoading = ref(false)
const messagesError = ref('')
const messagesMoreLoading = ref(false)  // 向上滚时翻页的 loading
const timelineBodyRef = ref(null)       // 滚动容器引用，用于定位到底部
const isHistoryFinished = ref(false)   // SDK 返回 isFinished 标记到底
let messagesAbortToken = 0
const hasMoreMessages = computed(() => !isHistoryFinished.value)
// 给 MessageItem 传 prevMessage：map[messageId] = 上条同会话消息
const prevById = computed(() => {
  const m = new Map()
  for (let i = 1; i < messages.value.length; i++) {
    const prev = messages.value[i - 1]
    const cur = messages.value[i]
    const key = cur.messageId || cur.tid || `${cur.name}-${cur.sentTime}`
    m.set(key, prev)
  }
  return m
})

// 转移弹层
const transferDialog = reactive({ show: false, ticketId: '', displayId: '', currentAssigneeName: '未分配' })

// 分配客服弹层（复用 TicketTransferDialog）
const assignDialog = reactive({ show: false, ticketId: '', displayId: '', currentAssigneeName: '未分配' })

// 分配占位（接口后给）
const assigneeDraft = ref('')

function openAssign() {
  const t = selectedTicket.value
  if (!t?.ticket_id) return
  assignDialog.show = true
  assignDialog.ticketId = t.ticket_id
  assignDialog.displayId = String(t.ticket_id).replace(/^ticket_/, '') || t.ticket_id
  assignDialog.currentAssigneeName = t.assignee?.nickname || t.assignee?.name || '未分配'
}

function onAssignConfirm(picked) {
  const t = selectedTicket.value
  if (!t?.ticket_id) return
  // 分配接口后给，这里先复用 transfer 链路回写到 MainView，避免无操作；
  // 真实接分配接口时替换 emit 内容即可。
  emit('transfer-ticket', {
    ticket_id: t.ticket_id,
    assignee_id: picked.user_id,
    to_assignee_name: picked.nickname,
    note: picked.note || ''
  })
  assignDialog.show = false
}

function onAssignCancel() {
  assignDialog.show = false
}

const totalPages = computed(() => Math.max(1, Math.ceil(list.total / list.pageSize)))

// 页码折叠：超过 7 页时折叠中间，仅显示首/末页 + 当前页 ±1 + 省略号
// 用 '…' 字符串占位让模板容易渲染
const PAGE_GAP = '…'
const pageNumbers = computed(() => {
  const total = totalPages.value
  const cur = list.page
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set([1, total, cur - 1, cur, cur + 1])
  const sorted = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]
    if (i > 0 && n - sorted[i - 1] > 1) out.push(PAGE_GAP)
    out.push(n)
  }
  return out
})
const startIndex = computed(() => (list.page - 1) * list.pageSize)

// 时间格式化（created_time/updated_time 是 unix ms 数字）：YYYY-MM-DD HH:mm
function fmtDateTime(v) {
  if (v == null) return '-'
  const ts = Number(v)
  if (!Number.isFinite(ts)) return String(v)
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 兼容旧调用名：详情卡里仍叫 fmtClock，统一指向 fmtDateTime
function fmtClock(v) {
  return fmtDateTime(v)
}

// 列表加载
async function loadTickets() {
  loading.value = true
  listError.value = ''
  try {
    // 服务端分页参数：limit / offset。前端用 page / pageSize 表达，
    // 请求时换算成 offset，响应里 limit 反推回 pageSize。
    const params = { limit: list.pageSize, offset: (list.page - 1) * list.pageSize }
    if (activeStatus.value !== 'all') params.status = Number(activeStatus.value)
    const res = await get(SERVER_PATH.TICKET_LIST, params)
    if (res?.code === 0) {
      const data = res.data || {}
      list.items = Array.isArray(data.items) ? data.items : []
      list.total = Number(data.total || 0)
      if (Number.isFinite(data.limit) && data.limit > 0) list.pageSize = Number(data.limit)
      // offset 已经表达了当前是第几页，这里不需要再回填 list.page
      // 不默认选中第一条：用户需主动点击才进入预览
    } else {
      listError.value = res?.msg || '加载工单失败'
      list.items = []
      list.total = 0
    }
  } catch (e) {
    console.warn('[TicketManagementView] load tickets failed', e)
    listError.value = '网络错误，请稍后重试'
    list.items = []
    list.total = 0
  } finally {
    loading.value = false
  }
}

// 过滤后的列表（前端关键词过滤，status 由后端做）
const filteredItems = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return list.items
  return list.items.filter((t) => {
    const id = String(t.ticket_id || '').toLowerCase()
    const nick = String(t?.customer?.nickname || '').toLowerCase()
    const ident = String(t?.customer?.identifier || '').toLowerCase()
    return id.includes(k) || nick.includes(k) || ident.includes(k)
  })
})

function switchStatus(key) {
  if (activeStatus.value === key) return
  activeStatus.value = key
  list.page = 1
  selectedTicketId.value = null
  loadTickets()
}

function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === list.page) return
  list.page = p
  loadTickets()
}

// 选中工单 → 拉 IM 历史
async function loadMessages(ticketId) {
  if (!ticketId) return
  const myToken = ++messagesAbortToken
  messagesLoading.value = true
  messagesError.value = ''
  messages.value = []
  isHistoryFinished.value = false
  try {
    const juggle = im.getCurrent()
    if (!juggle) {
      messagesError.value = 'IM 未连接'
      return
    }
    // ticket_id 在 jugglemate 私聊模型里等同于 conversationId。
    // SDK 返回 newest-first；首次拉用 time=0 拿最近一批。
    const params = {
      conversationType: 2,
      conversationId: ticketId,
      time: 0
    }
    const result = await juggle.getMessages(params)
    console.log('[TicketManagementView] loadMessages', ticketId, result)
    if (myToken !== messagesAbortToken) return
    const arr = Array.isArray(result?.messages) ? result.messages : []
    messages.value = arr
    if (result?.isFinished) isHistoryFinished.value = true
    // 先关 loading（让 MessageItem v-for 渲染出来），再滚底。
    // 否则 v-if="messagesLoading" 占位还在，scrollHeight 只是占位的高度。
    messagesLoading.value = false
    // 首屏拉到的是 newest-first，最后一条 = 最新，滚到底
    await scrollToBottom()
  } catch (e) {
    if (myToken !== messagesAbortToken) return
    console.warn('[TicketManagementView] loadMessages failed', e)
    messagesError.value = '历史消息加载失败'
  } finally {
    if (myToken === messagesAbortToken) messagesLoading.value = false
  }
}

// 把 timeline-body 滚到最底（最新消息处）。
// 翻页时不要调用 —— prepend 会把当前视口顶飞，所以翻页路径另算。
//
// 实现细节：messages.value 赋值后等 nextTick 让 Vue 完成 v-for 渲染；
// 但 MessageItem 内部子组件（MessageBubble / MessageText 等）还可能再
// 异步一帧，所以用 requestAnimationFrame 再等一帧；再保险一点用
// setTimeout(0) 兜底，确保 layout 稳定后才算 scrollHeight。
async function scrollToBottom() {
  const el = timelineBodyRef.value
  if (!el) return
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => resolve()))
  // 再保险一次：很多子组件（MessageBubble 包含头像懒加载 / 文本测量）可能
  // 触发 layout 抖动。下一帧再设一次，确保最终位置在底。
  el.scrollTop = el.scrollHeight
  await new Promise((resolve) => requestAnimationFrame(() => resolve()))
  el.scrollTop = el.scrollHeight
}

// 向上滚动加载更多：拿当前最旧一条的 sentTime 翻页，prepend
async function loadMoreMessages() {
  if (!selectedTicketId.value) return
  if (messagesMoreLoading.value || isHistoryFinished.value) return
  const juggle = im.getCurrent()
  if (!juggle || !im.isConnected()) return
  const oldest = messages.value[0]
  if (!oldest) return
  const myToken = messagesAbortToken  // 复用 token，翻页不打断首屏
  messagesMoreLoading.value = true
  try {
    const params = {
      conversationType: 2,
      conversationId: selectedTicketId.value,
      time: oldest.sentTime
    }
    const result = await juggle.getMessages(params)
    if (myToken !== messagesAbortToken) return
    const incoming = Array.isArray(result?.messages) ? result.messages : []
    // 按 messageId 去重 prepend（newest-first，prepend 在数组头）
    const seen = new Set(messages.value.map((m) => m.messageId).filter(Boolean))
    const merged = []
    for (const m of incoming) {
      if (m?.messageId && seen.has(m.messageId)) continue
      if (m?.messageId) seen.add(m.messageId)
      merged.push(m)
    }
    // 注意：SDK 返回的 incoming 仍是 newest-first 的一页，
    // 我们要把它"插到"已有列表最旧端之前 = 拼到末尾再整体 reverse
    messages.value = [...merged, ...messages.value]
    if (result?.isFinished) isHistoryFinished.value = true
    // 如果一整页 0 条新消息，标 finished 避免无谓请求
    if (incoming.length === 0) isHistoryFinished.value = true
  } catch (e) {
    console.warn('[TicketManagementView] loadMoreMessages failed', e)
  } finally {
    if (myToken === messagesAbortToken) messagesMoreLoading.value = false
  }
}

// 监听 timeline-body 滚动：触顶时加载更多
function onTimelineScroll(e) {
  const el = e.target
  if (!el) return
  if (el.scrollTop <= 8) {
    loadMoreMessages()
  }
}

watch(selectedTicketId, (id) => {
  if (id) {
  assigneeDraft.value = selectedTicket.value?.assignee?.nickname || selectedTicket.value?.assignee?.name || ''
    isHistoryFinished.value = false
    loadMessages(id)
    // 默认展示预览（用户点行 = 主动打开预览）
    showPreview.value = true
  } else {
    messages.value = []
    isHistoryFinished.value = false
    assigneeDraft.value = ''
  }
})

// 转移弹层
function openTransfer() {
  const t = selectedTicket.value
  if (!t?.ticket_id) return
  transferDialog.show = true
  transferDialog.ticketId = t.ticket_id
  transferDialog.displayId = String(t.ticket_id).replace(/^ticket_/, '') || t.ticket_id
  transferDialog.currentAssigneeName = t.assignee?.nickname || t.assignee?.name || '未分配'
}

async function onTransferConfirm(picked) {
  const t = selectedTicket.value
  if (!t?.ticket_id) return
  // TicketTransferDialog payload: { user_id, nickname, note }
  // MainView.handleTransferTicket 期望：{ ticket_id, assignee_id, to_assignee_name, note }
  emit('transfer-ticket', {
    ticket_id: t.ticket_id,
    assignee_id: picked.user_id,
    to_assignee_name: picked.nickname,
    note: picked.note || ''
  })
  // 不立刻关闭弹层 —— 由 MainView 通过 chatMainRef.notifyTransferResult 控制；
  // 这里无法走那条链路，所以直接关闭，MainView 已会刷新会话列表；
  // 全量工单视图这边点完转移后主动 reload 一次。
  transferDialog.show = false
  await loadTickets()
}

function onTransferCancel() {
  transferDialog.show = false
}

// 分配占位（接口后给）：这里只更新本地 draft，不发请求
function onAssigneeChange() {
  // 等待真实接口。占位期间仅控制台提示。
  console.log('[TicketManagementView] assignee draft (no-op until API ready)', {
    ticket_id: selectedTicket.value?.ticket_id,
    assignee: assigneeDraft.value
  })
}

const emit = defineEmits(['transfer-ticket'])

onMounted(() => {
  loadTickets()
})

onBeforeUnmount(() => {
  messagesAbortToken++
})

defineExpose({ reload: loadTickets })
</script>

<template>
  <main class="tmv">
    <!-- 左：工单列表 -->
    <section class="tmv__list">
      <header class="tmv__list-header">
        <div class="tmv__search">
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索工单 ID / 客户..."
            class="tmv__search-input"
          />
        </div>
        <div class="tmv__list-actions">
          <button class="tmv__btn tmv__btn--ghost">批量操作</button>
          <button class="tmv__btn tmv__btn--primary">
            新建工单
          </button>
        </div>
      </header>

      <div class="tmv__tabs">
        <button
          v-for="t in STATUS_TABS"
          :key="t.key"
          class="tmv__tab"
          :class="{ 'tmv__tab--active': activeStatus === t.key }"
          @click="switchStatus(t.key)"
        >{{ t.label }}</button>
      </div>

      <div class="tmv__table-wrap">
        <table class="tmv__table">
          <thead>
            <tr>
              <th>客户信息</th>
              <th class="tmv__col-center">渠道</th>
              <th>受理人</th>
              <th>状态</th>
              <th>接待方式</th>
              <th>创建时间</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="tmv__placeholder">加载中...</td>
            </tr>
            <tr v-else-if="listError">
              <td colspan="7" class="tmv__placeholder tmv__placeholder--error">{{ listError }}</td>
            </tr>
            <tr v-else-if="filteredItems.length === 0">
              <td colspan="7" class="tmv__placeholder">暂无工单</td>
            </tr>
            <tr
              v-for="t in filteredItems"
              :key="t.ticket_id"
              class="tmv__row"
              :class="{ 'tmv__row--active': t.ticket_id === selectedTicketId }"
              @click="onSelectTicket(t)"
            >
              <td>
                <div class="tmv__customer">
                  <Avatar
                    :name="t.customer?.nickname || t.customer?.identifier || ''"
                    :avatar="t.customer?.avatar || t.customer?.portrait || ''"
                    :platform="t.channel_type || ''"
                    size="md"
                  />
                  <div class="tmv__customer-text">
                    <div class="tmv__customer-name">{{ t.customer?.nickname || t.customer?.identifier || '-' }}</div>
                    <div class="tmv__customer-id">{{ t.customer?.identifier || t.customer_id || '' }}</div>
                  </div>
                </div>
              </td>
              <td class="tmv__col-center">
                <span
                  v-if="platformMetaOf(t)"
                  class="tmv__channel-svg"
                  :style="{ color: platformMetaOf(t).color }"
                  v-html="platformMetaOf(t).icon"
                ></span>
              </td>
              <td>
                <span v-if="t.assignee?.nickname || t.assignee?.name">{{ t.assignee.nickname || t.assignee.name }}</span>
                <span v-else class="tmv__muted">未分配</span>
              </td>
              <td>
                <span class="tmv__pill" :class="`tmv__pill--${STATUS_TONE[t.status] || 'closed'}`">
                  {{ STATUS_LABEL[t.status] || t.status || '-' }}
                </span>
              </td>
              <td>
                <span v-if="t.is_human_taken_over" class="tmv__muted">人工</span>
                <span v-else class="tmv__muted">Agent</span>
              </td>
              <td class="tmv__muted">{{ fmtDateTime(t.created_time) }}</td>
              <td class="tmv__muted">{{ fmtDateTime(t.updated_time) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="tmv__pager">
        <div class="tmv__pager-info">
          共 {{ list.total }} 条 · 第 {{ startIndex + 1 }}-{{ Math.min(startIndex + list.pageSize, list.total) }} 条 · {{ list.pageSize }} 条/页
        </div>
        <div class="tmv__pager-buttons">
          <button class="tmv__page-btn" :disabled="list.page <= 1" @click="gotoPage(list.page - 1)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <template v-for="(p, i) in pageNumbers" :key="`${p}-${i}`">
            <span v-if="p === '…'" class="tmv__page-gap">…</span>
            <button
              v-else
              class="tmv__page-btn"
              :class="{ 'tmv__page-btn--active': p === list.page }"
              @click="gotoPage(p)"
            >{{ p }}</button>
          </template>
          <button class="tmv__page-btn" :disabled="list.page >= totalPages" @click="gotoPage(list.page + 1)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </footer>
    </section>

    <!-- 右：详情预览（默认隐藏，仅选中后展示） -->
    <aside v-if="showPreview && selectedTicket" class="tmv__detail">
      <header class="tmv__detail-header">
        <h2 class="tmv__detail-title">工单预览</h2>
        <div class="tmv__detail-actions">
          <!-- 关闭预览（icon-only，inline SVG ✕） -->
          <button
            class="tmv__btn tmv__btn--icon"
            aria-label="关闭预览"
            title="关闭预览"
            @click="closePreview"
          ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </header>

        <!-- 客户卡：info-block 风格（无边框 / 无底色，仅用 border-bottom 分隔） -->
        <section class="info-block">
          <!-- profile：头像 + 名称 + 状态 -->
          <div class="info-profile">
            <Avatar
              :name="selectedTicket.customer?.nickname || selectedTicket.customer?.identifier || ''"
              :avatar="selectedTicket.customer?.avatar || selectedTicket.customer?.portrait || ''"
              :platform="selectedTicket.channel_type || ''"
              size="lg"
            />
            <div class="info-profile__body">
              <div class="info-profile__name-row">
                <strong class="info-profile__name">{{ conversationNameOf(selectedTicket) }}</strong>
                <span class="tmv__pill" :class="`tmv__pill--${STATUS_TONE[selectedTicket.status] || 'closed'}`">
                  {{ STATUS_LABEL[selectedTicket.status] || selectedTicket.status || '-' }}
                </span>
              </div>
            </div>
          </div>

          <!-- 字段列表（无底色平铺展示） -->
          <div class="info-list">
            <div class="info-row">
              <span class="info-value">工单 ID</span>
              <span class="info-value info-value--mono">{{ selectedTicket.ticket_id || '-' }}</span>
              <button
                class="info-copy-btn"
                title="复制工单 ID"
                aria-label="复制工单 ID"
                @click="copyValue(selectedTicket.ticket_id)"
              ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
            </div>
            <div class="info-row">
              <span class="info-value">客户 ID</span>
              <span class="info-value info-value--mono">{{ selectedTicket.source_id || '-' }}</span>
              <button
                class="info-copy-btn"
                title="复制客户 ID"
                aria-label="复制客户 ID"
                @click="copyValue(selectedTicket.source_id)"
              ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
            </div>
            <div class="info-row">
              <span class="info-value">渠道源 ID</span>
              <span class="info-value info-value--mono">{{ selectedTicket.customer_id || '-' }}</span>
              <button
                class="info-copy-btn"
                title="复制渠道源 ID"
                aria-label="复制渠道源 ID"
                @click="copyValue(selectedTicket.customer_id)"
              ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
            </div>
            <div class="info-row">
              <span class="info-value">渠道</span>
              <span class="info-value tmv__channel-value">
                <span
                  v-if="platformMetaOf(selectedTicket)"
                  class="tmv__channel-cell"
                  :style="{ color: platformMetaOf(selectedTicket).color }"
                  v-html="platformMetaOf(selectedTicket).icon"
                ></span>
                <span>{{ platformMetaOf(selectedTicket)?.label || selectedTicket.channel_type || '-' }}</span>
              </span>
            </div>
            <div class="info-row">
              <span class="info-value">处理人</span>
              <span class="info-value">
                <span v-if="selectedTicket.assignee?.nickname || selectedTicket.assignee?.name">{{ selectedTicket.assignee.nickname || selectedTicket.assignee.name }}</span>
                <span v-else class="tmv__muted">未分配</span>
              </span>
            </div>
            <div class="info-row">
              <span class="info-value">转人工</span>
              <span class="info-value">
                <span v-if="selectedTicket.is_human_taken_over" class="tmv__human-pill">已转人工</span>
                <span v-else class="tmv__muted">未转人工</span>
              </span>
            </div>
            <div class="info-row">
              <span class="info-value">创建时间</span>
              <span class="info-value">{{ fmtClock(selectedTicket.created_time) }}</span>
            </div>
          </div>

          <!-- tags -->
          <div class="info-list" v-if="selectedTicket.tags && selectedTicket.tags.length">
            <div class="info-row">
              <span class="info-value">标签</span>
              <span class="tmv__tag-list">
                <span
                  v-for="(tg, i) in selectedTicket.tags"
                  :key="i"
                  class="tmv__chip"
                >{{ tg?.name || tg?.tag || tg }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- 对话历史 -->
        <div class="tmv__timeline">
          <div class="tmv__timeline-header">
            <span class="tmv__timeline-title">对话历史</span>
            <!-- <span class="tmv__timeline-count">{{ messages.length }} 条</span> -->
          </div>
          <div ref="timelineBodyRef" class="tmv__timeline-body" @scroll="onTimelineScroll">
            <div v-if="messagesLoading" class="tmv__placeholder">加载消息中...</div>
            <div v-else-if="messagesError" class="tmv__placeholder tmv__placeholder--error">{{ messagesError }}</div>
            <div v-else-if="messages.length === 0" class="tmv__placeholder">暂无消息</div>
            <template v-else>
              <!-- 顶部翻页 loading / 已无更多 -->
              <div v-if="messagesMoreLoading" class="tmv__placeholder tmv__placeholder--inline">加载更早消息中...</div>
              <div v-else-if="!hasMoreMessages && messages.length > 0" class="tmv__placeholder tmv__placeholder--inline">— 已是最早消息 —</div>

              <!-- 复用 ChatMain 同一套 MessageItem：自动按 message.name 分发 text/image/file/video/voice/card/merge/timeline/recall/ticketassign/ticketreassign -->
              <MessageItem
                v-for="m in messages"
                :key="m.messageId || m.tid || `${m.name}-${m.sentTime}`"
                :message="m"
                :prev-message="prevById.get(m.messageId || m.tid || `${m.name}-${m.sentTime}`)"
                :is-group="false"
              />
            </template>
          </div>
        </div>

        <!-- 底部操作：按 status 显示分配客服 / 转移按钮 -->
        <div class="tmv__bottom">
          <!-- 待处理（status=0）：仅展示分配客服 -->
          <button
            v-if="selectedTicket.status === 0"
            class="tmv__btn tmv__btn--primary tmv__btn--block"
            @click="openAssign"
          >分配客服</button>
          <!-- 处理中（status=1）：仅展示转移 -->
          <button
            v-else-if="selectedTicket.status === 1"
            class="tmv__btn tmv__btn--primary tmv__btn--block"
            @click="openTransfer"
          >转移</button>
          <!-- 其他 status：不展示主动作按钮 -->
        </div>
    </aside>

    <TicketTransferDialog
      :show="transferDialog.show"
      :ticket-id="transferDialog.ticketId"
      :ticket-display-id="transferDialog.displayId"
      :current-assignee-name="transferDialog.currentAssigneeName"
      @confirm="onTransferConfirm"
      @cancel="onTransferCancel"
    />
    <TicketTransferDialog
      :show="assignDialog.show"
      :ticket-id="assignDialog.ticketId"
      :ticket-display-id="assignDialog.displayId"
      :current-assignee-name="assignDialog.currentAssigneeName"
      mode="assign"
      :fetch-candidates="fetchTransferCandidates"
      @confirm="onAssignConfirm"
      @cancel="onAssignCancel"
    />
  </main>
</template>

<style scoped>
.tmv {
  flex: 1;
  display: flex;
  min-width: 0;
  height: 100%;
  background: var(--bg, #fff);
}

.tmv__list {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border, #e2e8f0);
  overflow: hidden;
}

.tmv__list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: #fff;
  flex-shrink: 0;
  gap: 12px;
}

.tmv__search {
  flex: 1;
  max-width: 420px;
}
.tmv__search-input {
  width: 100%;
  padding: 6px 12px;
  border: 1px solid transparent;
  background: var(--bg-mute, #f1f5f9);
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.tmv__search-input:focus {
  border-color: var(--primary, #0080ff);
  background: #fff;
}

.tmv__list-actions {
  display: flex;
  gap: 8px;
}

.tmv__btn {
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: opacity 0.15s, background 0.15s;
}
.tmv__btn--ghost {
  color: var(--primary, #0080ff);
  border: 1px solid var(--primary, #0080ff);
}
.tmv__btn--ghost:hover {
  background: var(--primary-fixed, #e0f0ff);
}
.tmv__btn--primary {
  color: #fff;
  background: var(--primary, #0080ff);
}
.tmv__btn--primary:hover {
  opacity: 0.9;
}
.tmv__btn--soft {
  color: var(--primary, #0080ff);
  background: var(--primary-fixed, #e0f0ff);
}
.tmv__btn--soft:hover {
  opacity: 0.8;
}
.tmv__btn--icon {
  padding: 6px;
  width: 28px;
  height: 28px;
  color: var(--text-3, #475569);
  background: transparent;
  border-radius: 6px;
}
.tmv__btn--icon:hover {
  background: var(--bg-mute, #f1f5f9);
  color: var(--text-1, #0f172a);
}

.tmv__tabs {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 16px;
  height: 48px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 5;
  flex-shrink: 0;
}
.tmv__tab {
  background: transparent;
  border: 0;
  font: inherit;
  cursor: pointer;
  height: 100%;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-3, #475569);
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}
.tmv__tab:hover {
  color: var(--primary, #0080ff);
}
.tmv__tab--active {
  color: var(--primary, #0080ff);
  border-bottom-color: var(--primary, #0080ff);
}

.tmv__table-wrap {
  flex: 1;
  overflow-y: auto;
}
.tmv__table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}
.tmv__table thead {
  position: sticky;
  top: 0;
  background: var(--bg-mute, #f8fafc);
  z-index: 2;
}
.tmv__table th {
  padding: 8px 16px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-3, #475569);
  border-bottom: 1px solid var(--border, #e2e8f0);
}
.tmv__table td {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  vertical-align: middle;
}
.tmv__col-center {
  text-align: center;
}

.tmv__row {
  cursor: pointer;
  transition: background 0.15s;
}
.tmv__row:hover {
  background: var(--bg-mute, #f8fafc);
}
.tmv__row--active {
  background: rgba(0, 128, 255, 0.08);
}

.tmv__customer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tmv__customer-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tmv__customer-name {
  font-size: 13px;
  font-weight: 600;
}
.tmv__customer-id {
  font-size: 11px;
  color: var(--text-3, #475569);
}


.tmv__channel-svg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tmv__channel-svg :deep(svg) {
  width: 16px;
  height: 16px;
}
/* 渠道图标现在通过 PLATFORM_META 的 svg + 内联 color 渲染，不再需要 tone class */

.tmv__pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
.tmv__pill--pending {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.tmv__pill--active {
  background: rgba(0, 108, 73, 0.1);
  color: #006c49;
}
.tmv__pill--closed {
  background: rgba(71, 85, 105, 0.1);
  color: #475569;
}
.tmv__pill--reopened {
  background: rgba(124, 77, 255, 0.1);
  color: #7c4dff;
}

.tmv__muted {
  color: var(--text-3, #475569);
}

.tmv__placeholder {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-3, #94a3b8);
  font-size: 13px;
}
.tmv__placeholder--error {
  color: #ef4444;
}

.tmv__pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid var(--border, #e2e8f0);
  background: #fff;
  flex-shrink: 0;
}
.tmv__pager-info {
  font-size: 12px;
  color: var(--text-3, #475569);
}
.tmv__pager-buttons {
  display: flex;
  gap: 4px;
}
.tmv__page-btn {
  width: 32px;
  height: 32px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: var(--text-3, #475569);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.tmv__page-btn:hover:not(:disabled) {
  background: var(--bg-mute, #f1f5f9);
}
.tmv__page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tmv__page-btn--active {
  background: var(--primary, #0080ff);
  color: #fff;
  font-weight: 700;
}

.tmv__page-gap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 32px;
  font-size: 12px;
  color: var(--text-3, #94a3b8);
  user-select: none;
}

/* === 详情 === */
.tmv__detail {
  width: 360px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-left: 1px solid var(--border, #e2e8f0);
  overflow: hidden;
}

.tmv__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3, #94a3b8);
  font-size: 13px;
}

.tmv__detail-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.tmv__detail-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}
.tmv__detail-actions {
  display: flex;
  gap: 8px;
}

/* ===== info-block 风格（与 AgentPanel 一致） ===== */
/* 与 AgentPanel 一致：22 / 20 / 18 padding，仅 border-bottom 分隔，无边框 / 无背景 */
.info-block {
  padding: 22px 20px 18px;
  border-bottom: 1px solid var(--border-soft, var(--border, #e2e8f0));
}
.info-profile {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  min-width: 0;
}
.info-profile :deep(.tyn-avatar--lg) {
  width: 40px;
  height: 40px;
  font-size: 15px;
  margin-right: 12px;
  flex-shrink: 0;
}
.info-profile__body {
  min-width: 0;
  flex: 1;
}
.info-profile__name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  min-width: 0;
}
.info-profile__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1, #0f172a);
  font-size: 16px;
  font-weight: 400;
  line-height: 1.25;
}
.info-profile__title {
  margin-top: 6px;
  color: var(--text-2, #475569);
  font-size: 13px;
  line-height: 1.35;
}

/* 字段列表 */
.info-list {
  display: flex;
  flex-direction: column;
  gap: 13px;
  margin-top: 13px;
}
.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  min-width: 0;
}
/* 字段名 (工单 ID / 处理人 / 创建时间)：第一个 .info-value */
.info-row > .info-value:first-child {
  flex: 0 0 auto;
  width: 64px;
  font-size: 11px;
  color: var(--text-3, #94a3b8);
  overflow: visible;
  white-space: nowrap;
}
/* 字段值：后续的 .info-value */
.info-row > .info-value:not(:first-child) {
  flex: 1;
  min-width: 0;
  color: var(--text-2, #334155);
  font-size: 12px;
  line-height: 1.35;
  /* ID 超长时省略，鼠标 hover 可看全文 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.info-value--mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
}

/* tags 列表（与字段同一行语义） */
.tmv__tag-list {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.tmv__status-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.tmv__human-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  background: #eaf8f1;
  color: #087443;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.tmv__chip {
  padding: 2px 10px;
  background: var(--primary-fixed, #e0f0ff);
  color: var(--primary, #0080ff);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

/* 渠道单元格：svg + 文本同行并居中 */
.tmv__channel-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tmv__channel-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tmv__channel-cell :deep(svg) {
  width: 14px;
  height: 14px;
}

/* 复制按钮：与 AgentPanel.info-copy-btn 一致的 svg 复用 */
.info-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin-left: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-2, #475569);
  cursor: pointer;
}
.info-copy-btn svg {
  width: 14px;
  height: 14px;
}
.info-copy-btn:hover {
  color: var(--primary, #0080ff);
}

.tmv__timeline {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid var(--border, #e2e8f0);
}
.tmv__timeline-header {
  padding: 12px 20px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.tmv__timeline-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-3, #475569);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tmv__timeline-count {
  font-size: 11px;
  color: var(--text-3, #94a3b8);
}
.tmv__timeline-body {
  flex: 1;
  min-height: 0;        /* flex 子项滚动生效 */
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #fff;
}

.tmv__placeholder--inline {
  text-align: center;
  font-size: 11px;
  color: var(--text-3, #94a3b8);
  padding: 4px 0;
}

/* 底部操作：贴在对话历史下方，贴尾部 */
.tmv__bottom {
  padding: 12px 20px;
  border-top: 1px solid var(--border-soft, var(--border, #e2e8f0));
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
/* 底部主操作按钮贴宽填满 */
.tmv__btn--block {
  width: 100%;
  padding: 8px 12px;
  /* 明确请求字体居中：inline-flex 已是 center，额外加 justify-content 防御 */
  justify-content: center;
}
</style>
