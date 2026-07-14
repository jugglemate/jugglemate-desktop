import { getApiBaseUrl } from '../config'
import { request, buildUrl } from '../common/request'

const SERVER_PATH = {
  // User APIs
  USER_LOGIN: buildUrl('/jmate/user/login'),

  // Agent APIs
  AGENT_MYBOTS: buildUrl('/jmate/aibots/mybots'),
  // Session & Feedback APIs
  AGENT_SESSION_CREATE: buildUrl('/jmate/aibots/sessions'),
  AGENT_SESSION_LOOKUP: buildUrl('/jmate/aibots/sessions/lookup'),
  AGENT_SESSION_DETAIL: (sessionId) => buildUrl(`/jmate/aibots/sessions/${sessionId}`),
  AGENT_SESSION_UPDATE_AGENT: (sessionId) => buildUrl(`/jmate/aibots/sessions/${sessionId}/agent`),
  AGENT_SESSION_TAKEOVER: (sessionId) => buildUrl(`/jmate/aibots/sessions/${sessionId}/takeover`),
  AGENT_SESSION_CHAT: (sessionId) => buildUrl(`/jmate/aibots/sessions/${sessionId}/chat`),
  AGENT_SESSION_FEEDBACK: (sessionId) => buildUrl(`/jmate/aibots/sessions/${sessionId}/feedback`),

  // Ticket APIs
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
  TICKET_INBOX_MEMBERS_LIST: buildUrl('/jmate/tickets/inboxmembers/list')
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
