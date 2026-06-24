import { getApiBaseUrl } from '../config'
import { request, buildUrl } from '../common/request'

function buildPath(path) {
  const protocol = location.protocol === 'file:' ? 'https:' : location.protocol
  return `${protocol}//${getApiBaseUrl()}/jim/${path}`
}

const SERVER_PATH = {
  // User APIs
  USER_REGISTER: buildPath('user/register'),
  USER_LOGIN: buildPath('user/login'),

  // Agent APIs
  AGENT_MYBOTS: buildUrl('/jim/aibots/mybots'),
  // Session & Feedback APIs
  AGENT_SESSION_CREATE: buildUrl('/jim/aibots/sessions'),
  AGENT_SESSION_LOOKUP: buildUrl('/jim/aibots/sessions/lookup'),
  AGENT_SESSION_DETAIL: (sessionId) => buildUrl(`/jim/aibots/sessions/${sessionId}`),
  AGENT_SESSION_UPDATE_AGENT: (sessionId) => buildUrl(`/jim/aibots/sessions/${sessionId}/agent`),
  AGENT_SESSION_TAKEOVER: (sessionId) => buildUrl(`/jim/aibots/sessions/${sessionId}/takeover`),
  AGENT_SESSION_CHAT: (sessionId) => buildUrl(`/jim/aibots/sessions/${sessionId}/chat`),
  AGENT_SESSION_FEEDBACK: (sessionId) => buildUrl(`/jim/aibots/sessions/${sessionId}/feedback`),
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
