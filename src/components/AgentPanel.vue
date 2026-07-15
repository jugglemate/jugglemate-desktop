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

console.log('[AgentPanel] props-----:', props.customer, props.isAssigned, props.agents, props.selectedAgentId)
const emit = defineEmits(['select-agent'])

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
// channelKey 为空表示没有 tag 命中也没平台字段 —— 显示「未知渠道」。
const CHANNEL_META = {
  '':          { label: '未知渠道', color: '#9CA3AF' },
  web:         { label: 'Web',      color: '#7C3AED' },
  telegram:    { label: 'Telegram', color: '#FF2442' },
  jugglechat:  { label: 'JuggleChat', color: '#07C160' }
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

async function loadCustomer(customerId) {
  console.log('[AgentPanel] loadCustomer start, customerId =', customerId)
  if (!customerId) {
    console.warn('[AgentPanel] loadCustomer: customerId 为空，跳过网络请求。',
      { activeTab: activeTab.value, customerId: customer.value?.id })
    customerDetail.value = null
    tickets.value = []
    conversationNames.value = {}
    return
  }
  const token = ++_loadToken
  customerDetailLoading.value = true
  ticketsLoading.value = true
  customerDetailError.value = ''
  ticketsError.value = ''
  try {
    // 客户详情 + 历史工单并行拉，任一失败不影响另一个
    const [detail, items] = await Promise.all([
      fetchCustomerDetail(customerId).catch((e) => {
        console.warn('[AgentPanel] fetchCustomerDetail failed', e)
        return null
      }),
      fetchCustomerTickets(customerId).catch((e) => {
        console.warn('[AgentPanel] fetchCustomerTickets failed', e)
        return []
      })
    ])
    if (token !== _loadToken) return   // 已被新请求覆盖
    customerDetail.value = detail
    tickets.value = items

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

// 切到客户详情 tab 或 customer.id 变化时拉一次（详情 + 工单一起）
watch(
  () => [activeTab.value, customer.value?.id],
  ([tab, id]) => {
    if (tab === 'customer' && id) {
      void loadCustomer(id)
    }
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

// ---------------- helpers ----------------
function statusMeta(status) {
  // status 可能是数字（API 直返）或字符串（万一服务端又改）。
  // 优先按数字匹配。
  const num = Number(status)
  if (TICKET_STATUS_META[num]) return TICKET_STATUS_META[num]
  return { label: '未知', color: '#9CA3AF' }
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
        <!-- 基本信息：label : value 行（数据来源：/jmate/customers/:id） -->
        <section class="info-block">
          <!-- 40x40 头像居中（基本信息首屏） -->
          <div class="info-avatar">
            <Avatar
              :name="customerNameDisplay"
              :avatar="customerAvatarDisplay"
              size="md"
            />
          </div>
          <div class="info-head">基本信息</div>
          <div class="info-list">
            <div class="info-row">
              <span class="info-label">id</span>
              <span class="info-value info-value--mono" :title="customerIdDisplay">{{ customerIdDisplay }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">name</span>
              <span class="info-value">{{ customerNameDisplay }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">渠道</span>
              <span class="info-value">
                <span
                  class="channel-chip"
                  :style="{ background: channel.color + '14', color: channel.color, borderColor: channel.color + '33' }"
                >
                  <span class="channel-dot" :style="{ background: channel.color }"></span>
                  {{ channel.label }}
                </span>
              </span>
            </div>
          </div>
        </section>

        <!-- 历史工单 -->
        <section class="history-block">
          <div class="info-head">历史工单</div>
          <div v-if="ticketsLoading" class="history-empty">加载中…</div>
          <div v-else-if="ticketsError" class="history-empty history-empty--err">{{ ticketsError }}</div>
          <div v-else-if="tickets.length === 0" class="history-empty">暂无历史工单</div>
          <ul v-else class="ticket-list">
            <li
              v-for="t in tickets"
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
          <div class="agent-avatar">
            <Avatar
              :name="agent.name"
              :avatar="agent.emoji"
              size="md"
            />
          </div>
          <div class="agent-info">
            <div class="agent-name">{{ agent.name }}</div>
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
  width: 280px;
  min-width: 280px;
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
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border-soft);
}
/* 40x40 头像居中（基本信息首屏） */
.info-avatar {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 0 auto 14px;
  width: 40px;
  height: 40px;
}
.info-avatar :deep(.tyn-avatar--md) {
  width: 40px;
  height: 40px;
  font-size: 15px;
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
  gap: 8px;
}
.info-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 22px;
}
.info-label {
  flex-shrink: 0;
  width: 48px;
  font-size: 12px;
  color: var(--text-3);
}
.info-value {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.info-value--mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
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
.agent-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background var(--t-fast);
  background: var(--bg);
  border-bottom: 1px solid var(--border-soft);
}
.agent-item:hover {
  background: var(--bg-soft);
}
.agent-item.active {
  background: var(--primary-faint);
}
.agent-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--primary);
}
.agent-item.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.agent-avatar {
  position: relative;
  flex-shrink: 0;
}
.agent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-item.active .agent-name {
  font-weight: 600;
}

.empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}
</style>
