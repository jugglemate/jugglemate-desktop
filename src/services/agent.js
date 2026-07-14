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
import { SERVER_PATH, get } from './api'

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
