<script setup>
import { ref, onMounted } from 'vue'
import { SERVER_PATH, get } from '../services/api'
import im from '../common/im'
import Avatar from './Avatar.vue'

const props = defineProps({
  filter: {
    type: String,
    default: 'unassigned'
  }
})

const emit = defineEmits(['select'])

const tickets = ref([])
const loading = ref(false)
const error = ref(null)

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

const channelLabels = {
  web: '网页',
  wechat: '微信',
  app: 'App'
}

function channelLabel(id) {
  return channelLabels[id] || id
}

async function fetchTickets() {
  loading.value = true
  error.value = null
  try {
    const res = await get(SERVER_PATH.TICKET_LIST, { status: 0, limit: 50 })
    tickets.value = res?.data?.items || []
  } catch (e) {
    console.warn('[TicketList] fetchTickets failed', e)
    error.value = '加载工单列表失败'
  } finally {
    loading.value = false
  }
}

function buildTicketConversation(ticket) {
  // TicketList 只展示 status=0（未分配）的工单，所以这里固定写 0。
  // 同时把 ticket_id 显式带过去，ChatMain 的认领接口需要这个字段。
  return {
    id: ticket.ticket_id,
    conversationId: ticket.ticket_id,
    conversationType: im.ConversationType.GROUP,
    name: ticket.customer?.nickname || '匿名访客',
    portrait: ticket.customer?.avatar || '',
    platform: ticket.channel_id || 'web',
    customerId: ticket.customer_id || '',
    sourceId: ticket.source_id || '',
    // 工单标识 + 状态（0=未分配，1=处理中，2=已关闭）
    ticketId: ticket.ticket_id,
    ticket_id: ticket.ticket_id,
    status: 0,
    isTicket: true
  }
}

function openDetail(ticket) {
  emit('select', buildTicketConversation(ticket))
}

onMounted(() => {
  fetchTickets()
})

defineExpose({ refresh: fetchTickets })
</script>

<template>
  <div class="tyn-sidebar__convos">
    <!-- Loading -->
    <div v-if="loading" class="tyn-sidebar__empty">加载中…</div>

    <!-- Error -->
    <div v-else-if="error" class="tyn-sidebar__empty">{{ error }}</div>

    <!-- Empty -->
    <div v-else-if="tickets.length === 0" class="tyn-sidebar__empty">没有待分配工单</div>

    <!-- Ticket list -->
    <div
      v-for="ticket in tickets"
      :key="ticket.ticket_id"
      class="tyn-convo-item"
      @click="openDetail(ticket)"
    >
      <Avatar
        class="tyn-convo-item__avatar"
        :name="ticket.customer?.nickname || '访客'"
        :avatar="ticket.customer?.avatar"
        size="md"
      />
      <div class="tyn-convo-item__info">
        <div class="tyn-convo-item__name">
          <span class="tyn-convo-item__name-text">{{ ticket.customer?.nickname || '匿名访客' }}</span>
          <span class="tyn-convo-item__time">{{ formatTime(ticket.created_time) }}</span>
        </div>
        <div class="tyn-convo-item__preview">
          <span class="ticket-list__channel">{{ channelLabel(ticket.channel_id) }}</span>
          <span class="ticket-list__id">#{{ ticket.ticket_id?.slice(-8) }}</span>
        </div>
      </div>
      <!-- <div class="ticket-list__status">待处理</div> -->
    </div>
  </div>
</template>

<style scoped>
.ticket-list__title {
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
  color: #1A202C;
}

.ticket-list__channel {
  font-size: 11px;
  color: #4A90E2;
  background: rgba(74, 144, 226, 0.08);
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: 6px;
}

.ticket-list__id {
  font-size: 11px;
  color: #B0B8C1;
}

.ticket-list__status {
  font-size: 11px;
  color: #E6A23C;
  background: rgba(230, 162, 60, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}
</style>
