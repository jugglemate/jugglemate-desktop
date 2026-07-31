/**
 * Contact service
 * ------------------------------------------------------------------
 * 联系人列表（tree 结构：组 → 成员）。
 *
 * 接口：GET /jmate/seats/list
 *   resp.data.items: [{
 *     user_id, login_account, nickname, avatar, email,
 *     role: 'customer_service' | 'admin', status, im_token_present,
 *     inbox_ids, inbox_count, open_session_count,
 *     last_active_time, created_time
 *   }, ...]
 *
 * 服务端给的是**扁平 list**，前端按 role 字段拆成两组：
 *   - 客服   (role === 'customer_service')
 *   - 管理员 (role === 'admin')
 * 详见 docs/seats-list-api.md。
 *
 * 外部约定：fetchContacts() 返回扁平 array，每项 shape 跟接口一致。
 * UI 端（ContactsView）自己 group。
 */

import { get } from './api'
import { SERVER_PATH } from './api'

/**
 * 拉坐席目录。
 * @param {object} opts
 * @param {string} [opts.keyword] - 服务端做 ILIKE 子串匹配，命中 login_account/nickname/email/user_id 任一
 * @param {number} [opts.page=1]
 * @param {number} [opts.pageSize=100]
 * @returns {Promise<Array>}
 */
export async function fetchContacts({ keyword = '', page = 1, pageSize = 100 } = {}) {
  const params = { page, pageSize }
  if (keyword && keyword.trim()) params.keyword = keyword.trim()
  const res = await get(SERVER_PATH.SEATS_LIST, params)
  if (res?.code !== 0) return []
  return Array.isArray(res.data?.items) ? res.data.items : []
}

export default { fetchContacts }
