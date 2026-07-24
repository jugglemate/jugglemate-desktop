# Sprint 1 前端实现要点（设计稿，不动代码）

> 范围：**S1 = T1 状态机 + T9 集成骨架 + 新增「超时兜底」提示**
> 配套文档：`customer-support-flow-design.md` §6 「一句话总览」确定的流程
>
> 目的：把 Sprint 1 要改的**每一个文件、每一处位置、要写什么、怎么跟其他模块接**全部说清楚，方便您 / 前端同学照着改，**不实际改代码**。

---

## 0. Sprint 1 范围

### 0.1 这一轮要做（P0）

1. 工单 5 态机：pending / processing / resolved / closed / reopened
2. header 状态 chip + 按钮组（按 status 动态显示）
3. 系统气泡（状态变化、认领、解决、重开、关闭、超时分配）
4. 4 个服务：状态机 service / 标签 service / CSAT service / 转派 service（先写骨架，方法签名稳定即可）
5. 1 个 store：`ticket.js` + 1 个 mock 数据：`mock/tickets.js`
6. 列表维度联动：ticket 状态变化 → Conversations.vue filterCounts 重算
7. **新增**：超时兜底（auto-assign / auto-close）的本地提示（mock 阶段不发真的 cron，但在 dev 工具栏给"模拟触发"按钮）

### 0.2 这一轮不做（仅留 hook）

- 优先级（T3）
- 标签 UI（T4 后置到 S3）
- 转派 UI（T5 后置到 S4）
- 备注 Tab（T6 后置到 S4）
- CSAT 完整流程（T8 后置到 S5）
- 真实 IM 广播（mock 阶段全部走本地状态机）

### 0.3 这一轮的「新增」（来自流程设计文档）

- **超时兜底提示**：当 mock 工单的 `pending_start_at` 超过 5 min → UI Toast「工单 #xxx 已等待 5 分钟」；超过 15 min → 弹 Toast「系统已自动分配给 XXX」+ 工单状态切到 processing
- **CSAT 状态字段**：工单加 `csat_status: 'none' | 'pending' | 'completed' | 'expired'`，Sprint 1 仅渲染 `none`

---

## 1. 全局枚举（写入 enum.js）

> 位置：`src/common/enum.js` 末尾追加

### 1.1 工单状态

```js
export const TICKET_STATUS = {
  PENDING:    'pending',
  PROCESSING: 'processing',
  RESOLVED:   'resolved',
  CLOSED:     'closed',
  REOPENED:   'reopened'
}

export const TICKET_STATUS_META = {
  pending:    { label: '待处理',   color: '#FF8800', order: 0, icon: '...' },
  processing: { label: '处理中',   color: '#1E88FF', order: 1, icon: '...' },
  resolved:   { label: '已解决',   color: '#07C160', order: 2, icon: '...' },
  closed:     { label: '已关闭',   color: '#9E9E9E', order: 3, icon: '...' },
  reopened:   { label: '重新打开', color: '#7C4DFF', order: 4, icon: '...' }
}
```

### 1.2 工单动作（用于按钮组 + 状态机校验）

```js
export const TICKET_ACTION = {
  CLAIM:      'claim',       // pending → processing
  RESOLVE:    'resolve',     // processing | reopened → resolved
  REOPEN:     'reopen',      // resolved → reopened
  CLOSE:      'close',       // * → closed（管理员）
  RELEASE:    'release',     // * → pending（管理员）
  REASSIGN:   'reassign'     // processing → processing（assignee 变）
}

// 动作 → 合法前置状态
export const TICKET_ACTION_VALID_FROM = {
  claim:    ['pending', 'reopened'],
  resolve:  ['processing', 'reopened'],
  reopen:   ['resolved'],
  close:    ['processing', 'reopened', 'resolved'],
  release:  ['processing', 'reopened', 'resolved', 'closed'],
  reassign: ['processing', 'reopened', 'pending']
}
```

### 1.3 系统气泡类型

```js
export const SYSTEM_BUBBLE_TYPE = {
  CLAIM:           'claim',
  REASSIGN:        'reassign',
  RESOLVE:         'resolve',
  REOPEN:          'reopen',
  CLOSE:           'close',
  AUTO_ASSIGN:     'auto_assign',
  AUTO_CLOSE:      'auto_close',
  CSAT_SENT:       'csat_sent',
  CSAT_RESPONSE:   'csat_response'
}
```

---

## 2. 数据模型（写入 src/mock/tickets.js）

```js
// src/mock/tickets.js
//
// mock 数据集中地。8 条工单，覆盖：
//   - 5 个状态各 ≥ 1 条
//   - 3 个平台（web / telegram / jugglechat）
//   - 2 个 assignee（自己 + 同事） + 1 条无人认领
//   - 部分工单有 pending_start_at 超过 5 分钟（用于触发超时提示 mock）
//
// 接真接口时把这个文件删掉，把 ticket service 里的 setTimeout 改成真 HTTP 调用。

export const TICKETS = [
  {
    ticket_id: 'tk_001',
    conversation_key: '1_42',
    status: 'pending',
    assignee_id: null,
    assignee_name: null,
    pending_start_at: Date.now() - 6 * 60 * 1000,  // 6 分钟前，等于触发了「等 5 分钟」提示
    created_at: Date.now() - 6 * 60 * 1000,
    updated_at: Date.now() - 6 * 60 * 1000,
    platform: 'telegram',
    last_message_preview: '请问订单什么时候发货？',
    customer_name: '张三',
    customer_avatar: '',
    reopen_count: 0,
    csat_status: 'none',
    version: 0
  },
  {
    ticket_id: 'tk_002',
    conversation_key: '1_55',
    status: 'processing',
    assignee_id: '__SELF__',  // __SELF__ 表示「当前登录用户」，service 里替换
    assignee_name: '我',
    pending_start_at: Date.now() - 20 * 60 * 1000,
    created_at: Date.now() - 25 * 60 * 1000,
    updated_at: Date.now() - 1 * 60 * 1000,
    platform: 'web',
    last_message_preview: '我已经退款了，请查收',
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
    pending_start_at: null,
    created_at: Date.now() - 2 * 60 * 60 * 1000,
    updated_at: Date.now() - 30 * 60 * 1000,
    resolved_at: Date.now() - 30 * 60 * 1000,
    platform: 'jugglechat',
    last_message_preview: '感谢您的帮助！',
    customer_name: '王五',
    customer_avatar: '',
    reopen_count: 0,
    csat_status: 'pending',   // 已发评价卡，待客户评
    csat_expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
    version: 2
  },
  // ... 再造 5 条覆盖 closed / reopened / 平台 / 跨坐席 / 待超时分配 等场景
]
```

---

## 3. 新增文件清单

| 路径 | 类型 | 说明 |
|---|---|---|
| `src/mock/tickets.js` | mock 数据 | 见 §2 |
| `src/stores/ticket.js` | store | 单例 reactive Map<ticket_id, Ticket> |
| `src/services/ticket.js` | service | 状态机核心，**所有变更走这里** |
| `src/services/csat.js` | service | CSAT 调用骨架（S1 仅占位） |
| `src/components/StatusChip.vue` | 组件 | 复用：渲染状态文字+色 |
| `src/components/ConfirmDialog.vue` | 组件 | 通用二次确认 |
| `src/components/dev/MockTriggerBar.vue` | dev 组件 | 顶部调试条：模拟超时分配、超时关闭、客户回复触发 reopen |

---

## 4. src/stores/ticket.js 设计

> 单例 reactive store，全 app 共享。**所有 ticket 字段读写都走这个 store**。

```js
// src/stores/ticket.js
import { reactive, computed } from 'vue'
import { TICKETS } from '../mock/tickets'
import { TICKET_STATUS } from '../common/enum'

class TicketStore {
  constructor() {
    this.byId = reactive(new Map())    // ticket_id → Ticket
    this.byConvKey = reactive(new Map())  // conversation_key → ticket_id
    this.initialized = false
  }

  // ---- 初始化（mock 阶段：同步灌入；接后端：异步拉） ----
  init() {
    if (this.initialized) return
    for (const t of TICKETS) {
      this.byId.set(t.ticket_id, { ...t })
      this.byConvKey.set(t.conversation_key, t.ticket_id)
    }
    this.initialized = true
  }

  // ---- 查询 ----
  get(ticket_id) {
    return this.byId.get(ticket_id) || null
  }
  getByConvKey(convKey) {
    const id = this.byConvKey.get(convKey)
    return id ? this.byId.get(id) : null
  }
  list() {
    return Array.from(this.byId.values())
  }
  // 视图（按 status 分桶）
  listByStatus(status) {
    return this.list().filter(t => t.status === status)
  }
  listByAssignee(assignee_id) {
    return this.list().filter(t => t.assignee_id === assignee_id)
  }
  listByPlatform(platform) {
    return this.list().filter(t => t.platform === platform)
  }

  // ---- 变更（service 调用，不要在组件里直接调） ----
  upsert(ticket) {
    const next = { ...this.byId.get(ticket.ticket_id), ...ticket }
    this.byId.set(ticket.ticket_id, next)
    if (next.conversation_key) {
      this.byConvKey.set(next.conversation_key, ticket.ticket_id)
    }
    return next
  }

  // ---- 派生 ----
  stats() {
    return {
      pending:    this.listByStatus('pending').length,
      processing: this.listByStatus('processing').length,
      resolved:   this.listByStatus('resolved').length,
      closed:     this.listByStatus('closed').length,
      reopened:   this.listByStatus('reopened').length
    }
  }
}

export const ticketStore = new TicketStore()
export default ticketStore
```

**关键设计点**：
- 用 Map 而不是 Array：`O(1)` 按 id 查，循环里 `listByStatus` 才转数组
- 初始化一次：mock 灌入；接后端时改成 `init()` 里 await HTTP 拉
- **service 层负责改 store**，组件层只读不写

---

## 5. src/services/ticket.js 设计（核心）

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
import { SERVER_PATH, get, post, patch } from './api'
import { TICKET_STATUS, TICKET_ACTION, TICKET_ACTION_VALID_FROM, SYSTEM_BUBBLE_TYPE } from '../common/enum'
import im from '../common/im'
import emitter from '../common/emitter'  // 已有，用于跨组件事件
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

// emit 一条系统气泡到 imMessages（由 ChatMain 订阅）
function emitSystemBubble(conversationKey, type, payload) {
  emitter.emit('system-bubble', { conversationKey, type, payload, at: Date.now() })
}

// ============ Mock 开关 ============
// true = 走本地 mock；false = 走真接口
// 接真接口时把这个全局开关删掉，每个方法里去掉对应的 return
const MOCK_MODE = true
function delay(data) {
  return new Promise(resolve => setTimeout(() => resolve(data), 50))
}

// ============ 状态机方法 ============

/**
 * 认领（pending | reopened → processing）
 * 现有 TICKET_CLAIM 已有，复用
 */
export async function claim(ticket_id) {
  const t = ticketStore.get(ticket_id)
  if (!t) throw new Error('ticket not found')
  checkTransition('claim', t)

  // TODO(接入): 走真接口时改回 ↓
  // const res = await post(SERVER_PATH.TICKET_CLAIM(ticket_id), { expected_version: t.version })
  // if (res.code !== 0) throw new Error(res.msg)
  if (MOCK_MODE) await delay({ code: 0 })

  // 更新 store
  ticketStore.upsert({
    ticket_id,
    status: 'processing',
    assignee_id: '__SELF__',
    assignee_name: '我',
    pending_start_at: null,
    updated_at: Date.now(),
    version: t.version + 1
  })

  // 同步 IM tag（已有 im.js API）
  // 注意：只在 conversation 已加载时调，没加载就跳过
  const conv = im.getConversationByKey(t.conversation_key)
  if (conv) {
    void im.addConversationToAssignedTag(conv)
    void im.addConversationToMyTicketTag(conv)
  }

  // 系统气泡
  emitSystemBubble(t.conversation_key, SYSTEM_BUBBLE_TYPE.CLAIM, {
    operator: '我'
  })

  return ticketStore.get(ticket_id)
}

/**
 * 解决（processing | reopened → resolved）
 */
export async function resolve(ticket_id, { send_csat = true, note = '' } = {}) {
  const t = ticketStore.get(ticket_id)
  if (!t) throw new Error('ticket not found')
  checkTransition('resolve', t)

  // TODO(接入): POST /jmate/tickets/:id/resolve
  if (MOCK_MODE) await delay({ code: 0 })

  ticketStore.upsert({
    ticket_id,
    status: 'resolved',
    resolved_at: Date.now(),
    updated_at: Date.now(),
    csat_status: send_csat ? 'pending' : 'none',
    csat_expires_at: send_csat ? Date.now() + 7 * 24 * 60 * 60 * 1000 : null,
    version: t.version + 1
  })

  // 释放 tag（resolved 工单不算"我的"，不再显示在「我的」）
  const conv = im.getConversationByKey(t.conversation_key)
  if (conv) {
    void im.removeConversationFromAssignedTag(conv)
    void im.removeConversationFromMyTicketTag(conv)
  }

  emitSystemBubble(t.conversation_key, SYSTEM_BUBBLE_TYPE.RESOLVE, {
    operator: '我',
    send_csat
  })

  if (send_csat) {
    emitSystemBubble(t.conversation_key, SYSTEM_BUBBLE_TYPE.CSAT_SENT, {})
  }

  return ticketStore.get(ticket_id)
}

/**
 * 重开（resolved → reopened）
 * 触发：客服手动 OR 客户在 resolved 后发新消息
 */
export async function reopen(ticket_id, { reason = '', by = 'agent' } = {}) {
  const t = ticketStore.get(ticket_id)
  if (!t) throw new Error('ticket not found')
  checkTransition('reopen', t)

  // TODO(接入): POST /jmate/tickets/:id/reopen
  if (MOCK_MODE) await delay({ code: 0 })

  ticketStore.upsert({
    ticket_id,
    status: 'reopened',
    reopened_at: Date.now(),
    updated_at: Date.now(),
    reopen_count: (t.reopen_count || 0) + 1,
    pending_start_at: by === 'customer' ? Date.now() : t.pending_start_at,
    version: t.version + 1
  })

  // reopened 状态不进「我的」，释放 tag
  const conv = im.getConversationByKey(t.conversation_key)
  if (conv) {
    void im.removeConversationFromMyTicketTag(conv)
    // assigned tag 保留（表示「这单我处理过」），但 my_ticket 必须释放
  }

  emitSystemBubble(t.conversation_key, SYSTEM_BUBBLE_TYPE.REOPEN, {
    by,
    reason
  })

  return ticketStore.get(ticket_id)
}

/**
 * 关闭（任意非 pending → closed）
 * 触发：管理员手动 OR 超时自动
 */
export async function close(ticket_id, { reason = 'agent_close', by = 'agent' } = {}) {
  const t = ticketStore.get(ticket_id)
  if (!t) throw new Error('ticket not found')

  // close 允许 from processing/reopened/resolved/closed（幂等）
  if (t.status === 'pending') {
    throw new TicketStateError('close', t.status)
  }

  // TODO(接入): POST /jmate/tickets/:id/close
  if (MOCK_MODE) await delay({ code: 0 })

  ticketStore.upsert({
    ticket_id,
    status: 'closed',
    closed_at: Date.now(),
    closed_reason: reason,
    updated_at: Date.now(),
    version: t.version + 1
  })

  // 释放 tag
  const conv = im.getConversationByKey(t.conversation_key)
  if (conv) {
    void im.removeConversationFromAssignedTag(conv)
    void im.removeConversationFromMyTicketTag(conv)
  }

  emitSystemBubble(t.conversation_key, SYSTEM_BUBBLE_TYPE.CLOSE, {
    by,
    reason
  })

  return ticketStore.get(ticket_id)
}

/**
 * 自动分配（pending → processing）
 * 后端 cron 调用，本地 mock 时由 MockTriggerBar 触发
 */
export async function autoAssign(ticket_id, { rule = 'least_busy', assignee_id = 'u_008', assignee_name = '系统分配' } = {}) {
  const t = ticketStore.get(ticket_id)
  if (!t) throw new Error('ticket not found')
  if (t.status !== 'pending' && t.status !== 'reopened') {
    throw new TicketStateError('auto_assign', t.status)
  }

  // TODO(接入): 内部接口，cron 调用，前端不发
  if (MOCK_MODE) await delay({ code: 0 })

  ticketStore.upsert({
    ticket_id,
    status: 'processing',
    assignee_id,
    assignee_name,
    assigned_by_rule: rule,
    pending_start_at: null,
    updated_at: Date.now(),
    version: t.version + 1
  })

  const conv = im.getConversationByKey(t.conversation_key)
  if (conv) {
    void im.addConversationToAssignedTag(conv)
    // auto_assign 时不 add my_ticket（不是当前用户接的）
  }

  emitSystemBubble(t.conversation_key, SYSTEM_BUBBLE_TYPE.AUTO_ASSIGN, {
    rule,
    assignee: assignee_name
  })

  toast.info(`工单 #${ticket_id} 已等待 15 分钟，系统自动分配给 ${assignee_name}`)

  return ticketStore.get(ticket_id)
}

/**
 * 自动关闭（任意 → closed）
 */
export async function autoClose(ticket_id, { reason = 'customer_silence' } = {}) {
  // 复用 close，但 reason / by 改写
  return close(ticket_id, { reason, by: 'system' })
}
```

---

## 6. 组件改动清单（按文件）

### 6.1 ChatMain.vue（最大改动）

#### 6.1.1 header 状态 chip 区域（替换现有 0/1/2 CSS）

**位置**：`src/components/ChatMain.vue` 模板 `<div class="tyn-chat-header__meta">` 子级

**新增**：
```vue
<StatusChip
  v-if="currentTicket"
  :status="currentTicket.status"
  :show-dot="true"
/>
```

**数据来源**：
```js
const currentTicket = computed(() => {
  const conv = props.conversation
  if (!conv) return null
  const convKey = `${conv.conversationType}_${conv.conversationId}`
  return ticketStore.getByConvKey(convKey)
})
```

#### 6.1.2 header 按钮组（按 status 动态渲染）

**位置**：header `<div class="tyn-chat-header__actions">`

**逻辑**：
```js
const actionButtons = computed(() => {
  const t = currentTicket.value
  if (!t) return []
  const buttons = []
  const role = currentUserRole.value  // 1 = 管理员
  const isSelf = t.assignee_id === '__SELF__' || t.assignee_id === currentUserId.value

  switch (t.status) {
    case 'pending':
      buttons.push({ key: 'claim', label: '认领', primary: true, action: () => onClaim(t.ticket_id) })
      buttons.push({ key: 'reassign', label: '转派', action: () => onReassign(t.ticket_id) })
      break
    case 'processing':
    case 'reopened':
      if (isSelf) {
        buttons.push({ key: 'resolve', label: '解决', primary: true, action: () => onResolve(t.ticket_id) })
      }
      buttons.push({ key: 'reassign', label: '转派', action: () => onReassign(t.ticket_id) })
      if (role === 2) {
        buttons.push({ key: 'close', label: '关闭', danger: true, action: () => onClose(t.ticket_id) })
      }
      break
    case 'resolved':
      if (isSelf) {
        buttons.push({ key: 'reopen', label: '重新打开', primary: true, action: () => onReopen(t.ticket_id) })
      }
      if (role === 2) {
        buttons.push({ key: 'close', label: '关闭', danger: true, action: () => onClose(t.ticket_id) })
      }
      break
    case 'closed':
      // 无操作
      break
  }
  return buttons
})
```

#### 6.1.3 事件 emit（到 MainView）

```js
const emit = defineEmits([
  ...已有的,
  'ticket-action',  // { action: 'claim'|'resolve'|'reopen'|'close'|'reassign', ticket_id, opts? }
])
```

#### 6.1.4 系统气泡订阅

```js
import emitter from '../common/emitter'

let systemBubbleHandler = null
onMounted(() => {
  systemBubbleHandler = ({ conversationKey, type, payload }) => {
    if (conversationKey !== currentConvKey.value) return
    // 构造一个 MessageTimeline 类型的数据塞进 imMessages
    const bubble = buildSystemBubble(type, payload)
    imMessages.value.push(bubble)
    nextTick(scrollToBottom)
  }
  emitter.on('system-bubble', systemBubbleHandler)
})
onBeforeUnmount(() => {
  emitter.off('system-bubble', systemBubbleHandler)
})

function buildSystemBubble(type, payload) {
  return {
    messageId: 'sys_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: 'jgm:timeline',  // 复用 timeline 气泡
    content: JSON.stringify({ type, payload }),
    sentTime: Date.now(),
    sentState: 'success',
    isSelf: false,
    isSystem: true  // 新增标记
  }
}
```

---

### 6.2 ConversationMenu.vue（右键菜单）

**改动**：现有「标记未读 / 删除会话」基础上加分组

**新增项**：
- 分组「工单操作」
  - 状态：4 选 1 子菜单（pending / processing / resolved / closed）— 仅管理员可见
  - 认领 — pending 时显示
  - 解决 — processing/reopened 时显示
  - 重新打开 — resolved 时显示
- 分组「转派」— 任何 assigned 状态显示

**事件 emit**：`conversation-op` 新增 type：`status_change` / `claim` / `resolve` / `reopen`

---

### 6.3 MessageTimeline.vue（系统气泡渲染）

**位置**：`src/components/MessageTimeline.vue`

**现有**：渲染「时间分隔条」。

**改动**：新增 `system` 类型渲染。

**逻辑**：
```js
const props = defineProps({
  // 已有 props
  // 新增：
  bubble: { type: Object, default: null }  // { type, payload }
})

const text = computed(() => {
  if (!props.bubble) return ''
  const { type, payload } = props.bubble
  switch (type) {
    case SYSTEM_BUBBLE_TYPE.CLAIM:        return `${payload.operator} 认领了工单`
    case SYSTEM_BUBBLE_TYPE.REASSIGN:     return `${payload.from} 转派给 ${payload.to}${payload.note ? `：${payload.note}` : ''}`
    case SYSTEM_BUBBLE_TYPE.RESOLVE:      return `${payload.operator} 标记为已解决${payload.send_csat ? '（已发送评价卡）' : ''}`
    case SYSTEM_BUBBLE_TYPE.REOPEN:       return `工单重新打开（${payload.by === 'customer' ? '客户追问' : '客服手动'}）`
    case SYSTEM_BUBBLE_TYPE.CLOSE:        return `工单已关闭（${payload.reason || '管理员操作'}）`
    case SYSTEM_BUBBLE_TYPE.AUTO_ASSIGN:  return `系统自动分配给 ${payload.assignee}（规则：${payload.rule}）`
    case SYSTEM_BUBBLE_TYPE.AUTO_CLOSE:   return `工单自动关闭（客户超时未回复）`
    case SYSTEM_BUBBLE_TYPE.CSAT_SENT:    return `已向客户发送满意度评价卡`
    case SYSTEM_BUBBLE_TYPE.CSAT_RESPONSE:return `客户已评价：${'⭐'.repeat(payload.score)}（${payload.score} 星）`
    default: return ''
  }
})
```

**样式**：复用现有 timeline 灰色条 + 系统图标 + 单行居中。

---

### 6.4 Conversations.vue（列表联动）

**位置**：`src/components/Conversations.vue`

**改动**：
1. 增加 `currentTicketStatuses` ref 暂不启用（Sprint 1 不做筛选维度，Sprint 2 再加）
2. `filterCounts` 计算时**也读 ticket store**：
   - VIEW.UNASSIGNED 计数 = ticketStore.listByStatus('pending').length
   - VIEW.MINE 计数 = ticketStore.listByAssignee('__SELF__').filter(t => t.status === 'processing' || t.status === 'reopened').length
3. 列表卡片左侧色条：显示 ticket 状态
   - 已有 `isInAssignedTag` / `isInMyTicketTag` 决定显示位置
   - **新增**状态色条：根据 `ticket.status` 给卡片左边加 4px 竖条
4. `ticketStore` 变化 → 触发 filterCounts 重算（用 watch）

**关键代码**：
```js
import { ticketStore } from '../stores/ticket'

const ticketVersion = ref(0)  // 触发 watch 重算
watch(
  () => Array.from(ticketStore.byId.values()).map(t => `${t.ticket_id}:${t.status}:${t.assignee_id}`).join('|'),
  () => { ticketVersion.value++ }
)

// filterCounts 重算时同时读 ticket store
function recomputeFilterCounts() {
  const tickets = ticketStore.list()
  // ... 现有逻辑 ...
  // 新增：按 ticket.status 重算 VIEW 分桶
  filterCounts[VIEW.UNASSIGNED] = tickets.filter(t => t.status === 'pending').length
  filterCounts[VIEW.MINE] = tickets.filter(t => 
    (t.status === 'processing' || t.status === 'reopened') &&
    (t.assignee_id === '__SELF__' || t.assignee_id === currentUserId.value)
  ).length
  filterCounts[VIEW.AI_TAKEOVER] = ... // 暂用现有 im.js 接管 tag
}
```

---

### 6.5 MainView.vue（事件汇聚）

**位置**：`src/views/MainView.vue`

**改动**：
1. `<script>` 顶部 `import { ticketStore } from '../stores/ticket'`
2. `onMounted` 里 `ticketStore.init()`
3. 接收 ChatMain 的 `ticket-action` 事件 → 转发到 `ticket service`
4. 接收 ConversationMenu 的新事件类型
5. 挂载 `MockTriggerBar` 组件（仅 dev 环境：`import.meta.env.DEV`）

**新增 handler**：
```js
async function handleTicketAction({ action, ticket_id, opts }) {
  try {
    switch (action) {
      case 'claim':   await claimService(ticket_id); break
      case 'resolve': await resolveService(ticket_id, opts); break
      case 'reopen':  await reopenService(ticket_id, opts); break
      case 'close':   await closeService(ticket_id, opts); break
      case 'reassign':/* S4 实现 */ break
    }
  } catch (e) {
    toast.error(e.message || '操作失败')
  }
}
```

---

## 7. 新增组件详细设计

### 7.1 StatusChip.vue

```vue
<!--
  复用组件：渲染 TICKET_STATUS_META 里的 label / color / icon
  Props: status (String), showDot (Boolean, default true), size (String, 'sm'|'md')
-->
<template>
  <span class="status-chip" :class="['size-' + size]" :style="{ color: meta.color, borderColor: meta.color }">
    <span v-if="showDot" class="dot" :style="{ background: meta.color }"></span>
    <span class="label">{{ meta.label }}</span>
  </span>
</template>
```

样式：圆角 4px、1px 边框、内边距 2px 8px。

### 7.2 ConfirmDialog.vue

```vue
<!--
  通用二次确认弹层
  Props:
    show: Boolean
    title: String
    message: String
    confirmText: String (default '确认')
    cancelText: String (default '取消')
    danger: Boolean (red 按钮)
    showNote: Boolean (显示备注输入框)
    noteRequired: Boolean
  Emits:
    confirm (note?: string)
    cancel
-->
```

**使用示例**：解决时弹"是否发评价卡"开关 + 备注输入框。

### 7.3 MockTriggerBar.vue（仅 dev）

```vue
<!--
  顶部调试条：模拟后端 cron / 客户行为
  - [模拟超时分配] 按钮：选一条 pending 工单，触发 autoAssign
  - [模拟超时关闭] 按钮：选一条 processing 工单，触发 autoClose
  - [模拟客户回复] 按钮：选一条 resolved 工单，触发 reopen by=customer
  - [重置 mock 数据] 按钮
  - [强制所有工单到 pending] 按钮（快速看到「待处理」池）
-->
```

---

## 8. 视图渲染逻辑（伪代码）

### 8.1 列表卡片颜色

```
if ticket.status === 'pending'   → 左色条 #FF8800
if ticket.status === 'processing'→ 左色条 #1E88FF
if ticket.status === 'resolved'  → 左色条 #07C160
if ticket.status === 'closed'    → 左色条 #9E9E9E
if ticket.status === 'reopened'  → 左色条 #7C4DFF
```

### 8.2 视图过滤（VIEW）

```
VIEW.MINE:
  ticket.status ∈ {processing, reopened}
  AND ticket.assignee_id = currentUserId

VIEW.UNASSIGNED:
  ticket.status === 'pending'

VIEW.AI_TAKEOVER:
  // 暂用 im.js 接管 tag，与现有逻辑一致

VIEW.ALL:
  // 无 ticket.status 过滤
```

### 8.3 列表渲染优先级

```
Conversations.vue 渲染会话时：
  1. 从 imConversations 拿所有会话（已有逻辑）
  2. 对每个会话，从 ticketStore.getByConvKey(convKey) 拿 ticket
  3. 根据当前 VIEW 过滤
  4. 渲染时附 ticket.status 色条 + assignee 显示
```

---

## 9. 集成验证清单

Sprint 1 完成后，**下列场景必须全部跑通**（手动验证）：

| # | 场景 | 操作 | 预期 |
|---|---|---|---|
| 1 | 认领 pending | 点「认领」按钮 | 工单进入「我的」，header chip 变「处理中」，列表左色条变蓝 |
| 2 | 解决 processing | 点「解决」+ 勾选发评价 | 工单出「我的」，进入「全部」resolved 区，header chip 变「已解决」，消息流出现「已发送评价卡」气泡 |
| 3 | 重开 resolved | 点「重新打开」 | 工单回到「全部」reopened 区，消息流出现「重新打开」气泡 |
| 4 | 重开 resolved by 客户 | MockTriggerBar「模拟客户回复」 | 同上，但气泡文案为「客户追问」 |
| 5 | 关闭 processing | MockTriggerBar「模拟超时关闭」 | header chip 变「已关闭」，消息流出现「自动关闭」气泡 |
| 6 | 关闭（管理员） | 管理员态点「关闭」按钮 | 同上，但气泡文案为「管理员操作」 |
| 7 | 非法转换 | 已关闭工单点「重新打开」 | 按钮不显示 / 提示「当前状态不允许此操作」 |
| 8 | 列表过滤 | 切换 VIEW.MINE / UNASSIGNED | 列表正确分桶，计数即时更新 |
| 9 | 超时分配 | MockTriggerBar「模拟超时分配」 | Toast 提示，header chip 变「处理中」，气泡出现「系统自动分配给 XXX」 |
| 10 | 二次确认 | 点「解决」 | 弹 ConfirmDialog，含「发送评价卡」开关 + 备注框 |
| 11 | 状态机非法转换报错 | 直接调用 `resolve()` 在 closed 工单上 | catch 异常，toast 报错 |
| 12 | 状态变化联动列表 | 在 dev 改 `ticketStore.byId` 某条 status | Conversations.vue filterCounts 自动重算 |

---

## 10. 文件改动汇总

```
新增 (7)：
  src/mock/tickets.js
  src/stores/ticket.js
  src/services/ticket.js
  src/services/csat.js
  src/components/StatusChip.vue
  src/components/ConfirmDialog.vue
  src/components/dev/MockTriggerBar.vue

修改 (5)：
  src/common/enum.js                            # 加 TICKET_STATUS/META/ACTION/SYSTEM_BUBBLE_TYPE
  src/components/ChatMain.vue                   # header chip + 按钮组 + 系统气泡订阅
  src/components/ConversationMenu.vue           # 新增工单操作菜单项
  src/components/MessageTimeline.vue            # 新增 system 类型渲染
  src/components/Conversations.vue              # 列表联动 ticket store
  src/views/MainView.vue                        # 事件汇聚 + 挂载 MockTriggerBar
```

---

## 11. 不在 Sprint 1 范围（明示划走）

- ❌ 优先级 / 颜色条（S3）
- ❌ 标签 UI（S3）
- ❌ 高级过滤器（S3）
- ❌ 转派弹层（S4，仅留 hook）
- ❌ 备注 Tab（S4）
- ❌ CSAT 完整流程（S5，仅留字段）
- ❌ 真实 IM 广播（接后端后做）
- ❌ 抢单乐观锁（前端版本号已留字段，乐观锁校验在 B 文档里写给后端）

---

