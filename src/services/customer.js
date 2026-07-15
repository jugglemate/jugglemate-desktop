// src/services/customer.js
//
// 客户信息查询 service（Sprint 1 范围）：
//   - 客户详情：GET /jmate/customers/:id
//   - 历史工单：GET /jmate/customers/tickets?customer_id=<id>
//   - 会话元数据：juggle.getConversation（按 ticket_id 查 IM 会话）
//
// 响应结构详见 docs/sprint-1-revised-backend.md §2.6。

import SERVER_PATH, { get } from './api'
import im from '../common/im'

const PAGE_LIMIT = 50
const MAX_PAGES = 10

/**
 * 拉单个客户的详情（基本信息）。
 * @param {string} customerId
 * @returns {Promise<object|null>} 客户详情对象；id 缺失 / 接口失败时返回 null
 */
export async function fetchCustomerDetail(customerId) {
  if (!customerId) {
    console.warn('[customer.fetchCustomerDetail] missing customerId')
    return null
  }
  try {
    const res = await get(SERVER_PATH.CUSTOMER_DETAIL(customerId))
    if (res?.code !== 0 || !res?.data) return null
    return res.data
  } catch (e) {
    console.warn('[customer.fetchCustomerDetail] request failed', { customerId, err: e })
    return null
  }
}

/**
 * 拉客户的历史工单（按 customer_id 过滤）。
 * 自动翻页，去重。失败 / 缺 customerId 时返回 []（已拉到的部分不丢）。
 *
 * @param {string} customerId
 * @returns {Promise<Array>} 工单元组（详见 backend 契约）
 */
export async function fetchCustomerTickets(customerId) {
  if (!customerId) {
    console.warn('[customer.fetchCustomerTickets] missing customerId')
    return []
  }

  const seen = new Set()
  const all = []
  let startId = null
  let pages = 0

  try {
    while (pages++ < MAX_PAGES) {
      const params = { customer_id: customerId, limit: PAGE_LIMIT }
      if (startId !== null && typeof startId === 'number' && startId > 0) {
        params.start_id = startId
      }
      const res = await get(SERVER_PATH.CUSTOMER_TICKETS, params)
      const items = res?.data?.items || []
      if (!Array.isArray(items) || items.length === 0) break

      for (const it of items) {
        if (it && it.ticket_id && !seen.has(it.ticket_id)) {
          seen.add(it.ticket_id)
          all.push(it)
        }
      }

      const next = res?.data?.next_start_id
      if (!next || next === 0) break
      startId = next
    }
  } catch (e) {
    console.warn('[customer.fetchCustomerTickets] request failed', { customerId, err: e })
    return all
  }

  return all
}

/**
 * 根据 ticket_id 拉对应的 IM 会话（用 conversationId = ticket_id，
 * conversationType = PRIVATE，约定见 backend sprint-1 笔记）。
 *
 * 用于历史工单列表项：拿到会话名（conversationTitle）作为第一行展示。
 *
 * @param {string} ticketId
 * @returns {Promise<object|null>} 原始 conversation 对象；拉不到时返回 null
 */
export async function fetchConversationByTicketId(ticketId) {
  if (!ticketId) return null
  const juggle = im.getCurrent()
  if (!juggle?.getConversation) return null
  const { ConversationType } = juggle
  try {
    const res = await juggle.getConversation({
      conversationType: ConversationType.PRIVATE,
      conversationId: ticketId
    })
    return res?.conversation || null
  } catch (e) {
    console.warn('[customer.fetchConversationByTicketId] failed', { ticketId, err: e })
    return null
  }
}

export default {
  fetchCustomerDetail,
  fetchCustomerTickets,
  fetchConversationByTicketId
}
