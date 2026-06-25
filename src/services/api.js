import { getApiBaseUrl } from '../config'
import { request, buildUrl } from '../common/request'

const SERVER_PATH = {
  // User APIs
  USER_REGISTER: buildUrl('/jmate/user/register'),
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
