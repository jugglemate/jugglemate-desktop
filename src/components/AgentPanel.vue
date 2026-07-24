<script setup>
/**
 * AgentPanel —— 客户侧栏（带 tab 切换）
 * ------------------------------------------------------------------
 * 顶部高度与 ChatMain 的 .tyn-chat-header 一致（56px），外观对齐。
 * 内部两 tab：
 *   - 客户详情：始终展示。
 *       基本信息：label : value 行（id / name / 渠道）
 *       历史工单：拉 GET /jmate/customers/tickets?customer_id=... 渲染列表
 *   - agent 列表：仅当工单已分配（isAssigned=true）时出现。
 *
 * Props
 *   customer          : 客户信息（MainView.currentCustomerInfo）
 *                       { id, name, avatar, channelKey, channelLabel, channelColor }
 *   isAssigned        : 当前工单是否已分配（决定 agent 列表 tab 是否渲染）
 *   agents            : agent 列表（已分配时使用）
 *   selectedAgentId   : 当前选中的 agent id
 *
 * Emits
 *   select-agent(id)  : 点击 agent 行触发，由父组件写入 session
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import Avatar from './Avatar.vue'
import { TICKET_STATUS, TICKET_STATUS_META } from '../common/enum'
import {
  fetchCustomerDetail,
  fetchCustomerTickets,
  fetchConversationByTicketId
} from '../services/customer'

const props = defineProps({
  customer:        { type: Object, default: null },
  isAssigned:      { type: Boolean, default: false },
  agents:          { type: Array,  default: () => [] },
  selectedAgentId: { type: [String, Number], default: null }
})

const emit = defineEmits(['select-agent', 'customer-info-loaded'])

// Tab 列表。agent 列表 tab 仅在已分配时进入可用态，未分配时直接不渲染入口。
const tabs = computed(() => {
  const list = [{ key: 'customer', label: '客户详情' }]
  if (props.isAssigned) list.push({ key: 'agents', label: 'agent 列表' })
  return list
})
const activeTab = ref('customer')

// 客户信息为空时整体不渲染（父组件 v-if 也会兜一层）。
const customer = computed(() => props.customer || null)

// 渠道展示元数据：channelKey → { label, color }。
// channelKey 为空表示没有 tag 命中也没平台字段 —— 显示「-」。
const CHANNEL_META = {
  '':          { label: '-', color: '#9CA3AF' },
  web:         { label: 'Web',      color: '#7C3AED' },
  telegram:    { label: 'Telegram', color: '#FF2442' },
  jugglechat:  { label: 'JuggleChat', color: '#07C160' },
  watchapp:    { label: 'WatchApp', color: '#0EA5E9' }
}
function channelMeta(key) {
  return CHANNEL_META[key] || CHANNEL_META['']
}
const channel = computed(() => channelMeta(customer.value?.channelKey || ''))

// ---------------- 客户详情 + 历史工单 ----------------
// 客户详情（来自 /jmate/customers/:id）：
//   resp: { customer_id, nickname, avatar, phone, email, identifier,
//           channels, first_seen_at, last_seen_at, total_sessions, csat_avg }
// 历史工单（来自 /jmate/customers/tickets?customer_id=...）：见 sprint-1 笔记。
const customerDetail = ref(null)
const customerDetailLoading = ref(false)
const customerDetailError = ref('')

const tickets = ref([])
const ticketsLoading = ref(false)
const ticketsError = ref('')
const conversationNames = ref({})   // { [ticket_id]: string }

let _loadToken = 0   // 防止旧请求覆盖新数据（详情 + 工单共用一个 token）
let _loadedFor = ''  // 最近一次成功加载的 customerId，避免重复点同一会话时重发

async function loadCustomer(customerId) {
  console.log('[AgentPanel] loadCustomer start, customerId =', customerId)
  if (!customerId) {
    console.warn('[AgentPanel] loadCustomer: customerId 为空，跳过网络请求。',
      { activeTab: activeTab.value, customerId: customer.value?.id })
    customerDetail.value = null
    tickets.value = []
    conversationNames.value = {}
    _loadedFor = ''
    return
  }
  // 重复点同一会话（customerId 不变）不再重发请求 —— 详情 / 工单是与
  // customer 绑定的，与 tab / 会话选择次数无关。切到新 customerId 时
  // 由 watch 触发，token 也递增以让旧请求自然过期。
  if (customerId === _loadedFor) return
  const token = ++_loadToken
  customerDetailLoading.value = true
  ticketsLoading.value = true
  customerDetailError.value = ''
  ticketsError.value = ''
  try {
    // 两步走：先 info?ticket_id=<ticketId> 拿 canonical customer_id，
    // 再用这个 customer_id 调 tickets。info 失败 / 没拿到 customer_id
    // 时直接跳过 tickets —— 历史工单必须挂在某个 customer 下，缺这个
    // 锚点时拉到的列表是错的，所以宁可空着也别用 IM 端的 targetId 凑数。
    const detail = await fetchCustomerDetail(customerId).catch((e) => {
      console.warn('[AgentPanel] fetchCustomerDetail failed', e)
      return null
    })
    if (token !== _loadToken) return   // 已被新请求覆盖
    customerDetail.value = detail
    // 把 info 拉到的最新 customer 信息（含 last_seen_at 等）抛给父级，
    // 由父级决定是否同步刷新 IM 端的 peer status。
    emit('customer-info-loaded', { ticketId: customerId, detail })

    const realCustomerId = detail?.customer_id
    let items = []
    if (realCustomerId) {
      items = await fetchCustomerTickets(realCustomerId).catch((e) => {
        console.warn('[AgentPanel] fetchCustomerTickets failed', e)
        return []
      })
      if (token !== _loadToken) return
    } else {
      // info 失败或返回里没有 customer_id —— 不请求历史工单
      console.warn(
        '[AgentPanel] skip fetchCustomerTickets: info 未返回 customer_id',
        { ticketId: customerId, detail }
      )
    }
    tickets.value = items
    _loadedFor = customerId   // 标记本次成功加载的 customerId

    // 异步补全每条工单的会话名（im.getConversation 单独发，无须阻塞列表渲染）
    conversationNames.value = {}
    items.forEach((it) => {
      if (!it || !it.ticket_id) return
      fetchConversationByTicketId(it.ticket_id).then((conv) => {
        if (token !== _loadToken) return
        if (conv) {
          const name = conv.conversationTitle || conv.name || it.ticket_id
          conversationNames.value = { ...conversationNames.value, [it.ticket_id]: name }
        }
      })
    })
  } finally {
    if (token === _loadToken) {
      customerDetailLoading.value = false
      ticketsLoading.value = false
    }
  }
}

// 仅当 customer.id 变化时拉一次（详情 + 工单一起）。切 tab 不触发，
// 重新点同一会话也不触发（loadCustomer 内部 _loadedFor 守卫）。
watch(
  () => customer.value?.id,
  (id) => {
    if (id) void loadCustomer(id)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  // 卸载时让进行中的请求自然过期
  _loadToken++
})

// 派生：基本信息的「id」优先取后端 customer_id，回退到会话给的 id
const customerIdDisplay = computed(() =>
  customerDetail.value?.customer_id || customer.value?.id || '—'
)
// 当前会话的 ticket_id —— 在 jugglemate 私聊模型里 conversationId === targetId
// === ticket_id（见 MainView.currentCustomerInfo 的兜底链）。历史工单接口
// 返回的列表里也包含当前工单（同 customer_id 下的所有 ticket），UI 上把它
// 排除掉，避免侧栏里同时出现"自己"和"当前打开的会话"两条重复项。
const currentTicketId = computed(() => customer.value?.id || '')
// 渲染到侧栏的工单：剔除当前工单。仅渲染层过滤，保留原始 tickets 方便调试
// / 后续如果需要展示"含当前工单"再做反向开关。
const displayedTickets = computed(() => {
  const cur = currentTicketId.value
  if (!cur) return tickets.value
  return tickets.value.filter((t) => t && t.ticket_id !== cur)
})
// 派生：基本信息的「name」优先取后端 nickname，回退到会话给的 name
const customerNameDisplay = computed(() =>
  customerDetail.value?.nickname || customer.value?.name || '—'
)
// 派生：基本信息的「avatar」优先取后端 avatar
const customerAvatarDisplay = computed(() =>
  customerDetail.value?.avatar || customer.value?.avatar || ''
)
// 派生：渠道列表（后端返回的 channels 数组；空时回退到当前会话的 channel）
const customerChannels = computed(() => {
  const list = customerDetail.value?.channels
  if (Array.isArray(list) && list.length > 0) return list
  return customer.value?.channelLabel ? [customer.value.channelLabel] : []
})

const customerEmail = computed(() => customerDetail.value?.email || customer.value?.email || '')
const customerPhone = computed(() => customerDetail.value?.phone || customer.value?.phone || '')
const customerCompany = computed(() => customerDetail.value?.company || customerDetail.value?.organization || customer.value?.company || '')
const customerJobTitle = computed(() => customerDetail.value?.job_title || customerDetail.value?.title || customer.value?.jobTitle || '')
const customerLocation = computed(() => customerDetail.value?.location || customerDetail.value?.city || customer.value?.location || '')

const demoProfile = {
  name: 'soft-lake-3754',
  avatar: 'https://i.pravatar.cc/120?img=12',
  title: '',
  email: ' jugglelChat@im.cn',
  phone: '+86 18800138745',
  location: '北京'
}

async function copyCustomerValue(value) {
  if (!value || !navigator?.clipboard) return
  try { await navigator.clipboard.writeText(value) } catch (e) { console.warn('[AgentPanel] copy failed', e) }
}

// ---------------- helpers ----------------
function statusMeta(status) {
  // status 可能是数字（API 直返）或字符串（万一服务端又改）。
  // 优先按数字匹配。
  const num = Number(status)
  if (TICKET_STATUS_META[num]) return TICKET_STATUS_META[num]
  return { label: '未知', color: '#9CA3AF' }
}

// 渲染 Agent 列表里的创建时间（RFC3339 → 「YYYY-MM-DD」）。
// 输入非法时返回空串，让模板 v-if 自然隐藏。
function formatAgentDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function ticketName(ticket) {
  if (!ticket) return ''
  return conversationNames.value[ticket.ticket_id] || ticket.ticket_id
}
function ticketAssignee(ticket) {
  return ticket?.assignee?.nickname || ticket?.assignee?.id || '—'
}
function ticketTime(ticket) {
  // 默认展示更新时间（最后一次状态变更时间，最能体现活跃度）。
  const t = ticket?.updated_time || ticket?.created_time
  return formatTime(t)
}
function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(Number(ts))
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const diff = (now - d) / 86400000
  if (diff < 7) {
    return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function onClickAgent(agent) {
  if (!agent) return
  emit('select-agent', agent.id)
}
</script>

<template>
  <aside v-if="customer" class="customer-side">
    <!-- Tab 头：高度与 chat header 一致（56px） -->
    <div class="side-tabs">
      <div
        v-for="t in tabs"
        :key="t.key"
        class="side-tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </div>
    </div>

    <!-- 主体：按 tab 切换 -->
    <div class="side-body">
      <!-- ============== 客户详情 tab ============== -->
      <div v-if="activeTab === 'customer'" class="customer-tab">
        <!-- 基本信息 -->
        <section class="info-block">
          <div class="info-profile">
            <Avatar
              :name="customerNameDisplay"
              :avatar="customerAvatarDisplay"
              size="lg"
            />
          </div>
          <div class="info-profile__body">
            <div class="info-profile__name-row">
              <strong class="info-profile__name">{{ customerNameDisplay }}</strong>
            </div>
            <div v-if="demoProfile.title" class="info-profile__title">{{ demoProfile.title }}</div>
          </div>
          <div class="info-list">
            <div class="info-row info-row--contact">
              <span class="info-row__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></span>
              <span class="info-value" :title="demoProfile.email">{{ demoProfile.email }}</span>
              <button class="info-copy-btn" title="复制邮箱" aria-label="复制邮箱" @click="copyCustomerValue(demoProfile.email)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
            </div>
            <div class="info-row info-row--contact">
              <span class="info-row__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z"/></svg></span>
              <span class="info-value">{{ demoProfile.phone }}</span>
              <button class="info-copy-btn" title="复制电话" aria-label="复制电话" @click="copyCustomerValue(demoProfile.phone)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
            </div>
            <div class="info-row info-row--contact">
              <span class="info-row__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span>
              <span class="info-value">{{ demoProfile.location }}</span>
            </div>
            <div class="info-row info-row--contact">
              <span class="info-row__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="m8.2 7.3 2.6 8.3M15.8 7.3l-2.6 8.3M8.5 6h7"/></svg></span>
              <span class="info-value">{{ channel.label }}</span>
            </div>
          </div>
        </section>

        <!-- 历史工单 -->
        <section class="history-block">
          <div class="info-head">历史工单</div>
          <div v-if="ticketsLoading" class="history-empty">加载中…</div>
          <div v-else-if="ticketsError" class="history-empty history-empty--err">{{ ticketsError }}</div>
          <div v-else-if="displayedTickets.length === 0" class="history-empty">暂无历史工单</div>
          <ul v-else class="ticket-list">
            <li
              v-for="t in displayedTickets"
              :key="t.ticket_id"
              class="ticket-item"
            >
              <!-- 头像区域 -->
              <div class="ticket-avatar">
                <Avatar
                  :name="ticketName(t)"
                  :avatar="(t.customer && t.customer.avatar) || ''"
                  size="md"
                />
              </div>
              <!-- 会话信息区域 -->
              <div class="ticket-meta">
                <div class="ticket-meta__name">{{ ticketName(t) }}</div>
                <div class="ticket-meta__assignee">{{ ticketAssignee(t) }}</div>
              </div>
              <!-- 状态区域：时间 + 状态（icon + 文字，颜色仅作用于 icon / 文字） -->
              <div class="ticket-status">
                <div class="ticket-status__time">{{ ticketTime(t) }}</div>
                <div
                  class="ticket-status__chip"
                  :style="{ color: statusMeta(t.status).color }"
                >
                  <span
                    v-if="statusMeta(t.status).icon"
                    class="ticket-status__icon"
                    aria-hidden="true"
                    v-html="statusMeta(t.status).icon"
                  ></span>
                  <span class="ticket-status__label">{{ statusMeta(t.status).label }}</span>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <!-- ============== agent 列表 tab ============== -->
      <div v-else-if="activeTab === 'agents'" class="agent-list">
        <div
          v-for="agent in agents"
          :key="agent.id"
          class="agent-item"
          :class="{
            active:  agent.id === selectedAgentId,
            disabled: agent.enabled === false
          }"
          @click="onClickAgent(agent)"
        >
          <div class="agent-card">
            <div class="agent-card__head">
              <div class="agent-card__title-row">
                <span class="agent-card__name">{{ agent.name }}</span>
                <span
                  v-if="agent.isSystem"
                  class="agent-badge agent-badge--system"
                  title="系统兜底 Agent，所有坐席可见"
                >系统</span>
              </div>
              <div v-if="agent.ownerName" class="agent-card__owner">
                归属：{{ agent.ownerName }}
              </div>
            </div>
            <div class="agent-card__meta">
              <span
                v-if="agent.primaryModel"
                class="agent-card__model"
                :title="`主模型：${agent.primaryModel}`"
              >{{ agent.primaryModel }}</span>
              <span class="agent-card__counts">
                <span class="agent-card__count" title="已挂载知识库数量">
                  <span class="agent-card__count-num">{{ agent.knowledgeCount ?? 0 }}</span> 知识库
                </span>
                <span class="agent-card__count" title="已挂载工具数量">
                  <span class="agent-card__count-num">{{ agent.toolCount ?? 0 }}</span> 工具
                </span>
              </span>
            </div>
            <div v-if="agent.createdAt" class="agent-card__date">
              {{ formatAgentDate(agent.createdAt) }}
            </div>
          </div>
        </div>

        <div v-if="agents.length === 0" class="empty">暂无 Agent</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* ============== 容器 ============== */
.customer-side {
  width: 240px;
  min-width: 240px;
  flex-shrink: 0;
  height: 100vh;
  background: var(--bg);
  border-radius: var(--r-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

/* ============== Tab 头：与 chat header 同高 ============== */
.side-tabs {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  flex-shrink: 0;
  gap: 20px;
}
.side-tab {
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  user-select: none;
  transition: color var(--t-fast);
}
.side-tab:hover { color: var(--text-1); }
.side-tab.active {
  color: var(--primary);
  font-weight: 500;
}
.side-tab.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--primary);
  border-radius: 1px;
}

/* ============== 主体 ============== */
.side-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.customer-tab {
  display: flex;
  flex-direction: column;
}

/* ----- 基本信息 ----- */
.info-block {
  padding: 22px 20px 18px;
  border-bottom: 1px solid var(--border-soft);
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
}
.info-profile__body {
  min-width: 0;
  margin-bottom: 10px;
}
.info-profile__name-row {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
.info-profile__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1);
  font-size: 16px;
  font-weight: 400;
  line-height: 1.25;
}
.info-profile__title {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.35;
}
.info-icon-btn,
.info-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.info-icon-btn {
  width: 18px;
  height: 18px;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
}
.info-icon-btn--external {
  border: 0;
  font-size: 21px;
  font-weight: 400;
}
.info-icon-btn:hover,
.info-copy-btn:hover {
  color: var(--primary);
}
.info-head {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 10px;
}
.info-list {
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.info-row__icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--text-2);
  line-height: 1;
}
.info-row__icon svg {
  width: 14px;
  height: 14px;
}
.info-value {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.info-value--mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
}
.info-copy-btn {
  width: 14px;
  height: 14px;
  margin-left: 2px;
}
.info-copy-btn svg {
  width: 14px;
  height: 14px;
}

/* 渠道 chip */
.channel-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 999px;
  border: 1px solid transparent;
  line-height: 1.5;
  white-space: nowrap;
  flex-shrink: 0;
}
.channel-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ----- 历史工单 ----- */
/* 与 .info-block 顶部 padding 节奏一致（14px 16px 12px），让「历史工单」标题
   视觉上与「基本信息」标题在同一条垂直基线上。 */
.history-block {
  padding: 14px 16px 12px;
}
/* 列表项紧跟在标题下，不重复 padding —— 用 info-head 的 margin-bottom 10px 顶住 */
.history-block .info-head {
  margin-bottom: 0;
}
.history-block .ticket-list {
  margin-top: 10px;
}
.history-empty {
  padding: 16px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}
.history-empty--err {
  color: var(--danger, #EF4444);
}

.ticket-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ticket-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--border-soft);
  transition: background var(--t-fast);
}
.ticket-item:first-child {
  border-top: 0;
}
.ticket-item:hover {
  background: var(--bg-soft);
}
.ticket-avatar {
  width: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ticket-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ticket-meta__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ticket-meta__assignee {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ticket-status {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  min-width: 64px;
  text-align: right;
}
.ticket-status__time {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.3;
}
.ticket-status__chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  /* 颜色由内联 style 注入，作用在 icon + 文字上 */
}
.ticket-status__icon {
  display: inline-flex;
  align-items: center;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.ticket-status__icon svg {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ticket-status__label {
  font-size: 11px;
  line-height: 1.3;
}

/* ============== agent 列表 ============== */
.agent-list {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}
.agent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 8px;
}
.agent-item {
  position: relative;
  display: block;
  cursor: pointer;
  transition: background var(--t-fast), border-color var(--t-fast);
  background: var(--bg-elevated, var(--bg));
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  padding: 10px 12px;
  overflow: hidden;
}
.agent-item:hover {
  background: var(--bg-soft);
  border-color: var(--primary-soft, var(--border-soft));
}
.agent-item.active {
  background: var(--primary-faint);
  border-color: var(--primary);
}
.agent-item.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.agent-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.agent-card__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.agent-card__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.agent-card__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.agent-item.active .agent-card__name {
  color: var(--primary);
}
.agent-card__owner {
  font-size: 11px;
  color: var(--text-3, #6B7280);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.agent-card__model {
  font-size: 11px;
  font-weight: 500;
  color: var(--primary);
  background: var(--primary-faint);
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1.3;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
}
.agent-card__counts {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-2, #4B5563);
  line-height: 1.3;
  flex-shrink: 0;
}
.agent-card__count {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
}
.agent-card__count-num {
  font-weight: 600;
  color: var(--text-1);
}
.agent-card__date {
  font-size: 10px;
  color: var(--text-3, #9CA3AF);
  line-height: 1.3;
  letter-spacing: 0.2px;
}
.agent-badge {
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  font-weight: 500;
  letter-spacing: 0.2px;
  flex-shrink: 0;
}
.agent-badge--system {
  color: var(--text-3, #6B7280);
  background: var(--bg-mute, rgba(107, 114, 128, 0.12));
}

.empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}
</style>
