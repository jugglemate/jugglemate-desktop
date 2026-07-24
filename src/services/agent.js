// src/services/agent.js
//
// 工单转移 / Agent 信息查询 service。
//
// 设计要点（2026-07-14 v3）：
//   - 工单转移的"可转移目标" = 当前 ticket 关联的 inbox 内全部"代表用户"
//   - 数据源：GET /jmate/tickets/inboxmembers/list?ticket_id=<ticket_id>
//   - ticket_id 不会为空，约定 ticket_id === 会话 id（在 jugglemate-server 侧认定）
//   - 鉴权：复用 src/common/request.js 的 appkey + Authorization 注入
//   - 过滤：user_id === currentUser.id（自己）从源头排除
//   - 分页：
//      * next_start_id === 0（服务器硬约定）即"没有下一页"，停。
//        null / undefined / NaN / 负数 / 非数字 也按"无下一页"处理（用 != 0 拒绝）。
//      * 翻页过程中如果服务器 quirk 性"重推"同一批（user_id 重叠），靠 seen Set 去重保护，
//        UI 看到的人员不会翻倍。
//      * 单页 limit=50；最多 10 页防爆（5000 上限，正常工单 / inbox 一般到不了这个量）。
//   - 响应字段：items[].{ user_id, username, avatar, email }
//
// 历史：
//   v1 — 直接调 juggleim /jim/groups/members/list（用 im_token 鉴权），已废弃
//   v2 — 切到 /jmate/inboxes/members/list?inbox_id=；前端需要 conv.inbox_id 但暂未下发
//   v3 — 换成 /jmate/tickets/inboxmembers/list?ticket_id= ；前端不依赖 inbox_id 字段

import Storage from '../common/storage'
import { STORAGE } from '../common/enum'
import { SERVER_PATH, get, post } from './api'
import { CONFIG } from '../config'

const PAGE_LIMIT = 50
const MAX_PAGES = 10

/**
 * 拉工单关联 inbox 的全部成员，作为工单转移候选目标。
 * ticket_id 是必填，也是后端唯一标识（无 inbox_id 依赖）。
 *
 * @param {string} ticketId - 工单 id（约定等同于会话 id）
 * @returns {Promise<Array<{user_id, nickname, avatar, email}>>}
 *   - 已过滤：当前用户自己
 *   - ticket_id 缺失 / 接口失败：console.warn + 返回 []
 */
export async function fetchTransferCandidates(ticketId) {
  if (!ticketId) {
    console.warn('[agent.fetchTransferCandidates] missing ticketId')
    return []
  }

  const currentUser = Storage.get(STORAGE.USER_TOKEN) || {}
  const currentUserId = currentUser.id

  // 已见 user_id 集合：next_start_id 即使存在也可能拿到一批重复成员，做去重保护。
  const seen = new Set()
  const all = []
  let startId = null   // 首轮不传 start_id：从头开始拉
  let pages = 0

  try {
    while (pages++ < MAX_PAGES) {
      const params = { ticket_id: ticketId, limit: PAGE_LIMIT }
      // 仅在 startId 是"有效的非零正整数"时才追加 start_id，避免把 null/0 当 query 参数传过去
      if (startId !== null && typeof startId === 'number' && startId > 0) {
        params.start_id = startId
      }

      const res = await get(SERVER_PATH.TICKET_INBOX_MEMBERS_LIST, params)

      const items = res?.data?.items || res?.data?.list || []
      if (!Array.isArray(items) || items.length === 0) break

      // 跨页去重：user_id 已入栈的跳过；同一份数据被服务器反复推送不影响最终列表
      for (const it of items) {
        if (it && !seen.has(it.user_id)) {
          seen.add(it.user_id)
          all.push(it)
        }
      }

      // 后端约定：next_start_id === 0 即"无下一页"。== 0 同时也兜住 null/undefined 两种缺省。
      const next = res?.data?.next_start_id
      if (!next || next === 0) break
      startId = next
    }
  } catch (e) {
    console.warn('[agent.fetchTransferCandidates] request failed', { ticketId, err: e })
    return []
  }

  return all
    .filter((m) => currentUserId ? m.user_id !== currentUserId : true)
    .map((m) => ({
      user_id: m.user_id,
      nickname: m.username || m.user_id,  // 接口无 nickname，username 作展示名 fallback
      avatar: m.avatar || '',
      email: m.email || ''
    }))
}

// ============================================================================
// 占位 —— Sprint 1 后端契约 §2.5 预留
// ============================================================================

/** 拉单个 Agent 业绩 */
export async function fetchAgentStats(agentId, { from, to } = {}) {
  // TODO: GET /jmate/agents/:id/stats
  return null
}

// ============================================================================
// Agent 列表 + 流式对话（新接口契约 / 2026-07-20 接入）
// ============================================================================
//
// 新接口区别于旧的 `/jmate/aibots/mybots`：
//   - 旧接口返回 items[] 带 bot_id / unique_name / nickname / display_name /
//     avatar / suggestions[]；前端把 suggestions 当"占位建议"塞到会话列表。
//   - 新接口 `/jmate/agentapi/agents/active` 只返 active Agent，字段名
//     切到 agentId / agentName / ownerAvatar / primaryModel / riskFlag，
//     **不再带 suggestions[]**。建议的来源改为后端实时推（agent_msg_id
//     路径，见 MainView.pendingSuggestions）。前端不再展示"每个 Agent
//     自带 3 条占位建议"的产品形态。
//
// 新 chat 接口 `/jmate/agentapi/chat/stream` 是 SSE（POST）：
//   - 不再走 session 路由；用 conversationId 续接。
//   - 流式响应必须 fetch + ReadableStream，浏览器原生 EventSource 只支持 GET。
//   - 返回 4 种事件：started / token / done / error；末尾 data: [DONE]。


// 鉴权 header 构造：appkey + authorization。
// streamAgentChat 直接走 fetch（绕过 common/request.js），所以这里要自己注入。
// 按接口契约文档（2026-07-20）：
//   - appkey      必填，应用 AppKey
//   - Authorization 必填，控制台登录 token
// 缺失任何一个会被后端拒（401 / AppKey 错误）。
function buildAgentAuthHeaders() {
  const user = Storage.get(STORAGE.USER_TOKEN) || {}
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    AppKey: CONFIG.APP_KEY,
    ...(user.authorization ? { Authorization: user.authorization } : {})
  }
}

/**
 * 拉已激活的 Agent 列表（带分页）。
 *
 * 接口：`GET /jmate/agentapi/agents/active?page=<n>&pageSize=<n>`
 *   - page 默认 1；pageSize 默认 20，取值 1~100
 *   - resp.code === 0 视为成功（HTTP 状态码恒 200，必须看 code）
 *   - 第一页会前置系统兜底 Agent (Juggle_Agent)，仅当其自身 active 才出现，
 *     `total` 相应 +1。前端如需隐藏可按 `ownerId === 'system'` 过滤。
 *
 * @param {Object} [opts]
 * @param {number} [opts.page=1]
 * @param {number} [opts.pageSize=20]
 * @param {boolean} [opts.hideSystemAgent=true]  过滤掉 ownerId === 'system'
 * @returns {Promise<{ items: Array, total: number, page: number, pageSize: number }>}
 *   失败 / 缺鉴权 → 返回空 items，total=0
 */
export async function fetchActiveAgents(opts = {}) {
  const page = Number(opts.page) > 0 ? Number(opts.page) : 1
  const pageSize = Math.max(1, Math.min(100, Number(opts.pageSize) || 20))
  const hideSystem = opts.hideSystemAgent !== false
  // 2026-07-20：传入 session_id（即 ticket_id）时，列表里每项会带 `binded`
  // 标识它是否已绑定该工单。MainView 据此在卡片上回显"已选中"。
  // 不传则每项 binded 恒为 false（不影响总条数）。
  const sessionId = typeof opts.sessionId === 'string' && opts.sessionId
    ? opts.sessionId
    : null

  try {
    const params = { page, pageSize }
    if (sessionId) params.session_id = sessionId
    const res = await get(SERVER_PATH.AGENTS_ACTIVE, params)
    if (res?.code !== 0) {
      console.warn('[agent.fetchActiveAgents] non-zero code', res)
      return { items: [], total: 0, page, pageSize }
    }
    const items = Array.isArray(res?.data?.items) ? res.data.items : []
    const filtered = hideSystem
      ? items.filter((it) => it && it.ownerId !== 'system')
      : items
    return {
      items: filtered,
      total: Number(res?.data?.total) || filtered.length,
      page: Number(res?.data?.page) || page,
      pageSize: Number(res?.data?.pageSize) || pageSize
    }
  } catch (e) {
    console.warn('[agent.fetchActiveAgents] request failed', { page, pageSize, err: e })
    return { items: [], total: 0, page, pageSize }
  }
}

/**
 * 把接口字段映射成前端 Agent 对象（id / name / role / emoji / unique_name /
 * primaryModel / riskFlag / ownerId / ownerName / ownerAvatar）。
 *
 *   - `id` 取自 `agentId` —— 是后续调 chat/stream 的入参
 *   - `name` 取自 `agentName`
 *   - `emoji` 取自 `ownerAvatar`（接口不返 Agent 自身头像，先用归属者头像
 *     占位；后续若加 agentAvatar 字段再切）。缺省用 🤖
 *   - `role` 留空 —— 旧接口用 greeting，新接口没有同名字段
 *   - `suggestions` 留空数组 —— 新接口不返占位建议
 */
export function mapAgent(item) {
  if (!item) return null
  return {
    id: item.agentId || '',
    unique_name: item.agentId || '',  // 兼容 session 创建路径（POST /jmate/aibots/sessions 入参是 unique_name）
    name: item.agentName || item.agentId || '未命名 Agent',
    role: '',
    emoji: item.ownerAvatar || '🤖',
    suggestions: [],
    // 透传字段，留给后续 agent-mode chip / 风险角标 / 模型标识等使用
    primaryModel: item.primaryModel || 'unknown',
    riskFlag: item.riskFlag || 'normal',
    ownerId: item.ownerId || '',
    ownerName: item.ownerName || '',
    ownerAvatar: item.ownerAvatar || '',
    // 系统兜底 Agent（ownerId === 'system'，如 Juggle_Agent）的标记，
    // AgentPanel 据此渲染一个「系统」徽标，让用户能区分系统默认 / 自己建的。
    isSystem: item.ownerId === 'system',
    knowledgeCount: Number(item.knowledgeCount) || 0,
    toolCount: Number(item.toolCount) || 0,
    publishedAt: item.publishedAt || null,
    createdAt: item.createdAt || null,
    // 2026-07-20：`/agents/active?session_id=<ticketId>` 会返回该项是否
    // 已绑定该工单。AgentPanel 据此回显选中态；调用方也可一行代码算出
    // `agents.find(a => a.binded)?.id` 作为当前绑定项。
    binded: !!item.binded
  }
}

/**
 * 流式调用 `/jmate/agentapi/chat/stream`。
 *
 * 使用 fetch + ReadableStream 解析 SSE，逐 token 回调。返回的 Promise 在
 * 收到 [DONE] / 发生网络错误 / 调用方 abort 时 resolve / reject。
 *
 * @param {Object} args
 * @param {string} args.agentId          必填
 * @param {string} args.userId           必填，会话归属 + 长期记忆
 * @param {string} args.message          必填，本轮输入
 * @param {string} [args.conversationId] 可选，续接已有会话
 * @param {boolean} [args.enableHistoryContext]
 * @param {string} [args.traceId]
 * @param {Object} [args.metadata]
 * @param {(ev: {event:string, payload?:object, conversationId?:string}) => void} [args.onEvent]
 *   每个 SSE 事件回调一次（started / token / done / error）。
 * @param {AbortSignal} [args.signal]    用于中途取消
 * @returns {Promise<{ answer: string, traceId: string|null, conversationId: string|null }>}
 */
export async function streamAgentChat(args) {
  const {
    agentId, userId, message,
    conversationId, enableHistoryContext, traceId, metadata,
    onEvent, signal
  } = args || {}

  if (!agentId || !userId || !message) {
    console.warn('[agent.streamAgentChat] missing required fields (agentId/userId/message)')
  }

  const body = {
    agentId, userId, message
  }
  if (conversationId) body.conversationId = conversationId
  if (typeof enableHistoryContext === 'boolean') body.enableHistoryContext = enableHistoryContext
  if (traceId) body.traceId = traceId
  if (metadata && typeof metadata === 'object') body.metadata = metadata
  const response = await fetch(SERVER_PATH.CHAT_STREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json", appkey:'nsw3sue72begyv7y' , Authorization: 'ChBuc3czc3VlNzJiZWd5djd5GiDfZcnWgeX_UgIqMtQ-cGMcPGAwudR1qrD0qDdND7WxPA==' },
    body: JSON.stringify({ agentId, userId, message }),
  })
  if (!response.ok) {
    // 服务端对参数非法会回普通 JSON 信封（HTTP 200），但网络层失败仍可能
    // 走这里。直接抛错由调用方决定如何降级。
    console.warn(`[agent.streamAgentChat] HTTP ${response.status}`)
  }
  if (!response.body) {
    console.warn('[agent.streamAgentChat] response body is empty')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  let firstTraceId = null
  let lastConversationId = null

  const emit = (event) => {
    if (!onEvent) return
    try { onEvent(event) } catch (cbErr) { console.warn('[agent.streamAgentChat] onEvent threw', cbErr) }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE 事件以 "\n\n" 分隔；保留未闭合的最后一段到 buffer
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim()
        if (!line) continue
        if (line === '[DONE]') {
          return { answer, traceId: firstTraceId, conversationId: lastConversationId }
        }
        let event
        try {

          event = JSON.parse(line)
        } catch (parseErr) {
          console.warn('[agent.streamAgentChat] non-JSON event line', { line, err: parseErr })
          continue
        }
        if (!firstTraceId && event.trace_id) firstTraceId = event.trace_id
        if (event.conversation_id) lastConversationId = event.conversation_id
        // token 累加 → answer；done 给出最终完整文，可用于校对
        if (event.event === 'token' && event.payload?.token) {
          answer += event.payload.token
        } else if (event.event === 'done' && event.payload?.answer) {
          answer = event.payload.answer
        }
        emit({
          event: event.event,
          payload: event.payload,
          conversationId: event.conversation_id || lastConversationId,
          traceId: event.trace_id || firstTraceId,
          roundNumber: event.round_number,
          confidenceScore: event.confidence_score
        })
      }
    }
    // 流正常结束但未收到 [DONE]：兜底返回当前拼接结果（不抛错）
    return { answer, traceId: firstTraceId, conversationId: lastConversationId }
  } catch (e) {
    if (e?.name === 'AbortError') {
      // 调用方主动取消：返回当前 answer，err 标 'aborted'
      const err = new Error('[agent.streamAgentChat] aborted')
      err.code = 'aborted'
      throw err
    }
    throw e
  }
}

/**
 * 把工单（sessionId = ticket_id）绑定到指定 Agent。
 *
 * 接口：`POST /jmate/agentapi/agents/sessions/bind`
 *   - 一个工单同时只能绑定一个 Agent，重复调用属于**换绑**（直接覆盖）
 *   - 目标 Agent 必须是 active 且属于当前 AppKey
 *   - 错误码：400_INVALID_REQUEST / 404_TICKET_NOT_FOUND / 404_AGENT_NOT_BINDABLE
 *   - 解绑请走 `unbindAgentFromTicket(sessionId)`
 *
 * @param {string} sessionId  工单 ID（ticket_ 开头）
 * @param {string} agentId    目标 Agent ID
 * @returns {Promise<{sessionId, agentId, binded: true}>}
 */
export async function bindAgentToTicket(sessionId, agentId) {
  if (!sessionId || !agentId) {
    console.warn('[agent.bindAgentToTicket] missing sessionId or agentId')
  }
  const res = await post(SERVER_PATH.AGENT_BIND_SESSION, { sessionId, agentId })
  if (res?.code !== 0) {
    const err = new Error(
      `[agent.bindAgentToTicket] bind failed: ${res?.msg || res?.code || 'unknown'}`
    )
    err.code = res?.code
    throw err
  }
  return res?.data || { sessionId, agentId, binded: true }
}

/**
 * 解除工单与 Agent 的绑定。
 *
 * 接口：`POST /jmate/agentapi/agents/sessions/unbind`
 *   body: { sessionId }
 *   resp.data: { sessionId, agentId: '', binded: false }
 *
 * @param {string} sessionId  工单 ID（ticket_ 开头）
 * @returns {Promise<{sessionId, agentId: string, binded: false}>}
 */
export async function unbindAgentFromTicket(sessionId) {
  if (!sessionId) {
    console.warn('[agent.unbindAgentFromTicket] missing sessionId')
  }
  const res = await post(SERVER_PATH.AGENT_UNBIND_SESSION, { sessionId })
  if (res?.code !== 0) {
    const err = new Error(
      `[agent.unbindAgentFromTicket] unbind failed: ${res?.msg || res?.code || 'unknown'}`
    )
    err.code = res?.code
    throw err
  }
  return res?.data || { sessionId, agentId: '', binded: false }
}
