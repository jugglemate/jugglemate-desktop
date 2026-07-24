import { getApiBaseUrl } from '../config'
import { request, buildUrl } from '../common/request'

const SERVER_PATH = {
  // User APIs
  USER_LOGIN: buildUrl('/jmate/user/login'),

  // Agent APIs
  // 已激活 Agent 列表（新接口契约）：
  //   GET /jmate/agentapi/agents/active?page=<n>&pageSize=<n>
  //   resp.data.items[]: [{
  //     agentId, agentName, ownerId, ownerName, ownerAvatar,
  //     primaryModel, status ('active'), riskFlag, createdAt, publishedAt,
  //     knowledgeCount, toolCount
  //   }, ...]
  //   resp.data.{ total, page, pageSize }
  //   第一页前置系统兜底 Agent (Juggle_Agent)；前端可按 ownerId === 'system'
  //   过滤。返回 code=0 即成功，HTTP 状态码恒为 200。
  AGENTS_ACTIVE: buildUrl('/jmate/agentapi/agents/active'),
  // Agent 流式对话 (SSE)：
  //   POST /jmate/agentapi/chat/stream
  //   body: { agentId, userId, message, conversationId?, enableHistoryContext?, traceId?, metadata? }
  //   resp: text/event-stream，逐条推 { event: 'started'|'token'|'done'|'error', payload: ... }
  //   结束标记: data: [DONE]
  //   EventSource 仅 GET，必须 fetch + ReadableStream（见 services/agent.js::streamAgentChat）。
  CHAT_STREAM: buildUrl('/jmate/agentapi/chat/stream'),
  // 工单 ↔ Agent 绑定（换绑直接覆盖，无解绑接口）：
  //   POST /jmate/agentapi/agents/sessions/bind
  //   body: { sessionId, agentId }
  //   resp.data: { sessionId, agentId, binded: true }
  //   错误码：400_INVALID_REQUEST / 404_TICKET_NOT_FOUND / 404_AGENT_NOT_BINDABLE
  AGENT_BIND_SESSION: buildUrl('/jmate/agentapi/agents/sessions/bind'),
  // 解绑工单 ↔ Agent（POST）
  //   body: { sessionId }
  //   resp.data: { sessionId, agentId: '', binded: false }
  AGENT_UNBIND_SESSION: buildUrl('/jmate/agentapi/agents/sessions/unbind'),
  AGENT_MYBOTS: buildUrl('/jmate/aibots/mybots'),

  // Ticket APIs
  // 全量工单列表（管理员视图）。字段沿用 customers/tickets 命名：
  //   GET /jmate/tickets/list?status=<pending|processing|closed|all>&page=<n>&pageSize=<n>
  //   resp.data.items: [{ ticket_id, source_id, customer_id, customer, inbox_id,
  //                        channel_type, assignee_id, assignee, status,
  //                        created_time, updated_time }, ...]
  //   resp.data: { items, total, page, pageSize }
  TICKET_LIST: buildUrl('/jmate/tickets/list'),
  TICKET_CLAIM: (ticketId) => buildUrl(`/jmate/tickets/${ticketId}/claim`),
  // 工单转移提交：POST /jmate/tickets/:ticketId/transfer
  //   body: { to_assignee_id, to_assignee_name, note, expected_version }
  //   resp: { code, data: { ticket_id, old_..., new_..., version, updated_at } }
  TICKET_TRANSFER: (ticketId) => buildUrl(`/jmate/tickets/${ticketId}/transfer`),

  // 工单内成员列表（工单转移的候选目标）。ticket_id 不为空，约定等同于会话 id。
  // GET /jmate/tickets/inboxmembers/list?ticket_id=<ticket_id>&limit=<n>[&start_id=<next_start_id>]
  //   resp.data.items: [{ user_id, username, avatar, email }]
  //   resp.data.next_start_id: number | null（分页游标，null 表示最后一页）
  // 见 src/services/agent.js::fetchTransferCandidates
  TICKET_INBOX_MEMBERS_LIST: buildUrl('/jmate/tickets/inboxmembers/list'),

  // 客户历史工单：GET /jmate/customers/tickets?customer_id=<id>
  //   resp.data.items: [{ ticket_id, source_id, customer_id, customer, inbox_id,
  //                        channel_type, assignee_id, assignee, status,
  //                        created_time, updated_time }, ...]
  //   resp.data.next_start_id: number | null（分页游标，0/null 即无下一页）
  CUSTOMER_TICKETS: buildUrl('/jmate/customers/tickets'),

  // 客户详情：GET /jmate/customers/ticket_id=<id>
  //   resp.data: { customer_id, nickname, avatar, phone, email, identifier,
  //                channels, first_seen_at, last_seen_at, total_sessions, csat_avg }
  CUSTOMER_DETAIL: (id) => buildUrl(`/jmate/customers/info?ticket_id=${id}`)
}

async function get(url, params = {}) {
  const qs = new URLSearchParams(params).toString()
  const fullUrl = qs ? `${url}?${qs}` : url
  return request(fullUrl, { method: 'GET' })
}

async function post(url, data = {}) {
  return request(url, {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

export { SERVER_PATH, get, post }
export default SERVER_PATH
