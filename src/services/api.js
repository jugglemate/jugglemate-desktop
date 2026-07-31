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
  CUSTOMER_DETAIL: (id) => buildUrl(`/jmate/customers/info?ticket_id=${id}`),

  // Console stats APIs（管理员视图，需 role=2）。
  // 三个接口都挂 /jmate/console/stats/ 下，授权 Header 由 request.js 统一注入。
  // 详见 docs/console-stats-api.md（jugglemate-server）。
  // 总览：GET /jmate/console/stats/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|hour
  //   resp.data: { from, to, granularity, totals, new_sessions_trend, channel_ranking }
  //   totals: { total_sessions, ai_resolved_sessions, ai_resolution_rate,
  //             transferred_to_human (int,固定 0), transferred_to_human_pending (bool),
  //             open_sessions, closed_sessions }
  //   new_sessions_trend: [{ bucket, total, ai_resolved, transferred_to_human }]
  //   channel_ranking: [{ channel_type, count, percentage }]
  STATS_OVERVIEW: buildUrl('/jmate/console/stats/overview'),
  // 坐席列表：GET /jmate/console/stats/agents?from=&to=&include_admin=&page=&pageSize=
  //   resp.data.items: [{ user_id, login_account, nickname, avatar, email, role,
  //                       inbox_count, total_sessions, responded_sessions, open_sessions,
  //                       csat_avg, frt_avg_ms, csat_pending, frt_pending }]
  //   resp.data: { items, total, limit, offset }
  STATS_AGENTS: buildUrl('/jmate/console/stats/agents'),
  // 客户列表：GET /jmate/console/stats/customers?from=&to=&keyword=&channel_type=&page=&pageSize=
  //   resp.data.items: [{ customer_id, nickname, avatar, phone, email, identifier,
  //                       source, session_count, last_session_time }]
  //   resp.data: { items, total, limit, offset }
  STATS_CUSTOMERS: buildUrl('/jmate/console/stats/customers'),

  // 联系人列表（管理员视图）。
  // 真实接口待对接，路径占位先这样写 —— 后端定义后调整。
  // 详见 src/services/contact.js::fetchContacts。
  CONTACTS_LIST: buildUrl('/jmate/contacts/list'),

  // 坐席目录：供联系人 / 转单选择坐席 / 同事协作使用。
  // 详见 jugglemate-server/docs/seats-list-api.md。
  // GET /jmate/seats/list?keyword=&role=&inbox_id=&status=&page=&pageSize=
  //   resp.data.items: [{ user_id, login_account, nickname, avatar, email,
  //                       role: 'customer_service' | 'admin', status,
  //                       im_token_present, inbox_ids, inbox_count,
  //                       open_session_count, last_active_time, created_time }]
  //   resp.data: { items, total, limit, offset }
  SEATS_LIST: buildUrl('/jmate/seats/list')
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
