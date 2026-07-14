# JuggleMate 客服能力前端闭环迭代规划

> **2026-07-13 修订说明**：本轮 Sprint 1 已精简为 4 态（去 closed），并新增 transfer / agents / customers 接口和用户信息模块。**最新最详细的实现稿见 `sprint-1-revised-frontend.md`**，本文档保留作为整体迭代路线图，T1-T9 任务清单已部分过时，仅作参考。
>
> 关键变更：
> 1. 状态机从 5 态精简为 **4 态**（pending / processing / resolved / reopened，closed 字段保留但前端不可见）
> 2. 状态变更统一为 **`PATCH /tickets/:id/status`**，替代原 resolve/reopen/close/release 4 个独立接口
> 3. 转派独立为 **`POST /tickets/:id/transfer`**，合并原 reassign
> 4. 新增 **3 个 Agent 接口**（available / online / stats）
> 5. 新增 **2 个 Customer 接口**（detail / sessions）
> 6. 新增 **前端用户信息模块**（与 AgentPanel 同级 Tab 切换）

> 范围：仅做**前端的闭环**——UI 全跑通、状态/数据流转全做出来，初始数据用内存 mock，需要落库/广播的接口先打 `TODO` 标记 + 在调用点留 hook，**不动 IM 后端、也不动业务后端的真实接口**。
>
> 适用：当前 `src/` + IM SDK 已实现的能力扩展；不依赖 Chatwoot 仓库。

---

## 0. 文档约定

- **任务标记**：每条任务拆成「UI / 数据逻辑 / 后端接口」三块，标 `🟢 仅前端`、`🟡 前端+预留 hook`、`🔴 需要后端补接口（先 mock，TODO 留点）`。
- **优先级**：P0 = 必修（工单生命周期闭环）、P1 = 强烈推荐（提效）、P2 = 长期布局。
- **入参出参**：放到末尾「八、接口契约清单」，含 mock 响应体、HTTP 路径、入参/出参 JSON、错误码。**这一节是后端实现时的依据**。
- **约定**：所有 mock 数据集中在 `src/mock/*.js`，接真接口时把对应 `service` 函数里的 `await new Promise(resolve => setTimeout(() => resolve(MOCK), 50))` 改回 `await get(SERVER_PATH.XXX)`，再删掉 mock 文件即可。

---

## 1. 总览：这一轮要做什么 / 不做什么

### 1.1 要做（前端可独立闭环）

| 模块 | 范围 | 优先级 |
|---|---|---|
| **工单状态机** | **4 态精简版**：待分配 / 处理中 / 已解决 / 重新打开（去 closed） | P0 |
| **工单转移** | header 按钮 + 弹层选目标 + 备注 + 系统气泡 | P0 |
| **Agent 列表页 + 业绩卡** | Nav `team` tab 接入，展示每个 Agent 的今日/本周/进行中 | P0 |
| **用户信息模块** | 与 AgentPanel 同级 Tab 切换，展示客户信息 + 历史会话 | P0 |
| 工单筛选维度新增 | 在现有 VIEW/PLATFORM 之外，加「工单状态」维度 | P1 |
| 工单优先级 | 4 档（low / medium / high / urgent）+ 头栏色条 + 列表 dot | P2（您明确暂搁） |
| 会话标签 | 加/卸标签 chip + 列表多色 dot + 高级过滤器入口 | P2 |
| 内部备注 | 输入区 REPLY / NOTE Tab + 灰色气泡 + 客户渠道过滤提示 | P2 |
| CSAT 评价 | resolve 时勾选 → 客户气泡 → 客服侧显示评分 | P2 |

### 1.2 不做（留 hook，文档化）

- SLA 倒计时、报表、团队管理、知识库、自动化规则、Campaigns —— 这一轮不实现，仅在 enum / nav 留位置
- IM 自定义消息广播（`jgm:priority` / `jgm:label` / `jgm:ticket_resolved` 等）—— 这一轮**只在本地状态机里跑通**，接 IM 广播等后端约定后再加
- 围观者（抄送）—— UI 占位先不上

### 1.3 维度扩展：会话/工单的筛选轴

```
会话筛选 = 视图  ×  平台  ×  工单状态(4 态)  ×  标签  ×  关键词（搜索框）
           ↓       ↓           ↓             ↓       ↓
           mine   web        pending       [vip]   "order"
           unassigned telegram  processing
           ai_takeover jugglechat resolved
           all                    reopened
                              （closed 已被过滤掉，前端不可见）
```

> 三级过滤组合：视图 ∩ 平台 ∩ 状态，与现有 tag 协议一致，状态在客户端 filter（mock 阶段不上后端）。**closed 状态在 list 接口层被过滤掉，前端不需要处理**。

---

## 2. 全局数据模型（前端内存态）

> 这是 mock 阶段所有本地 store 共享的"权威 schema"。**接后端时一一对应**。

```js
// —— 工单状态枚举 ——
TICKET_STATUS = {
  PENDING:    'pending',     // 待处理（0）：未分配
  PROCESSING: 'processing',  // 处理中（1）：已分配、客服在处理
  RESOLVED:   'resolved',    // 已解决（2）：客服点解决
  CLOSED:     'closed',      // 已关闭（3）：超时/管理员手动关
  REOPENED:   'reopened'     // 重新打开（4）：从 resolved 回到 processing
}
// 中文 label / 颜色（前端用，存库只用 enum value）
TICKET_STATUS_META = {
  pending:    { label: '待处理',   color: '#FF8800', dot: '🟠' },
  processing: { label: '处理中',   color: '#1E88FF', dot: '🔵' },
  resolved:   { label: '已解决',   color: '#07C160', dot: '🟢' },
  closed:     { label: '已关闭',   color: '#9E9E9E', dot: '⚫' },
  reopened:   { label: '重新打开', color: '#7C4DFF', dot: '🟣' }
}

// —— 工单优先级 ——
TICKET_PRIORITY = {
  LOW:    'low',
  MEDIUM: 'medium',
  HIGH:   'high',
  URGENT: 'urgent'
}
TICKET_PRIORITY_META = {
  low:    { label: '低',  color: '#9E9E9E', order: 0 },
  medium: { label: '中',  color: '#1E88FF', order: 1 },
  high:   { label: '高',  color: '#FF8800', order: 2 },
  urgent: { label: '紧急', color: '#FF2442', order: 3 }
}

// —— 会话标签 ——
TICKET_LABEL = {
  // 业务预置 5 个，管理员可增
  VIP:        { id: 'vip',         name: 'VIP 客户',   color: '#FF2442' },
  REFUND:     { id: 'refund',      name: '退换货',     color: '#FF8800' },
  LOGISTICS:  { id: 'logistics',   name: '物流查询',   color: '#1E88FF' },
  COMPLAINT:  { id: 'complaint',   name: '投诉',       color: '#9C27B0' },
  FOLLOW_UP:  { id: 'follow_up',   name: '需回访',     color: '#07C160' }
}

// —— 工单详情（前端内存态，存于 src/mock/tickets.js）——
{
  ticket_id: 'tk_001',
  conversation_key: '1_42',          // `${conversationType}_${conversationId}` 关联会话
  status: 'pending',                 // 见 TICKET_STATUS
  priority: 'medium',                // 见 TICKET_PRIORITY
  assignee_id: null,                 // null = 未分配
  assignee_name: null,
  team_id: null,
  label_ids: [],                     // TICKET_LABEL.id[]
  csat: null,                        // { score: 1-5, comment, at } | null
  resolved_at: null,
  reopen_count: 0,
  created_at: 1730000000,
  updated_at: 1730000000
}
```

> 现有 `currentConversation.status`（MainView 中只有 0/1/2 三态的 CSS 渲染）这一轮升级到 5 态枚举，CSS 同步加 5 个 `status-*` 类。

---

## 3. 任务清单

> 每条任务有：编号、需求描述、拆解、验收。

---

### T1 · 工单状态机全打通 【P0】 🔴

#### 需求描述
当前工单只有"分配给我"一个动作，CSS 里渲染 status-0/1/2 三态但**没有业务字段、没有流转按钮**。
这一轮要：
1. 工单有 5 个状态：待处理 / 处理中 / 已解决 / 已关闭 / 重新打开
2. 状态机规则：
   - 待处理 → 处理中：分配给我 / 转派
   - 处理中 → 已解决：点「解决」
   - 已解决 → 重新打开：点「重新打开」或客户发新消息
   - 重新打开 → 处理中：自动（视为 processing）
   - 处理中/重新打开 → 已关闭：管理员点「关闭」 / 24h 无回复自动关
   - 任何状态 → 待处理：仅管理员「释放」
3. header 右侧按当前状态显示对应按钮组：
   - 待处理：分配给我（已有） + 转派
   - 处理中：解决 + 关闭（管理员） + 转派
   - 已解决：重新打开 + 关闭
   - 已关闭：（只读）
   - 重新打开：解决 + 关闭
4. 每次状态变化在消息流里塞一条「系统气泡」（`MessageTimeline.vue` 类型复用 + 自定义文本）
5. 状态 chip 显示在 header 名字下方

#### 拆解
- **🟢 UI**：
  - `ChatMain.vue` header 状态 chip 区域（替换现有 0/1/2 CSS 的部分）
  - `ChatMain.vue` header 右侧按钮组按 `status` 动态渲染
  - `MessageTimeline.vue` 新增 system action 类型（`status_change` / `assign` / `reassign` / `resolve` / `reopen` / `close`）
  - `ConversationMenu.vue` 右键菜单新增"状态" 子菜单（4 选 1 + 关闭）
- **🟡 数据逻辑**：
  - `src/stores/ticket.js`（新建）—— 单例 reactive map，key=`ticket_id`，value=工单详情 schema
  - `src/services/ticket.js`（新建）—— 状态机 service：
    - `assign(ticketId, agentId)` —— pending → processing
    - `resolve(ticketId, opts)` —— processing → resolved
    - `reopen(ticketId)` —— resolved → reopened
    - `close(ticketId)` —— processing/reopened/resolved → closed
    - `release(ticketId)` —— * → pending（仅管理员）
    - `reassign(ticketId, toAgentId)` —— processing → processing（assignee 变）
  - 每次状态变化：① 更新 store ② 写 IM 消息（mock：append 到 `imMessages`）③ 同步 conversation.status
  - mock：`src/mock/tickets.js` 初始化 8 条工单（覆盖 5 个状态 × 3 个平台）
- **🔴 后端接口（先 TODO）**：
  - `POST /jmate/tickets/:id/resolve`
  - `POST /jmate/tickets/:id/reopen`
  - `POST /jmate/tickets/:id/close`
  - `POST /jmate/tickets/:id/release`
  - 现有 `TICKET_CLAIM` 已能 cover "assign"，无需新增；只在 service 里把本地 assign 落到 `TICKET_CLAIM` hook

#### 验收
- 5 态任意切换按钮均可用，状态 chip / 头栏 / 列表 dot / 气泡 全部同步
- mock 阶段所有状态变化立即生效，刷新页面后从 mock 恢复
- 客户渠道收到新消息时，状态自动 `resolved → reopened`（在 ChatMain 的 `onMessageReceived` 里加 hook）

---

### T2 · 工单状态作为新筛选维度 【P0】 🟢

#### 需求描述
在 `Conversations.vue` 现有 VIEW（4 个）× PLATFORM（4 个）的二级过滤侧栏上，**新增第三组「工单状态」过滤**，与现有两组组合（交集）。

#### 需求细化
- 状态过滤项（4 个可多选 + 1 个"全部"）：
  - 待处理（pending）
  - 处理中（processing + reopened 合并显示）
  - 已解决（resolved）
  - 已关闭（closed）
- 交互：
  - 单选变多选：状态组支持多选（与平台组保持一致：再点取消）
  - 顶部加"清空筛选"快捷按钮
- 计数 badge：每项右侧显示该状态下的未读/总数（mock 阶段从 conversations list 算）
- 文案：
  - "筛选"按钮在视图/平台之上还是之下？你定 —— **建议放在平台之下、列表之上**，层级是「视图 > 平台 > 状态」

#### 拆解
- **🟢 UI**：
  - `Conversations.vue` 模板新增 `<div class="filter-group">` 工单状态块
  - 每个状态项：dot + label + count badge
  - 多选交互：参照现有 platform 切换逻辑
- **🟢 数据逻辑**：
  - `currentTicketStatuses = ref(new Set())` （多选）
  - `filterCounts[STATUS.*]` 仿照现有 `filterCounts[VIEW.*]/[PLATFORM.*]` 模式，从 `imConversations + tickets store` 算
  - 视图/平台/状态组合过滤：把现有 `fetchConversations` 之后的 `imConversations` 再过一层 `tickets` 映射 filter
- **🟡 状态变化联动**：
  - 当 `ticket.js` store 某条工单 status 变化时，触发 `Conversations.vue` 的 `filterCounts` 重算（用 watch）

#### 验收
- 任意组合 3 维过滤生效，列表正确
- mock 阶段改一条工单 status，列表即时过滤+计数即时更新
- 状态组的"全部" = 三方标签都未选 = 不参与过滤

---

### T3 · 工单优先级 【P0】 🔴

#### 需求描述
工单有 4 档优先级，颜色/角标贯穿 header / 列表 / 状态栏。

#### 需求细化
- 默认 `medium`（管理员 setting 可改，本轮不做）
- header 左侧 4px 竖向色条（无色 = low 灰）
- header 名字旁小角标「高」「紧急」文字
- 列表卡片左侧 priority dot（6px）
- 修改入口：
  - header 左侧色条点击 → 4 选 1 popover
  - `ConversationMenu.vue` 右键"优先级" 子菜单
- 优先级变更写一条系统气泡

#### 拆解
- **🟢 UI**：
  - `ChatMain.vue` header 模板新增 priority bar（4px 竖条 + 文字）
  - `ChatMain.vue` 新增 `PriorityPopover.vue` 组件（4 色块）
  - `Conversations.vue` 列表卡片：左侧 dot
  - `ConversationMenu.vue` 右键菜单：新增"优先级"
  - `MessageTimeline.vue` 支持 priority_change 类型气泡
- **🟡 数据逻辑**：
  - `ticket.js` store 加 `priority` 字段
  - `src/services/ticket.js` 新增 `setPriority(ticketId, priority, operator)`
  - mock：工单 8 条，priority 分布按业务规则覆盖（urgent ≥ 1，high ≥ 2）
- **🔴 后端接口**：
  - `PATCH /jmate/tickets/:id` body `{ priority }`

#### 验收
- 4 档切换全部生效，色条 / 角标 / dot 同步
- 系统气泡文案正确
- mock 数据刷新页面后保留

---

### T4 · 会话标签（业务标签） 【P0】 🔴

#### 需求描述
管理员可定义"业务标签"（颜色 + 名称），客服给工单打/卸。
**不要**用 IM tag 协议存业务标签 —— 走前端 store + 后端业务表。

#### 需求细化
- 预置 5 个标签（VIP / 退换货 / 物流 / 投诉 / 需回访）见 §2 TICKET_LABEL
- header chip 区：工单当前标签们（多色 chip，可点 x 卸）+ "+" 加标签
- "+" 弹层：
  - 搜索框 + 全量列表
  - 列表项：色块 + 名称 + 选中态
  - 底部"创建新标签"入口（仅管理员，本轮**先不上**创建 UI，留 TODO）
- 列表卡片：底部 chip 列表（最多显示 3 个 + "+N"）
- 高级过滤器入口：`Conversations.vue` 状态组旁加"标签"按钮
  - 弹层：全量标签多选
  - 与现有 3 维组合（视图 ∩ 平台 ∩ 状态 ∩ 标签）
- 标签变化写系统气泡

#### 拆解
- **🟢 UI**：
  - `ChatMain.vue` header chip 区
  - 新增 `LabelPopover.vue`（搜索 + 多选 + 列表）
  - `Conversations.vue` 列表卡片底部 chips
  - `Conversations.vue` 高级过滤器弹层（新增第 4 维）
  - `MessageTimeline.vue` 支持 label_change 类型
- **🟡 数据逻辑**：
  - `src/mock/labels.js` 预置 5 个标签
  - `src/stores/label.js`（新建）—— 标签字典（id → 元信息）
  - `ticket.js` store 加 `label_ids: []`
  - `src/services/ticket.js`：
    - `addLabel(ticketId, labelId)`
    - `removeLabel(ticketId, labelId)`
    - `batchSetLabels(ticketId, addIds, removeIds)`
  - mock：工单 8 条，VIP 至少 2 条、退换货至少 2 条
- **🔴 后端接口**：
  - `GET /jmate/labels`
  - `POST /jmate/labels`（管理端）—— 本轮不上 UI
  - `POST /jmate/tickets/:id/labels` body `{ add: [], remove: [] }`

#### 验收
- 标签 CRUD（卸/加）本地闭环
- 4 维过滤组合生效
- 列表卡片 chip 与 header chip 同步
- 系统气泡文案：「小明 加了标签 #vip」「小明 移除了标签 #refund」

---

### T5 · 转派给 Agent 【P1】 🟡

#### 需求描述
header 右侧「转派」按钮 → 弹层选目标 Agent（用现有 mock agents 列表）→ 工单 assignee 变更，旧客服 my_ticket tag 释放、新客服 my_ticket tag 加上。

#### 需求细化
- header 按钮：处理中/待处理/重新打开 三态显示
- 转派弹层（`ReassignDialog.vue`，新建）：
  - 顶部搜索框
  - 列表：头像 + 名称 + 状态（在线/忙碌/离线）+ 当前工单数
  - 底部"备注"输入框（可选）
  - 确认 → 写系统气泡 + assignee 切换
- 转派后 header chip 显示「已转派给 X」3s 高亮
- 转派给原 assignee：阻止

#### 拆解
- **🟢 UI**：
  - `ChatMain.vue` header 按钮区
  - 新增 `ReassignDialog.vue`
  - `MessageTimeline.vue` 复用 reassign 类型
- **🟡 数据逻辑**：
  - `ticket.js` store 加 `assignee_id / assignee_name`
  - `src/services/ticket.js`：
    - `reassign(ticketId, toAgentId, note)`
    - 同步 `assignedTagConversations / myTicketTagConversations` 镜像（`im.js` 现有 API 调用）
  - mock：用现有 `__MOCK_AGENTS__` 列表
- **🔴 后端接口**：
  - `PATCH /jmate/tickets/:id` body `{ assignee_id, reassign_note? }`
  - 现有 `TICKET_CLAIM` 不够用（语义是"认领"不是"转派"）

#### 验收
- 转派后立即看到 chip 变化
- "我的"列表里旧客服移除、新客服出现
- 系统气泡文案正确（含备注）

---

### T6 · 内部备注（Internal Note） 【P1】 🟡

#### 需求描述
`MessageSender.vue` 顶部加「回复 / 备注」Tab 切换。备注消息流里渲染灰色气泡 + 📝 角标，**不**发到客户渠道（mock 阶段不真的过滤，仅 UI 标记）。

#### 需求细化
- Tab 切换：
  - "回复"（默认）：原行为
  - "备注"：textarea placeholder "添加内部备注（仅团队可见）"，发送按钮文案"添加备注"
- 气泡渲染：
  - 灰色背景（`#F5F5F5`），左侧 📝 图标 + "内部备注" 角标
  - hover 显示时间 + 操作人
  - 客户侧（同 Telegram 渠道）按 IM messageName 过滤
- mock 阶段：备注也走 `sendMessage` 走 IM 通道，仅在 UI 层标记

#### 拆解
- **🟢 UI**：
  - `MessageSender.vue` 顶部 Tab
  - 新增 `MessageNote.vue`（仿 `MessageText.vue`）
  - `MessageItem.vue` 分发新增 `note` 类型
- **🟡 数据逻辑**：
  - `MessageSender.vue` 新增 `editorMode = ref('reply' | 'note')`
  - 发送时消息 payload 携带 `editorMode`，到 `ChatMain` 落 `imMessages` 时用 type 区分
  - mock：工单 8 条里每条至少 1 条 note
- **🟡 后端接口**：
  - `POST /jmate/notes/:ticket_id`（IM 兜底通道，优先级低，本轮可不上）
  - IM 自定义消息 `jgm:note` —— mock 阶段用本地 type 模拟，等后端约定后再做 SDK 消息

#### 验收
- Tab 切换后按钮/placeholder 全部变化
- 备注气泡与回复气泡视觉区分明显
- 客户渠道过滤占位（mock 阶段弹个 console.warn）

---

### T7 · 解决/重开/关闭 全动作 【P0】（在 T1 内做）

> 已在 T1 拆解，这里单列强调：

- **解决**：
  - 弹"是否给客户发满意度评价"开关
  - mock 阶段 CSAT 钩子留 TODO（在 T8 详细做）
  - 二次确认：避免误触
- **重新打开**：
  - 已解决状态才显示
  - 弹"原因"输入（可选）+ 直接 reopen
- **关闭**：
  - 仅 `role=1`（管理员）显示
  - 二次确认
  - 写关闭原因（可选）

#### 拆解（独立于 T1 之外增加的）
- 新增 `ConfirmDialog.vue`（通用二次确认弹层）
- `MainView.vue` 接收 `handleResolveTicket` / `handleReopenTicket` / `handleCloseTicket` 事件
- 在 T1 service 里都接上

---

### T8 · CSAT 满意度 【P1】 🔴

#### 需求描述
客服在 T7「解决」时勾选"发 CSAT" → 客户侧收到 1-5 星评价卡 → 客户回复后客服侧气泡显示分数。

#### 需求细化
- 客服侧：resolve 弹层有 "给客户发满意度评价" 开关
- 客户侧：会话流出现一个特殊气泡（`MessageCSAT.vue`），5 颗星按钮 + 评论区
- 客服侧：客户回复后，气泡变成"已评价 N 星"
- mock 阶段：
  - 客服 resolve 时勾选 → 客服自己侧立即出现 CSAT 气泡（标"待评价"）
  - 在 mock 工具栏加一个"模拟客户回复 5 星"按钮，点一下 → 气泡变 "已评价 5 星"

#### 拆解
- **🟢 UI**：
  - 新增 `MessageCSAT.vue`（5 星 + comment + 状态）
  - 客服侧 ChatMain 头部右侧"模拟客户回复"调试按钮（仅 dev 环境，本轮 mock 必备）
- **🟡 数据逻辑**：
  - `ticket.js` store 加 `csat` 字段
  - `src/services/csat.js`（新建）：
    - `send(ticketId)` —— resolve 时触发
    - `respond(ticketId, score, comment)` —— 客户回复
    - `getStatus(ticketId)`
  - mock 工具栏：`MainView.vue` 加 `__MOCK_CSAT__` 按钮（仅 dev）
- **🔴 后端接口**：
  - `GET /jmate/csat/:ticket_id/status`
  - `POST /jmate/csat/:ticket_id/response` body `{ score, comment? }`

#### 验收
- resolve 勾选 → 气泡出现
- 模拟回复 → 气泡状态切换
- 状态在 ticket store 里持久

---

### T9 · 维度组合的会话列表 + 排序优化 【P0】 🟢

#### 需求描述
接入 T1-T4 后，3 维（视图/平台/状态）+ 1 维（标签）的组合需要在前端正确过滤。T9 本身不引入新功能，是 T1-T4 之后的**集成验证任务**。

#### 拆解
- **🟢 数据逻辑**：
  - `Conversations.vue` 抽出 `applyFilters(list)` 纯函数：4 维交集
  - 加 `sortBy`: 'updated_desc'（默认）/ 'priority_desc' / 'created_asc'
  - 列表头部加排序切换
- **🟢 UI**：
  - 列表 header 加排序 dropdown

#### 验收
- 任意 4 维组合 + 排序生效
- 性能：mock 1000 条数据下过滤 < 50ms

---

## 4. mock 数据约定

> 全部集中在 `src/mock/`，文件清单：

```
src/mock/
├── tickets.js          // 8 条工单（覆盖 5 状态 × 3 平台 × 4 优先级 × 5 标签）
├── labels.js           // 5 个预置标签（vip/refund/logistics/complaint/follow_up）
├── csat.js             // 4 条 CSAT 响应（2 pending + 2 completed）
└── README.md           // mock 怎么接真接口
```

每个 mock 文件导出 `code: 0, msg: 'success', data: ...` 形态（与现有 `__MOCK_AGENTS__` 一致），service 层用 `setTimeout` 模拟网络延迟。

接真接口的标准替换模式（保留 TODO 注释）：
```js
// TODO(接入): 走真接口时把这一行改回 `const res = await get(SERVER_PATH.TICKET_DETAIL(id))`
const res = await new Promise(resolve => setTimeout(() => resolve(MOCK_TICKETS[id]), 50))
```

---

## 5. 状态联动图

```
         ┌────────────────────────────────────────────────────────────┐
         │                  ticket.js store (single source)            │
         │  { ticket_id → { status, priority, label_ids, assignee } } │
         └────────┬──────────────┬──────────────┬────────────┬────────┘
                  │              │              │            │
        ┌─────────▼──────┐ ┌────▼──────┐ ┌─────▼──────┐ ┌───▼────────┐
        │ Conversations  │ │ ChatMain  │ │ System     │ │ Tag mirror │
        │ filter / count │ │ header    │ │ bubble     │ │ im.js      │
        └────────────────┘ └───────────┘ └────────────┘ └────────────┘
                  ▲
                  │ 用户操作
                  │
        ┌─────────┴──────────┐
        │ services/ticket.js │
        │ (状态机 + 副作用)  │
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │ mock / 后端接口    │
        │ (TODO 替换点)      │
        └────────────────────┘
```

---

## 6. 文件改动清单

### 6.1 新增
```
src/mock/
├── tickets.js
├── labels.js
└── csat.js

src/stores/
├── ticket.js       // 工单 store
└── label.js        // 标签字典

src/services/
├── ticket.js       // 状态机 service
└── csat.js         // CSAT service

src/components/
├── ReassignDialog.vue
├── LabelPopover.vue
├── PriorityPopover.vue
├── ConfirmDialog.vue
├── StatusChip.vue         // 复用：渲染 status 文字+色
├── PriorityBar.vue        // 复用：渲染 priority 4px 条
└── message/
    ├── MessageCSAT.vue
    └── MessageNote.vue
```

### 6.2 修改
```
src/common/enum.js        // 加 TICKET_STATUS / TICKET_STATUS_META / TICKET_PRIORITY / TICKET_PRIORITY_META
src/components/Conversations.vue   // T2 状态维度 / T4 标签维度 / T9 排序
src/components/ChatMain.vue        // T1 状态 chip / T3 priority bar / T5 转派按钮 / T7 状态动作
src/components/ConversationMenu.vue // T1/T3/T4 右键菜单
src/components/MessageSender.vue   // T6 备注 Tab
src/components/MessageItem.vue     // 分发 csat / note
src/components/MessageTimeline.vue // system action 子类型
src/views/MainView.vue             // 接收新事件、挂载新弹层
```

---

## 7. 验收节奏

| Sprint | 任务 | 累计 |
|---|---|---|
| **S1** | T1 状态机 + T9 集成骨架 | 工单能跑通 5 态 |
| **S2** | T2 状态筛选维度 + T3 优先级 | 列表维度扩到 3 个 |
| **S3** | T4 标签 + 4 维过滤 | 列表维度扩到 4 个 |
| **S4** | T5 转派 + T6 备注 + T7 解决/重开/关闭 | 工单协作闭环 |
| **S5** | T8 CSAT + 联调 | 评价闭环 |

每个 sprint 结束 = 一次"看 demo"节点。

---

## 8. 后端接口契约清单

> 这一节是后端实现依据。**前端 mock 阶段不真发请求**，但 service 层会按这个 schema 调 `request()`，等后端就位把 `setTimeout` 替换即可。

### 8.1 通用约定

**请求**：
- Header：`Authorization: <token>`、`AppKey: <app_key>`、`Content-Type: application/json`
- Body：JSON

**响应**：
```json
{ "code": 0, "msg": "success", "data": { ... } }
```

**错误码**（接现有 `ERROR_CODE`）：
| code | 含义 |
|---|---|
| 0 | 成功 |
| 17001 | 参数错误 |
| 17009 | 工单不存在 |
| 17010 | 无权操作（非 assignee / 非管理员） |
| 17011 | 状态机非法转换（如 closed → reopened） |
| 17012 | 标签不存在 |
| 17013 | CSAT 已存在（重复提交） |
| 17014 | 转派目标 = 当前 assignee |

### 8.2 工单基础

#### GET /jmate/tickets/list
- Query：`status`（可选，pending|processing|resolved|closed|reopened） / `assignee_id` / `platform` / `q`（关键词） / `page` / `size`
- 响应：
```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "ticket_id": "tk_001",
        "conversation_key": "1_42",
        "status": "processing",
        "priority": "high",
        "assignee_id": "u_007",
        "assignee_name": "小红",
        "team_id": null,
        "label_ids": ["vip", "refund"],
        "csat": null,
        "resolved_at": null,
        "reopen_count": 0,
        "platform": "telegram",
        "last_message_preview": "请问订单什么时候发货？",
        "created_at": 1730000000,
        "updated_at": 1730000050
      }
    ],
    "total": 8,
    "page": 1,
    "size": 20
  }
}
```
> 注：现有 `TICKET_LIST` 接口已存在，本轮升级为支持上述过滤参数（**不新增接口，只扩展**）。

#### GET /jmate/tickets/:id
- 响应：
```json
{
  "code": 0,
  "data": {
    "ticket_id": "tk_001",
    "conversation_key": "1_42",
    "status": "processing",
    "priority": "high",
    "assignee_id": "u_007",
    "assignee_name": "小红",
    "team_id": null,
    "label_ids": ["vip", "refund"],
    "csat": { "score": 5, "comment": "很满意", "at": 1730000100 },
    "resolved_at": null,
    "reopen_count": 0,
    "created_at": 1730000000,
    "updated_at": 1730000050
  }
}
```

### 8.3 工单状态变更

#### POST /jmate/tickets/:id/resolve  【T1/T7/T8】
- Body：
```json
{ "send_csat": true, "note": "已为客户办理退款" }
```
- 响应：`{ code: 0, data: { status: "resolved", resolved_at: 1730000100 } }`
- 副作用（后端实现）：改 status、release assigned/my_ticket tag、广播 `jgm:ticket_resolved` IM 消息、（如 send_csat=true）广播 `jgm:csat` 卡片

#### POST /jmate/tickets/:id/reopen  【T1/T7】
- Body：`{ "reason": "客户有补充问题" }`
- 响应：`{ code: 0, data: { status: "reopened", reopen_count: 1 } }`
- 副作用：改 status、新增 reopen_count、重新 add tag、广播 `jgm:ticket_reopened` 消息

#### POST /jmate/tickets/:id/close  【T1/T7】
- Body：`{ "reason": "超时关闭" }`（管理员操作时必填）
- 响应：`{ code: 0, data: { status: "closed" } }`
- 副作用：改 status、release tag、广播 `jgm:ticket_closed` 消息

#### POST /jmate/tickets/:id/release  【T1】
- Body：`{}`
- 响应：`{ code: 0, data: { status: "pending", assignee_id: null } }`
- 权限：仅管理员（role=1）

### 8.4 工单字段更新

#### PATCH /jmate/tickets/:id  【T3 优先级 / T4 标签 / T5 转派】
- Body（**所有字段可选**）：
```json
{
  "priority": "urgent",                       // 改优先级
  "add_label_ids": ["vip"],                   // 加标签
  "remove_label_ids": ["refund"],             // 卸标签
  "assignee_id": "u_008",                     // 转派
  "reassign_note": "VIP 客户麻烦先看"          // 转派备注
}
```
- 响应：`{ code: 0, data: { /* 更新后的完整工单 */ } }`
- 副作用：广播 `jgm:priority` / `jgm:label` / `jgm:ticket_reassign` 消息

### 8.5 标签字典

#### GET /jmate/labels  【T4】
- Query：`account_id`（隐含从 token 取）
- 响应：
```json
{
  "code": 0,
  "data": {
    "items": [
      { "id": "vip", "name": "VIP 客户", "color": "#FF2442", "description": "高价值客户" },
      { "id": "refund", "name": "退换货", "color": "#FF8800", "description": "" }
    ]
  }
}
```

#### POST /jmate/labels  【预留，本轮不上 UI】
- Body：`{ "name": "新标签", "color": "#07C160", "description": "" }`
- 响应：`{ code: 0, data: { "id": "label_xxx", ... } }`

### 8.6 CSAT

#### GET /jmate/csat/:ticket_id/status  【T8】
- 响应：
```json
{ "code": 0, "data": { "status": "pending" | "completed", "score": 5, "comment": "...", "at": 1730000100 } }
```

#### POST /jmate/csat/:ticket_id/response  【T8】
- Body：`{ "score": 5, "comment": "很满意" }`
- 响应：`{ code: 0, data: { "status": "completed", "score": 5 } }`
- 错误码：17013（已存在）

### 8.7 IM 自定义消息（占位，后端约定后再上）

> 这一轮**不接 IM 广播**，仅在 store 里模拟。等后端 IM 消息协议确定后接入。

| 消息名 | 触发时机 | payload 字段 |
|---|---|---|
| `jgm:priority` | 优先级变更 | `ticket_id, old, new, operator` |
| `jgm:label` | 标签变更 | `ticket_id, added[], removed[], operator` |
| `jgm:ticket_reassign` | 转派 | `ticket_id, from, to, note?` |
| `jgm:ticket_resolved` | 解决 | `ticket_id, send_csat, operator` |
| `jgm:ticket_reopened` | 重开 | `ticket_id, reason?, operator` |
| `jgm:ticket_closed` | 关闭 | `ticket_id, reason?, operator` |
| `jgm:csat` | 客服发满意度卡 | `ticket_id, survey_id` |
| `jgm:csat_response` | 客户回复 | `ticket_id, score, comment?` |
| `jgm:note` | 内部备注 | `ticket_id, content, operator` |
| `jgm:participant` | 围观者变化 | `ticket_id, added[], removed[]`（远期） |

---

## 9. 不在范围（明确划走）

- SLA 策略 / 倒计时
- 报表（Nav `data` tab）
- 团队管理（Nav `team` tab）
- 知识库 / Help Center
- 自动化规则
- Campaigns / 主动外呼
- 围观者（抄送）
- 跨设备 IM 实时同步（mock 阶段只在本机闭环）

---

