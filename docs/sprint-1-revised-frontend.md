# Sprint 1 修订版 · 前端实现要点

> **本次修订核心**：
> 1. **状态机精简到 4 态**（去 closed）
> 2. **`PATCH /tickets/:id/status` 通用状态变更接口**（替代原 4 个独立接口）
> 3. **`POST /tickets/:id/transfer` 工单转移接口**（合并原 reassign 动作）
> 4. **3 个 Agent 接口**：`available` / `online` / `:id/stats`
> 5. **新增前端用户信息模块**（与 AgentPanel 同级 Tab 切换）
>
> 配套文档：
> - `sprint-1-revised-backend.md`（本次新出，后端契约）
> - `sprint-1-frontend-impl-points.md`（旧版，本文档替代其 Sprint 1 部分）
> - `customer-support-flow-design.md`（流程图已同步更新）
> - `customer-support-frontend-iteration-plan.md`（任务表已同步更新）
> - `server-gap-analysis.md`（决策点已同步更新）

---

## 0. Sprint 1 范围（修订版）

### 0.1 这一轮做（P0）

| # | 模块 | 用的接口 |
|---|---|---|
| 1 | 4 态状态机精简（去 closed） | `PATCH /tickets/:id/status` |
| 2 | header 状态 chip + 按钮组（按 4 态动态显示） | 同上 |
| 3 | 系统气泡（状态变化、认领、转移、解决、重开） | `jgm:*` IM 消息 |
| 4 | 工单转移弹层（header 转派按钮） | `POST /tickets/:id/transfer` + `GET /agents/available` |
| 5 | Agent 列表页（Nav team tab）+ 个人业绩卡 | `GET /agents/online` + `GET /agents/:id/stats` |
| 6 | **用户信息模块**（与 AgentPanel 同级 Tab 切换） | `GET /customers/:id` + `GET /customers/:id/sessions` |
| 7 | 4 个 service：ticket / csat / customer / agent | 同上 |
| 8 | 2 个 store：ticket / customer | 同上 |
| 9 | mock 数据：tickets / customers / agents（mock agents 已有） | — |

### 0.2 这一轮不做（留 hook，文档化）

- 优先级 / 颜色条
- 标签 UI（Sprint 3）
- 备注 Tab / 转派备注气泡已实现
- CSAT 完整流程（仅留字段，Sprint 5）
- 真实 IM 广播（mock 阶段全部走本地状态机）
- 渠道配置表（Sprint 2）
- 自动分配兜底（Sprint 2）
- 群成员动态管理（Sprint 2/3）

---

## 1. 全局枚举（写入 `src/common/enum.js`）

### 1.1 工单状态（精简到 4 态）

```js
export const TICKET_STATUS = {
  PENDING:    'pending',     // 待分配（0）：刚入池，无人认领
  PROCESSING: 'processing',  // 处理中（1）：已认领，坐席在处理
  RESOLVED:   'resolved',    // 已解决（2）：客服点解决
  REOPENED:   'reopened'     // 重新打开（3）：客户追问后回到待分配
}
// 注：closed 状态字段在 DB 层保留作为隐藏终态（用于 30 天后清理），
// 前端 enum 和 UI 完全不展示、不参与状态机校验。
// 后端 status 整数值：pending=0 / processing=1 / resolved=2 / reopened=3 / closed=99

export const TICKET_STATUS_META = {
  pending:    { label: '待分配',   color: '#FF8800', order: 0, icon: '...' },
  processing: { label: '处理中',   color: '#1E88FF', order: 1, icon: '...' },
  resolved:   { label: '已解决',   color: '#07C160', order: 2, icon: '...' },
  reopened:   { label: '重新打开', color: '#7C4DFF', order: 3, icon: '...' }
}
```

### 1.2 工单动作（精简到 3 个）

```js
export const TICKET_ACTION = {
  CLAIM:    'claim',     // pending | reopened → processing
  SET_STATUS: 'set_status', // 任意 → 任意合法转换（统一通过 PATCH /status）
  TRANSFER: 'transfer'   // processing | pending | reopened → processing（assignee 变）
}

// 动作 → 合法前置状态（仅前端粗校验，后端是权威）
export const TICKET_ACTION_VALID_FROM = {
  claim:    ['pending', 'reopened'],
  set_status: {
    processing: ['pending', 'reopened'],         // 认领后的目标态
    resolved:   ['processing', 'reopened'],       // 解决
    reopened:   ['resolved']                       // 重开
  },
  transfer: ['pending', 'processing', 'reopened']
}
```

### 1.3 系统气泡类型（扩充 transfer）

```js
export const SYSTEM_BUBBLE_TYPE = {
  CLAIM:           'claim',
  TRANSFER:        'transfer',     // 新增
  RESOLVE:         'resolve',
  REOPEN:          'reopen',
  AUTO_ASSIGN:     'auto_assign',
  CSAT_SENT:       'csat_sent',
  CSAT_RESPONSE:   'csat_response'
  // 注：closed 不参与系统气泡（前端不展示）
}
```

---

## 2. 数据模型

### 2.1 mock 数据：`src/mock/tickets.js`

```js
// mock 数据集中地。10 条工单，覆盖：
//   - 4 个状态各 ≥ 2 条（closed 不入库）
//   - 3 个平台（web / telegram / jugglechat）
//   - 多个 assignee（自己 + 同事 + 1 条未分配）
//   - 部分工单 pending_start_at 超过 5/15 分钟（用于触发超时提示 mock）
//
// 接真接口时把这个文件删掉，把 ticket service 里的 setTimeout 改成真 HTTP 调用。

export const TICKETS = [
  {
    ticket_id: 'tk_001',
    conversation_key: '1_42',
    status: 'pending',
    assignee_id: null,
    assignee_name: null,
    pending_start_at: Date.now() - 6 * 60 * 1000,  // 6 分钟前
    created_at: Date.now() - 6 * 60 * 1000,
    updated_at: Date.now() - 6 * 60 * 1000,
    platform: 'telegram',
    last_message_preview: '请问订单什么时候发货？',
    customer_id: 'cust_001',          // 新增：关联客户
    customer_name: '张三',
    customer_avatar: 'https://...',
    reopen_count: 0,
    csat_status: 'none',
    version: 0
  },
  {
    ticket_id: 'tk_002',
    conversation_key: '1_55',
    status: 'processing',
    assignee_id: '__SELF__',
    assignee_name: '我',
    pending_start_at: null,
    created_at: Date.now() - 25 * 60 * 1000,
    updated_at: Date.now() - 1 * 60 * 1000,
    platform: 'web',
    last_message_preview: '我已经退款了，请查收',
    customer_id: 'cust_002',
    customer_name: '李四',
    customer_avatar: '',
    reopen_count: 0,
    csat_status: 'none',
    version: 1
  },
  {
    ticket_id: 'tk_003',
    conversation_key: '1_78',
    status: 'resolved',
    assignee_id: '__SELF__',
    assignee_name: '我',
    resolved_at: Date.now() - 30 * 60 * 1000,
    created_at: Date.now() - 2 * 60 * 60 * 1000,
    updated_at: Date.now() - 30 * 60 * 1000,
    platform: 'jugglechat',
    last_message_preview: '感谢您的帮助！',
    customer_id: 'cust_003',
    customer_name: '王五',
    customer_avatar: '',
    reopen_count: 0,
    csat_status: 'pending',
    csat_expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
    version: 2
  },
  {
    ticket_id: 'tk_004',
    conversation_key: '2_88',
    status: 'reopened',
    assignee_id: null,                 // 重开后释放 assignee
    assignee_name: null,
    pending_start_at: Date.now() - 2 * 60 * 1000,
    created_at: Date.now() - 3 * 60 * 60 * 1000,
    updated_at: Date.now() - 2 * 60 * 1000,
    platform: 'telegram',
    last_message_preview: '请问还有其他方案吗？',
    customer_id: 'cust_001',           // 同一客户多个工单
    customer_name: '张三',
    customer_avatar: '',
    reopen_count: 1,
    csat_status: 'none',
    version: 3
  }
  // ... 再造 6 条覆盖 pending 超时（15min）/ 跨坐席 / 待处理 / 多平台 等场景
]
```

### 2.2 mock 数据：`src/mock/customers.js`（新增）

```js
export const CUSTOMERS = {
  'cust_001': {
    customer_id: 'cust_001',
    nickname: '张三',
    avatar: 'https://i.pravatar.cc/150?u=cust_001',
    phone: '',
    email: '',
    identifier: 'tg_12345',
    channels: ['telegram', 'web'],
    first_seen_at: 1730000000000,
    last_seen_at: Date.now(),
    total_sessions: 12,
    csat_avg: 4.6,
    history_sessions: [
      { ticket_id: 'tk_001', status: 'pending',   created_at: 1730000000, platform: 'telegram' },
      { ticket_id: 'tk_004', status: 'reopened',  created_at: 1730080000, platform: 'telegram' },
      { ticket_id: 'tk_005', status: 'resolved',  created_at: 1730500000, platform: 'web' }
    ]
  },
  'cust_002': {
    customer_id: 'cust_002',
    nickname: '李四',
    avatar: 'https://i.pravatar.cc/150?u=cust_002',
    channels: ['web'],
    first_seen_at: 1730300000000,
    last_seen_at: Date.now() - 60 * 60 * 1000,
    total_sessions: 3,
    csat_avg: 5.0,
    history_sessions: [
      { ticket_id: 'tk_002', status: 'processing', created_at: 1730900000, platform: 'web' }
    ]
  },
  'cust_003': {
    customer_id: 'cust_003',
    nickname: '王五',
    avatar: 'https://i.pravatar.cc/150?u=cust_003',
    channels: ['jugglechat'],
    first_seen_at: 1730000000000,
    last_seen_at: Date.now() - 2 * 60 * 60 * 1000,
    total_sessions: 5,
    csat_avg: 3.8,
    history_sessions: [
      { ticket_id: 'tk_003', status: 'resolved', created_at: 1730800000, platform: 'jugglechat' }
    ]
  }
}
```

---

## 3. 新增文件清单

| 路径 | 类型 | 说明 |
|---|---|---|
| `src/mock/tickets.js` | mock 数据 | 见 §2.1 |
| `src/mock/customers.js` | mock 数据 | 见 §2.2（新增） |
| `src/stores/ticket.js` | store | 单例 reactive Map<ticket_id, Ticket> |
| `src/stores/customer.js` | store | 单例 reactive Map<customer_id, Customer>（新增） |
| `src/services/ticket.js` | service | 状态机核心（CLAIM / SET_STATUS / TRANSFER 3 个动作） |
| `src/services/customer.js` | service | 客户信息查询（新增） |
| `src/services/agent.js` | service | Agent 列表 / 业绩查询（新增） |
| `src/components/StatusChip.vue` | 组件 | 复用：渲染状态文字+色 |
| `src/components/ConfirmDialog.vue` | 组件 | 通用二次确认 |
| `src/components/TransferDialog.vue` | 组件 | 工单转移弹层（新增） |
| `src/components/UserPanel.vue` | 组件 | 用户信息主壳 + Tab 切换（新增） |
| `src/components/UserInfoCard.vue` | 组件 | 客户信息卡（新增） |
| `src/components/UserSessionHistory.vue` | 组件 | 历史会话列表（新增） |
| `src/components/AgentStatsCard.vue` | 组件 | Agent 业绩卡（新增，Nav team tab 用） |
| `src/components/dev/MockTriggerBar.vue` | dev 组件 | 顶部调试条 |

---

## 4. `src/stores/ticket.js` 设计（精简版）

```js
// src/stores/ticket.js
import { reactive } from 'vue'
import { TICKETS } from '../mock/tickets'
import { TICKET_STATUS } from '../common/enum'

class TicketStore {
  constructor() {
    this.byId = reactive(new Map())
    this.byConvKey = reactive(new Map())
    this.byCustomerId = reactive(new Map())  // 新增：按客户索引
    this.initialized = false
  }

  init() {
    if (this.initialized) return
    for (const t of TICKETS) {
      this.byId.set(t.ticket_id, { ...t })
      this.byConvKey.set(t.conversation_key, t.ticket_id)
      if (t.customer_id) {
        if (!this.byCustomerId.has(t.customer_id)) {
          this.byCustomerId.set(t.customer_id, new Set())
        }
        this.byCustomerId.get(t.customer_id).add(t.ticket_id)
      }
    }
    this.initialized = true
  }

  get(ticket_id) { return this.byId.get(ticket_id) || null }
  getByConvKey(convKey) {
    const id = this.byConvKey.get(convKey)
    return id ? this.byId.get(id) : null
  }
  /** 新增：按客户查所有工单（用于 UserSessionHistory） */
  listByCustomer(customerId) {
    const ids = this.byCustomerId.get(customerId)
    if (!ids) return []
    return Array.from(ids).map(id => this.byId.get(id)).filter(Boolean)
  }
  list() { return Array.from(this.byId.values()) }
  listByStatus(status) { return this.list().filter(t => t.status === status) }
  listByAssignee(assignee_id) {
    return this.list().filter(t => t.assignee_id === assignee_id)
  }

  upsert(ticket) {
    const next = { ...this.byId.get(ticket.ticket_id), ...ticket }
    this.byId.set(ticket.ticket_id, next)
    if (next.conversation_key) {
      this.byConvKey.set(next.conversation_key, ticket.ticket_id)
    }
    if (next.customer_id && !this.byCustomerId.has(next.customer_id)) {
      this.byCustomerId.set(next.customer_id, new Set())
    }
    if (next.customer_id) {
      this.byCustomerId.get(next.customer_id).add(ticket.ticket_id)
    }
    return next
  }

  stats() {
    return {
      pending:    this.listByStatus('pending').length,
      processing: this.listByStatus('processing').length,
      resolved:   this.listByStatus('resolved').length,
      reopened:   this.listByStatus('reopened').length
      // closed 不统计（前端不展示）
    }
  }
}

export const ticketStore = new TicketStore()
export default ticketStore
```

## 5. `src/stores/customer.js` 设计（新增）

```js
// src/stores/customer.js
import { reactive } from 'vue'
import { CUSTOMERS } from '../mock/customers'

class CustomerStore {
  constructor() {
    this.byId = reactive(new Map())
    this.initialized = false
  }

  init() {
    if (this.initialized) return
    for (const c of Object.values(CUSTOMERS)) {
      this.byId.set(c.customer_id, { ...c })
    }
    this.initialized = true
  }

  get(customer_id) { return this.byId.get(customer_id) || null }

  upsert(customer) {
    const next = { ...this.byId.get(customer.customer_id), ...customer }
    this.byId.set(customer.customer_id, next)
    return next
  }

  list() { return Array.from(this.byId.values()) }
}

export const customerStore = new CustomerStore()
export default customerStore
```

---

## 6. `src/services/ticket.js` 设计（精简到 3 个动作）

> 所有状态变更的入口，**所有方法都有相同的副作用链路**：
>
> 1. 校验前置状态（throw 非法转换）
> 2. await 接口（mock 阶段 setTimeout；接后端时改 HTTP）
> 3. 改 store（upsert）
> 4. 推系统气泡（emit 事件或调 emitBubble）
> 5. 触发视图相关副作用（tag 镜像 / 列表过滤）

```js
// src/services/ticket.js
import { ticketStore } from '../stores/ticket'
import { customerStore } from '../stores/customer'
import { SERVER_PATH, post, patch, get } from './api'
import { TICKET_STATUS, TICKET_ACTION, SYSTEM_BUBBLE_TYPE } from '../common/enum'
import im from '../common/im'
import emitter from '../common/emitter'
import toast from '../common/toast'

// ============ 错误类 ============
export class TicketStateError extends Error {
  constructor(action, fromStatus) {
    super(`非法状态转换: ${action} from ${fromStatus}`)
    this.code = 'TICKET_STATE_ERROR'
  }
}

// ============ 内部工具 ============
function checkTransition(action, ticket) {
  const validFrom = TICKET_ACTION_VALID_FROM[action]
  if (!validFrom.includes(ticket.status)) {
    throw new TicketStateError(action, ticket.status)
  }
}
function emitSystemBubble(conversationKey, type, payload) {
  emitter.emit('system-bubble', { conversationKey, type, payload, at: Date.now() })
}
const MOCK_MODE = true
function delay(data) {
  return new Promise(resolve => setTimeout(() => resolve(data), 50))
}

// ============ CLAIM ============
export async function claim(ticket_id) {
  const t = ticketStore.get(ticket_id)
  if (!t) throw new Error('ticket not found')
  checkTransition('claim', t)

  // TODO(接入): 走真接口时改回 ↓
  // const res = await post(SERVER_PATH.TICKET_CLAIM(ticket_id), { expected_version: t.version })
  if (MOCK_MODE) await delay({ code: 0 })

  ticketStore.upsert({
    ticket_id, status: 'processing', assignee_id: '__SELF__', assignee_name: '我',
    pending_start_at: null, updated_at: Date.now(), version: t.version + 1
  })

  const conv = im.getConversationByKey(t.conversation_key)
  if (conv) {
    void im.addConversationToAssignedTag(conv)
    void im.addConversationToMyTicketTag(conv)
  }
  emitSystemBubble(t.conversation_key, SYSTEM_BUBBLE_TYPE.CLAIM, { operator: '我' })
  return ticketStore.get(ticket_id)
}

// ============ SET_STATUS（通用状态变更，替代 resolve / reopen / close / release）============
export async function setStatus(ticket_id, toStatus, { reason = '', by = 'agent' } = {}) {
  const t = ticketStore.get(ticket_id)
  if (!t) throw new Error('ticket not found')

  // 校验目标态合法
  const validTargets = TICKET_ACTION_VALID_FROM.set_status[toStatus]
  if (!validTargets || !validTargets.includes(t.status)) {
    throw new TicketStateError(`set_status→${toStatus}`, t.status)
  }

  // 目标态：处理中 = 重新认领（assignee 可能变）
  // 目标态：已解决 = 释放 my_ticket tag
  // 目标态：重新打开 = 释放 assignee（回到 pending）
  const isClaim = toStatus === 'processing'
  const isResolve = toStatus === 'resolved'
  const isReopen = toStatus === 'reopened'

  // TODO(接入): PATCH /jmate/tickets/:id/status
  if (MOCK_MODE) await delay({ code: 0 })

  const upsertData = {
    ticket_id, status: toStatus, updated_at: Date.now(), version: t.version + 1
  }
  if (isClaim) {
    upsertData.assignee_id = '__SELF__'
    upsertData.assignee_name = '我'
    upsertData.pending_start_at = null
  }
  if (isResolve) {
    upsertData.resolved_at = Date.now()
    upsertData.csat_status = 'pending'  // 默认发 CSAT，Sprint 5 可改为可选
    upsertData.csat_expires_at = Date.now() + 7 * 24 * 60 * 60 * 1000
  }
  if (isReopen) {
    upsertData.reopen_count = (t.reopen_count || 0) + 1
    upsertData.assignee_id = null
    upsertData.assignee_name = null
    upsertData.pending_start_at = Date.now()
  }

  ticketStore.upsert(upsertData)

  // tag 副作用
  const conv = im.getConversationByKey(t.conversation_key)
  if (conv) {
    if (isClaim) {
      void im.addConversationToAssignedTag(conv)
      void im.addConversationToMyTicketTag(conv)
    } else if (isResolve) {
      void im.removeConversationFromAssignedTag(conv)
      void im.removeConversationFromMyTicketTag(conv)
    } else if (isReopen) {
      // reopened: 释放 my_ticket，保留 assigned（如有）
      void im.removeConversationFromMyTicketTag(conv)
    }
  }

  // 系统气泡
  const bubbleType = isResolve ? SYSTEM_BUBBLE_TYPE.RESOLVE
                   : isReopen ? SYSTEM_BUBBLE_TYPE.REOPEN
                   : null
  if (bubbleType) {
    emitSystemBubble(t.conversation_key, bubbleType, { by, reason })
  }

  return ticketStore.get(ticket_id)
}

// ============ TRANSFER（合并原 reassign 动作）============
export async function transfer(ticket_id, toAssigneeId, toAssigneeName, { note = '' } = {}) {
  const t = ticketStore.get(ticket_id)
  if (!t) throw new Error('ticket not found')
  checkTransition('transfer', t)

  if (toAssigneeId === t.assignee_id) {
    throw new Error('不能转移给当前 assignee')
  }

  // TODO(接入): POST /jmate/tickets/:id/transfer
  if (MOCK_MODE) await delay({ code: 0 })

  const oldAssigneeId = t.assignee_id
  const oldAssigneeName = t.assignee_name

  ticketStore.upsert({
    ticket_id,
    assignee_id: toAssigneeId,
    assignee_name: toAssigneeName,
    pending_start_at: null,
    updated_at: Date.now(),
    version: t.version + 1
    // status 保持 processing（transfer 是同状态换人）
  })

  // tag 副作用
  const conv = im.getConversationByKey(t.conversation_key)
  if (conv) {
    // 释放旧 my_ticket（如果旧是 __SELF__），加新 my_ticket（如果是 __SELF__）
    void im.removeConversationFromMyTicketTag(conv)
    if (toAssigneeId === '__SELF__') {
      void im.addConversationToMyTicketTag(conv)
    }
    // assigned tag 保留（工单仍属团队）
  }

  emitSystemBubble(t.conversation_key, SYSTEM_BUBBLE_TYPE.TRANSFER, {
    from: oldAssigneeName,
    to: toAssigneeName,
    note
  })

  return ticketStore.get(ticket_id)
}
```

## 7. `src/services/customer.js` 设计（新增）

```js
// src/services/customer.js
import { customerStore } from '../stores/customer'
import { SERVER_PATH, get } from './api'
import { ticketStore } from '../stores/ticket'

const MOCK_MODE = true
function delay(data) {
  return new Promise(resolve => setTimeout(() => resolve(data), 50))
}

export async function fetchCustomer(customerId) {
  if (!customerId) return null

  // 优先用本地缓存
  const cached = customerStore.get(customerId)
  if (cached) return cached

  // TODO(接入): 走真接口时改回 ↓
  // const res = await get(SERVER_PATH.CUSTOMER_DETAIL(customerId))
  if (MOCK_MODE) {
    const local = customerStore.get(customerId)
    if (local) {
      customerStore.upsert(local)
      return local
    }
    await delay({ code: 0, data: null })
    return null
  }
}

export async function fetchCustomerSessions(customerId) {
  // 优先从 ticket store 拿（已有完整数据）
  const tickets = ticketStore.listByCustomer(customerId)

  // TODO(接入): 也可以走 /jmate/customers/:id/sessions 接口
  return tickets.map(t => ({
    ticket_id: t.ticket_id,
    status: t.status,
    created_at: t.created_at,
    updated_at: t.updated_at,
    platform: t.platform,
    last_message_preview: t.last_message_preview
  }))
}
```

## 8. `src/services/agent.js` 设计（新增）

```js
// src/services/agent.js
import { SERVER_PATH, get } from './api'

const MOCK_MODE = true
function delay(data) {
  return new Promise(resolve => setTimeout(() => resolve(data), 50))
}

const MOCK_AGENTS = [
  { agent_id: 'u_007', name: '小红', avatar: '...', is_online: true, current_tickets: 5, max_concurrent: 10, role: '客服' },
  { agent_id: 'u_008', name: '坐席B', avatar: '...', is_online: true, current_tickets: 3, max_concurrent: 10, role: '客服' },
  { agent_id: 'u_009', name: '坐席C', avatar: '...', is_online: false, current_tickets: 0, max_concurrent: 10, role: '客服' },
  { agent_id: 'u_010', name: '坐席D', avatar: '...', is_online: true, current_tickets: 7, max_concurrent: 10, role: '客服' }
]

/** 拉可转移目标列表 */
export async function fetchAvailableAgents({ excludeSelf = true, onlineOnly = true } = {}) {
  // TODO(接入): GET /jmate/agents/available?exclude_self=true&online_only=true
  if (MOCK_MODE) {
    await delay({ code: 0 })
    let list = MOCK_AGENTS
    if (onlineOnly) list = list.filter(a => a.is_online)
    if (excludeSelf) list = list.filter(a => a.agent_id !== '__SELF__')
    return list
  }
}

/** 拉在线 Agent 列表 */
export async function fetchOnlineAgents() {
  // TODO(接入): GET /jmate/agents/online
  if (MOCK_MODE) {
    await delay({ code: 0 })
    return MOCK_AGENTS.filter(a => a.is_online)
  }
}

/** 拉单个 Agent 业绩 */
export async function fetchAgentStats(agentId, { from, to } = {}) {
  // TODO(接入): GET /jmate/agents/:id/stats?from=&to=
  if (MOCK_MODE) {
    await delay({ code: 0, data: {
      agent_id: agentId,
      today: { tickets: 12, resolved: 10, csat_avg: 4.5 },
      week:  { tickets: 80, resolved: 72, csat_avg: 4.6 },
      month: { tickets: 320, resolved: 290, csat_avg: 4.5 },
      active_sessions: 5
    }})
  }
}
```

---

## 9. 组件改动清单

### 9.1 ChatMain.vue

#### header 状态 chip（4 态，去 closed）

**位置**：`src/components/ChatMain.vue` 模板 `<div class="tyn-chat-header__meta">` 子级

```vue
<StatusChip
  v-if="currentTicket"
  :status="currentTicket.status"
  :show-dot="true"
/>
```

#### header 按钮组（按 4 态动态渲染）

```js
const actionButtons = computed(() => {
  const t = currentTicket.value
  if (!t) return []
  const buttons = []
  const role = currentUserRole.value  // 1 = 客服, 2 = 管理员
  const isSelf = t.assignee_id === '__SELF__' || t.assignee_id === currentUserId.value

  switch (t.status) {
    case 'pending':
      buttons.push({ key: 'claim',    label: '认领', primary: true, action: () => onClaim(t.ticket_id) })
      buttons.push({ key: 'transfer', label: '转移', action: () => onTransfer(t.ticket_id) })
      break
    case 'processing':
      if (isSelf) {
        buttons.push({ key: 'resolve', label: '解决', primary: true, action: () => onResolve(t.ticket_id) })
      }
      buttons.push({ key: 'transfer', label: '转移', action: () => onTransfer(t.ticket_id) })
      break
    case 'resolved':
      if (isSelf) {
        buttons.push({ key: 'reopen', label: '重新打开', primary: true, action: () => onReopen(t.ticket_id) })
      }
      break
    case 'reopened':
      buttons.push({ key: 'claim',    label: '认领', primary: true, action: () => onClaim(t.ticket_id) })
      buttons.push({ key: 'transfer', label: '转移', action: () => onTransfer(t.ticket_id) })
      break
    // closed 不在前端 UI 出现
  }
  return buttons
})
```

#### 系统气泡订阅（精简，去 closed）

```js
function buildSystemBubble(type, payload) {
  const text = {
    [SYSTEM_BUBBLE_TYPE.CLAIM]:         `${payload.operator} 认领了工单`,
    [SYSTEM_BUBBLE_TYPE.TRANSFER]:      `${payload.from} 转给 ${payload.to}${payload.note ? `：${payload.note}` : ''}`,
    [SYSTEM_BUBBLE_TYPE.RESOLVE]:       `${payload.operator} 标记为已解决`,
    [SYSTEM_BUBBLE_TYPE.REOPEN]:        `工单重新打开（${payload.by === 'customer' ? '客户追问' : '客服手动'}）`,
    [SYSTEM_BUBBLE_TYPE.AUTO_ASSIGN]:   `系统自动分配给 ${payload.assignee}（规则：${payload.rule}）`,
    [SYSTEM_BUBBLE_TYPE.CSAT_SENT]:     `已向客户发送满意度评价卡`,
    [SYSTEM_BUBBLE_TYPE.CSAT_RESPONSE]: `客户已评价：${'⭐'.repeat(payload.score)}（${payload.score} 星）`
  }[type] || ''
  // ...
}
```

### 9.2 ConversationMenu.vue

**新增**：右键菜单"转移"项（任何 assigned 状态显示）。

**事件 emit**：`conversation-op` 新增 type：`transfer`。

### 9.3 MessageTimeline.vue

渲染 system bubble，**只支持 7 种类型**（去 closed）。

### 9.4 Conversations.vue（列表联动）

**改动**：
1. 状态色条：4 态对应 4 色（去 closed）
2. `filterCounts` 重新计算（4 态）
3. `ticketStore` 变化 → 触发 filterCounts 重算（用 watch）

```js
import { ticketStore } from '../stores/ticket'

const ticketVersion = ref(0)
watch(
  () => Array.from(ticketStore.byId.values())
    .map(t => `${t.ticket_id}:${t.status}:${t.assignee_id}:${t.customer_id}`)
    .join('|'),
  () => { ticketVersion.value++ }
)
```

### 9.5 MainView.vue

**改动**：
1. `<script>` 顶部加 `import { ticketStore }` `import { customerStore }`
2. `onMounted` 里 `ticketStore.init()` + `customerStore.init()`
3. 接收 ChatMain 的 `ticket-action` 事件 → 转发到对应 service
4. 挂载 `MockTriggerBar`
5. **新增**：`rightPanelTab` ref（`'agent'` | `'user'`），传给 AgentPanel 改造成 `UserPanel`

```js
const rightPanelTab = ref('agent')  // 默认显示 agent 列表

function handleNavChange(nav) {
  activeNav.value = nav
  // Nav `team` 切换到 Agent 列表页
  if (nav === 'team') {
    // 新视图：AgentStatsCard 列表
  }
}
```

### 9.6 AgentPanel.vue → 改造为 UserPanel.vue（同级 Tab 切换）

**当前**：`AgentPanel.vue` 只有 agent 列表 tab。

**改成**：
- 新建 `UserPanel.vue`，包含两个 Tab：**Agent 列表** | **用户信息**
- 当前会话有 customer_id 时显示"用户信息" Tab，否则只显示 Agent
- 复用现有 `AgentPanel.vue` 的 agent 列表逻辑

```vue
<!-- UserPanel.vue 主壳 -->
<template>
  <aside class="customer-side">
    <div class="side-tabs">
      <div v-for="t in tabs" :key="t.key"
           class="side-tab" :class="{ active: activeTab === t.key }"
           @click="activeTab = t.key">
        {{ t.label }}
      </div>
    </div>
    <div v-if="activeTab === 'agents'" class="tab-pane">
      <AgentList :agents="agents" :customer="customer"
                 @select-agent="..." @host-agent="..." />
    </div>
    <div v-else-if="activeTab === 'user'" class="tab-pane">
      <UserInfoCard :customer="customer" />
      <UserSessionHistory :customer-id="customer?.customer_id" />
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { customerStore } from '../stores/customer'
import { fetchCustomer } from '../services/customer'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  selectedAgentId: { type: [String, Number], default: null },
  mode: { type: String, default: 'off' },
  hostedAgentId: { type: [String, Number], default: null },
  customerId: { type: String, default: null }  // 新增 prop
})

const activeTab = ref('agents')
const tabs = computed(() => {
  const arr = [{ key: 'agents', label: 'agent 列表' }]
  if (props.customerId) arr.push({ key: 'user', label: '用户信息' })
  return arr
})

// 当切到 user tab 时拉客户详情（懒加载）
watch(activeTab, async (newTab) => {
  if (newTab === 'user' && props.customerId) {
    await fetchCustomer(props.customerId)
  }
})
</script>
```

### 9.7 UserInfoCard.vue（新增）

```vue
<template>
  <div v-if="customer" class="user-info-card">
    <div class="user-info-card__header">
      <Avatar :src="customer.avatar" :name="customer.nickname" size="lg" />
      <div>
        <div class="user-info-card__name">{{ customer.nickname }}</div>
        <div class="user-info-card__id">ID: {{ customer.customer_id }}</div>
      </div>
    </div>
    <div class="user-info-card__row">
      <label>渠道</label>
      <span>{{ customer.channels?.join(' / ') }}</span>
    </div>
    <div class="user-info-card__row">
      <label>首次接入</label>
      <span>{{ formatDate(customer.first_seen_at) }}</span>
    </div>
    <div class="user-info-card__row">
      <label>累计会话</label>
      <span>{{ customer.total_sessions }} 次</span>
    </div>
    <div class="user-info-card__row">
      <label>平均 CSAT</label>
      <span>{{ customer.csat_avg }} ⭐</span>
    </div>
  </div>
</template>
```

### 9.8 UserSessionHistory.vue（新增）

```vue
<template>
  <div class="user-session-history">
    <h4>历史会话（{{ sessions.length }}）</h4>
    <div v-for="s in sessions" :key="s.ticket_id" class="user-session-history__item"
         @click="onClickSession(s)">
      <div class="user-session-history__row">
        <span class="user-session-history__id">#{{ s.ticket_id }}</span>
        <StatusChip :status="s.status" size="sm" />
      </div>
      <div class="user-session-history__preview">{{ s.last_message_preview }}</div>
      <div class="user-session-history__meta">
        {{ s.platform }} · {{ formatDate(s.created_at) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import { ticketStore } from '../stores/ticket'
import { fetchCustomerSessions } from '../services/customer'

const props = defineProps({ customerId: String })

const sessions = computed(() => {
  if (!props.customerId) return []
  return ticketStore.listByCustomer(props.customerId)
    .sort((a, b) => b.created_at - a.created_at)
})

function onClickSession(s) {
  // 切换到该会话（调用 MainView 的 handleSelectConversation）
  emit('select-session', s.ticket_id)
}
</script>
```

### 9.9 TransferDialog.vue（新增）

```vue
<template>
  <Modal :show="show" title="转移工单" @close="$emit('cancel')">
    <div class="transfer-dialog">
      <input v-model="keyword" placeholder="搜索坐席..." class="transfer-dialog__search" />
      <div class="transfer-dialog__list">
        <div v-for="a in filtered" :key="a.agent_id"
             class="transfer-dialog__item"
             :class="{ selected: selected?.agent_id === a.agent_id }"
             @click="selected = a">
          <Avatar :src="a.avatar" :name="a.name" />
          <div class="transfer-dialog__item-info">
            <div>{{ a.name }}</div>
            <div class="transfer-dialog__item-meta">
              <span :class="['status-dot', a.is_online ? 'online' : 'offline']"></span>
              {{ a.is_online ? '在线' : '离线' }}
              · 当前 {{ a.current_tickets }} 单
            </div>
          </div>
        </div>
      </div>
      <textarea v-model="note" placeholder="备注（可选）"
                class="transfer-dialog__note" rows="2" />
      <div class="transfer-dialog__actions">
        <Button @click="$emit('cancel')">取消</Button>
        <Button type="primary" :disabled="!selected" @click="onConfirm">确认转移</Button>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { ref, computed } from 'vue'
import { fetchAvailableAgents } from '../services/agent'

const props = defineProps({
  show: Boolean,
  sourceTicketId: String,
  currentAssigneeId: String  // 排除自己
})

const emit = defineEmits(['confirm', 'cancel'])

const keyword = ref('')
const selected = ref(null)
const note = ref('')
const agents = ref([])

// 弹窗打开时拉列表
import { watch } from 'vue'
watch(() => props.show, async (v) => {
  if (v) {
    agents.value = await fetchAvailableAgents({ excludeSelf: true, onlineOnly: true })
  }
})

const filtered = computed(() => {
  if (!keyword.value) return agents.value
  return agents.value.filter(a => a.name.includes(keyword.value))
})

function onConfirm() {
  if (!selected.value) return
  emit('confirm', {
    to_assignee_id: selected.value.agent_id,
    to_assignee_name: selected.value.name,
    note: note.value
  })
}
</script>
```

### 9.10 AgentStatsCard.vue（新增，Nav team tab 用）

```vue
<template>
  <div class="agent-stats-card">
    <div class="agent-stats-card__header">
      <Avatar :src="agent.avatar" :name="agent.name" size="md" />
      <div>
        <div>{{ agent.name }}</div>
        <span :class="['status-dot', agent.is_online ? 'online' : 'offline']"></span>
        {{ agent.is_online ? '在线' : '离线' }}
      </div>
    </div>
    <div v-if="stats" class="agent-stats-card__metrics">
      <div class="metric">
        <div class="metric__label">今日</div>
        <div class="metric__value">{{ stats.today.tickets }} 单</div>
        <div class="metric__sub">已解决 {{ stats.today.resolved }} · CSAT {{ stats.today.csat_avg }}⭐</div>
      </div>
      <div class="metric">
        <div class="metric__label">本周</div>
        <div class="metric__value">{{ stats.week.tickets }} 单</div>
      </div>
      <div class="metric">
        <div class="metric__label">进行中</div>
        <div class="metric__value">{{ stats.active_sessions }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { fetchAgentStats } from '../services/agent'

const props = defineProps({ agent: Object })
const stats = ref(null)

async function load() {
  stats.value = await fetchAgentStats(props.agent.agent_id)
}
onMounted(load)
watch(() => props.agent.agent_id, load)
</script>
```

---

## 10. NavSidebar 改动

**当前**：`team` 和 `data` 两个 tab 暂未实现。

**改**：把 `team` tab 接入，路由到 `TeamView.vue`（新）。

```js
// NavSidebar 点击 'team'
function selectNav(key) {
  emit('nav-change', key)
}
```

**MainView 接收**：
```js
const activeView = ref('inbox')  // inbox | team | data

function handleNavChange(nav) {
  activeView.value = nav
}

const showAgentPanel = computed(() => activeView.value === 'inbox')
```

---

## 11. 文件改动汇总

```
新增 (15)：
  src/mock/tickets.js
  src/mock/customers.js
  src/stores/ticket.js
  src/stores/customer.js
  src/services/ticket.js
  src/services/customer.js
  src/services/agent.js
  src/components/StatusChip.vue
  src/components/ConfirmDialog.vue
  src/components/TransferDialog.vue
  src/components/UserPanel.vue
  src/components/UserInfoCard.vue
  src/components/UserSessionHistory.vue
  src/components/AgentStatsCard.vue
  src/components/dev/MockTriggerBar.vue

修改 (6)：
  src/common/enum.js                            # 4 态 + 3 动作 + 7 种系统气泡
  src/components/ChatMain.vue                   # header chip + 按钮组 + 系统气泡
  src/components/ConversationMenu.vue           # 新增 transfer 菜单项
  src/components/MessageTimeline.vue            # 7 种 system 类型渲染
  src/components/Conversations.vue              # 列表联动 + 4 态色条
  src/views/MainView.vue                        # 事件汇聚 + rightPanelTab + TeamView 路由
```

---

## 12. 集成验证清单

| # | 场景 | 操作 | 预期 |
|---|---|---|---|
| 1 | 认领 pending | 点「认领」 | 工单进入「我的」，chip「处理中」，列表左色条变蓝 |
| 2 | 解决 processing | 点「解决」+ 二次确认 | 工单出「我的」，chip「已解决」 |
| 3 | 重开 resolved | 点「重新打开」 | chip「重新打开」，气泡出现 |
| 4 | 转移给其他坐席 | header「转移」+ 选目标 + 填备注 | chip 仍「处理中」，气泡出现「A 转给 B：备注」 |
| 5 | 转移给当前 assignee | 选自己 | 按钮 disabled / toast 报错 |
| 6 | 列表过滤 | 切换 VIEW.MINE / UNASSIGNED | 列表正确分桶，计数即时更新 |
| 7 | 二次确认 | 点「解决」 | 弹 ConfirmDialog，含「发送评价卡」开关 |
| 8 | 状态机非法转换 | 直接调 setStatus 在 resolved → processing | catch 异常，toast 报错 |
| 9 | closed 工单不展示 | DB 注入 closed 状态工单 | UI 完全看不到（filterCounts 不计、列表不显示、按钮不显示） |
| 10 | 用户信息模块加载 | 切到"用户信息" tab | 拉取并展示 cust_001 完整信息 + 历史会话 3 条 |
| 11 | 点击历史会话 | 点 UserSessionHistory 中的某条 | 切换到该会话（调用 MainView handleSelectConversation） |
| 12 | Agent 列表页（Nav team） | 点 NavSidebar `team` | 路由到 TeamView，展示 4 个 AgentStatsCard |
| 13 | Agent 业绩卡 | TeamView 加载 | 每个 Agent 展示今日/本周/进行中指标 |
| 14 | 转移后系统气泡 | header「转移」+ 确认 | 消息流出现「A 转给 B」灰色气泡 |

---

## 13. 不在 Sprint 1 范围（明示划走）

- ❌ 优先级 / 颜色条（您明确暂搁）
- ❌ 标签 UI（Sprint 3）
- ❌ 高级过滤器（Sprint 3）
- ❌ 备注 Tab（Sprint 4）
- ❌ CSAT 完整流程（Sprint 5，仅留 csat_status 字段）
- ❌ 真实 IM 广播（接后端后做）
- ❌ 渠道配置表（Sprint 2）
- ❌ 自动分配兜底（Sprint 2）
- ❌ 群成员动态管理（Sprint 2/3）
- ❌ closed 状态 UI（DB 保留，前端不展示）

---

