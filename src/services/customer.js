// src/services/customer.js
//
// 客户信息查询 service（Sprint 1 范围）：
//   - 客户详情：GET /jmate/customers/info?ticket_id=<ticketId>
//     返回负载中包含 canonical customer_id（后端的客户主键），
//     历史工单接口需要这个 customer_id 而不是 IM 端的 targetId。
//   - 历史工单：GET /jmate/customers/tickets?customer_id=<customerId>
//     customer_id 取自 info 的返回，调用方应先 info 拿到 customer_id
//     再调本接口。
//   - 会话元数据：juggle.getConversation（按 ticket_id 查 IM 会话）
//
// 响应结构详见 docs/sprint-1-revised-backend.md §2.6。

import SERVER_PATH, { get } from './api'
import im from '../common/im'

const PAGE_LIMIT = 50
const MAX_PAGES = 10

/**
 * 内存缓存（v1 — 2026-07-24）：
 *   - key = ticketId（IM 端的 ticket_id）
 *   - value = { promise, data }
 *   - 同一 ticketId 并发请求共享同一 Promise（in-flight 去重）
 *   - 请求成功后 data 存住；下次同 key 直接返回 data，不再发请求
 *   - 提供 invalidate(ticketId) / clear() 用于主动刷新或登出场景
 *
 * 不做 TTL —— 客户信息字段（昵称 / 头像 / customer_id / last_seen_at）
 * 在单次会话生命周期内稳定；如有需要可调 invalidate。
 */
const customerInfoCache = new Map()  // ticketId -> { promise: Promise<data|null>, data: data|null }

export function invalidateCustomerInfo(ticketId) {
  if (!ticketId) return
  customerInfoCache.delete(String(ticketId))
}

export function clearCustomerInfo() {
  customerInfoCache.clear()
}

/**
 * 拉单个客户的详情（基本信息）。
 *
 * 调用的是 `GET /jmate/customers/info?ticket_id=<ticketId>` ——参数
 * 语义是 IM 端的 ticket_id（在 jugglemate 私聊模型里 conversationId ===
 * targetId === ticket_id），不是后端的 customer_id。返回的负载里包含
 * canonical customer_id，作为后续历史工单接口的入参。
 *
 * @param {string} ticketId  IM 端 ticket_id（私聊会话的 conversationId）
 * @returns {Promise<object|null>} 客户详情对象；id 缺失 / 接口失败时返回 null
 */
export async function fetchCustomerDetail(ticketId) {
  if (!ticketId) {
    console.warn('[customer.fetchCustomerDetail] missing ticketId')
    return null
  }
  const key = String(ticketId)
  // 命中已完成缓存：直接返回
  const hit = customerInfoCache.get(key)
  if (hit && hit.data !== undefined) {
    return hit.data
  }
  // in-flight 去重：并发请求共用同一个 Promise
  if (hit && hit.promise) {
    return hit.promise
  }
  // 发起新请求并占位
  const promise = (async () => {
    try {
      const res = await get(SERVER_PATH.CUSTOMER_DETAIL(ticketId))
      if (res?.code !== 0 || !res?.data) return null
      return res.data
    } catch (e) {
      console.warn('[customer.fetchCustomerDetail] request failed', { ticketId, err: e })
      return null
    }
  })()
  customerInfoCache.set(key, { promise, data: undefined })
  const data = await promise
  // 写回 data；请求失败时清掉占位，下次重试可重新发
  if (data === null) {
    customerInfoCache.delete(key)
  } else {
    customerInfoCache.set(key, { promise, data })
  }
  return data
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
