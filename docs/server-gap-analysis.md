# JuggleMate Server × 客服需求差距分析（修正版）

> 配套文档：
> - `/Users/helena/Downloads/chatwoot-项目分析报告(1).md`（竞品定位基线）
> - `docs/customer-support-flow-design.md`（需求主线 + 流程图 + 时序图）
> - `docs/customer-support-frontend-iteration-plan.md`（前端 9 个任务 + 接口契约）
> - `docs/sprint-1-frontend-impl-points.md` / `docs/sprint-1-backend-contract.md`（Sprint 1 设计稿）
>
> **注意**：本分析为方便 desktop 端同学同步进度而放在 `jugglemate-desktop/docs/`，**最终请同步到 `jugglemate-server/docs/`**。
>
> **v2 修订**：第一次分析把"建群 + 建 ticket"等同于"客服入会话闭环"，**掩盖了几个关键缺失**：①没有按渠道配置注入 agent；②群成员是粗粒度（全 inbox）；③客户在 resolved/closed 后再发消息不会触发 reopen / 新工单；④没有 CSAT / 自动分配 / 状态机扩 5 态。
>
> **v3 修订（2026-07-13）**：
> 1. **状态机精简到 4 态**（去 closed）—— closed 字段保留作隐藏终态，前端 UI 完全不可见
> 2. **`PATCH /tickets/:id/status`** 通用状态变更接口替代 resolve/reopen/close/release 4 个独立接口
> 3. **`POST /tickets/:id/transfer`** 工单转移接口（合并 reassign）
> 4. 新增 **3 个 Agent 接口**（available / online / stats）
> 5. 新增 **2 个 Customer 接口**（detail / sessions）
> 6. 新增 **前端用户信息模块**
>
> 最新最详细实现稿见 `sprint-1-revised-frontend.md` / `sprint-1-revised-backend.md`。
>
> 目的：**盘点现状 → 找重合/缺失 → 给出闭环 MVP 的优先级清单**。**不动代码**。

---

## 0. TL;DR 一句话总结

> **Server 有 IM 群 / tag / claim CAS / Bot 分身基础设施可用**，但**没有"客户发起 → 按渠道策略 → AI 或人工 → 处理 → 解决 → 重开"这条主线的关键判断逻辑**。
>
> 修正后的判断：
> - **可用底层能力**（IM 群、tag、CAS、Bots、Session、Feedback）≈ 40%
> - **可用的客服业务主线流程** ≈ 10%（只有 claim + 建群 + 建 ticket 3 个步骤是闭环的）
> - **缺的核心主线**：渠道配置表、agent 自动注入、群成员粒度控制、状态机扩 5 态、客户状态判定（resolved/closed 后再发消息）、CSAT、自动分配
>
> **MVP 闭环 = 后端 18 人天 + 前端 7.5 人天**，跨 4 个 Sprint。
> **Sprint 1（修订版）**：后端 5.4 人天（精简到 4 态 + transfer + 6 个新接口）+ 前端 5.5 人天（含用户信息模块）。

---

## 1. Server 现状盘点（基于真实代码读出）

### 1.1 用户 / 鉴权 ✅

| 能力 | 文件 | 备注 |
|---|---|---|
| 用户登录 / 注册 | `apis/user.go` | 返回 user_id / role / authorization / im_token |
| 角色定义 | `storages/models/user.go` | `UserRoleCustomerService=1`、`UserRoleAdmin=2` |
| 控制台账号 CRUD | `console/apis/*` | 已有 |

✅ **可复用**：登录接口、角色枚举、`apis.Validate` 中间件。

### 1.2 客户入会话（startCustomerTicket）⚠️ 关键路径，但只有"建群 + 建工单"骨架

```go
// services/customerservice.go::startCustomerTicket
// 现状做的事（按顺序）：
//  1. 根据 identifier 找/建 customer
//  2. 查 inbox + 校验渠道类型
//  3. 找/建 customer_inbox_rel（绑定 sourceId = customer_<uuid>）
//  4. 注册 IM 用户（用 sourceId）
//  5. FindBySource 查 ticket，nil 则建 IM 群（成员 = 客户 + 所有 inbox 成员）+ 建 ticket(pending)
//  6. 返回 customer / inbox / rel / ticket / im_token
```

✅ 已做：
- 自动 upsert customer / rel / ticket
- IM 群建群（`TicketId` 直接当 `GroupId`）
- IM 用户注册（用 `sourceId`）

❌ **未做（vs 您的需求）**：
- **没有读渠道配置**（不存在 `channel_configs` 表，Inbox.ChannelConf 是字符串）
- **没有"按渠道是否配置 agent"分流**：不查 default_agent，不调 `aibots.CreateSession`
- **群成员粒度粗**：所有 inbox 成员都被拉进群，不是您要的"认领时拉特定人"
- **没有状态判定**：客户在 resolved/closed 后再发消息，不会触发 reopen 或新建工单
- **没有 welcome message 路由逻辑**（除了 widget 渠道读 `WelcomeMessage`，其他渠道没有）

### 1.3 工单认领（Claim） ✅ 优秀，可直接复用

| 能力 | 文件 | 备注 |
|---|---|---|
| Claim 接口 | `apis/ticket.go::ClaimTicket` → `services/ticketservice.go::ClaimTicket` | **关键路径已有** |
| Claim 存储原子化 | `ClaimIfPending` | SQL CAS：`UPDATE WHERE status=pending`，**自带抢单防护** |
| Claim 回滚 | `RevertClaimIfAssignee` | IM tag 失败时回滚 DB |
| 通知消息 | `SendTicketAssignedNtfMsg` | 群消息 `jgm:ticketassign` |

✅ **可复用**：claim 的 CAS + 回滚已经是 Chatwoot 级别的优雅实现。

⚠️ **不修改群成员**：claim 时**不**把坐席加进群（因为已经在群里了）。这跟您期望的"认领时拉特定人"不一致。

### 1.4 IM 群组机制 ✅

```go
// createGroupForCustomer
juggleimsdk.GroupMembersReq{
    GroupId:   ticketId,        // TicketId = GroupId
    GroupName: nickname,
    MemberIds: memberIds,       // [sourceId（客户）] + inbox_member_ids
}
```

✅ **可用**：
- 群组创建
- `sendGroupMsg` 发群消息
- tag 操作（add/remove conversation from tag）

⚠️ **缺**：
- **动态增删成员**：没有"认领时把某人加进群 / 释放时把某人踢出群"的 API 调用
- **观望者（抄送）**：完全没做
- **解散群**：close 后是否解散群？没看到对应逻辑

### 1.5 AI Bot 分身 + Agent Session ⚠️ Bot 基础齐了，Session 流程完全没接入 webhook

| 能力 | 文件 | 备注 |
|---|---|---|
| 分身 CRUD | `apis/bot.go`、`services/aibotservice.go` | 全套 add / update / remove / list |
| 素材管理 | 同上 | text / url / file |
| 训练 + 版本 | 同上 | `StartTraining / ListJobs / ListVersions / ActivateVersion` |
| Agent Client | `commons/agentclient/agentclient.go` | LLM 调用客户端 |

✅ **Bot 基础设施齐全**。

❌ **Session 与 webhook 没联动**：
- 现状：`CreateSession` 只能由坐席端主动调
- 您要的：客户发起 → webhook 触发 → 自动 `CreateSession` 注入默认 agent → agent 给建议 / 接管
- 差距：webhook 里**没有任何调用 `aibots.CreateSession` 的代码**

### 1.6 Agent Session / Feedback ✅✅

| 能力 | 文件 | 备注 |
|---|---|---|
| Session 创建 / 查找 / 详情 | `apis/handlers/session.go` | `POST /aibots/sessions`、`GET /aibots/sessions/lookup` |
| Session 切换 agent | `UpdateSessionAgent` | ✅ 您要的"切换 agent" |
| Session 托管 / 收回 | `TakeoverSession`（auto_mode） | ✅ 您要的"agent 托管" |
| Session 聊天 | `SessionChat` | LLM 流式回复（建议） |
| Feedback | `SubmitFeedback` | adopted / edited / rejected（AI 训练反馈，**不是 CSAT**） |

✅ **Agent 协同 + 切换 + 托管全有**，前端 AgentPanel 事件都对得上。

⚠️ **Feedback ≠ CSAT**：两个完全不同的概念（一个是给 AI 训练打分，一个是客户满意度），当前没有 CSAT。

### 1.7 路由 / 中间件 ✅

| 路径前缀 | 中间件 | 说明 |
|---|---|---|
| `/jmate/*` | `corsHandler` + `apis.Validate` | 客服端 API |
| `/jmate/webhooks/telegram/:inbox_id` | 无 | Telegram 渠道 webhook |
| `/jmate/webhooks/juggleim/:inbox_id` | 无 | JuggleIM 渠道 webhook |
| `/jmate/webhooks/message` | 无 | 通用消息 webhook |
| `/botmsgs/msgcallback` | 无 | IM 消息回调 |

### 1.8 数据存储

已有：`tickets / customer / customer_inbox_rel / inbox / inbox_member / user / agent_* / agent_session / agent_feedback / agent_material / agent_job / agent_version / agent_evaluation`

**缺**：`channel_configs / ticket_status_logs / ticket_claim_logs / label / csat_survey_response / agents 扩展字段`

---

## 2. 关键模型对位（您的需求 vs Server 现状）

| 您的需求（flow-design §6） | Server 现状 | 差距 |
|---|---|---|
| 客户发起 → 查渠道 default_agent | webhook **完全不查渠道配置** | ❌ **完全缺** |
| 有 agent → 自动注入 Session → agent 协同/接管 | webhook **不调 CreateSession** | ❌ **完全缺** |
| 无 agent → 入"待处理池" → 坐席认领 | 有"待处理"语义（pending + exceptTag=assigned），但**所有 inbox 成员都被拉进群** | ⚠️ **部分缺** |
| 客服处理：默认 agent + 可切换 | `UpdateSessionAgent` **已实现** | ✅ |
| 客服处理：托管 / 收回 | `TakeoverSession` **已实现** | ✅ |
| 解决 → 状态 resolved → 发 CSAT 卡 | 没有 resolve 接口，没有 CSAT | ❌ **完全缺** |
| 客户在 resolved/closed 后发消息 → 重开 / 新工单 | webhook **直接复用旧 ticket**，不判断状态 | ❌ **完全缺** |
| 5 态：pending/processing/resolved/closed/reopened | 3 态：pending/processing/closed | ❌ **缺 2 态** |
| 抢单乐观锁 | `ClaimIfPending` SQL CAS | ✅ |
| `assigned` / `my_ticket` tag | 已实现 | ✅ |
| `jgm:ticketassign` 通知 | 已实现 | ✅ |
| 渠道配置表（default_agent / mode / assignment_rule / timeouts） | **不存在** | ❌ **完全缺** |
| 客户入会话（建群） | 已实现（**全 inbox 成员**） | ⚠️ **粒度不对** |
| 工单 detail 接口 | 不存在（list 拿简化版） | ❌ 缺 |
| resolve / reopen / close / release 接口 | **不存在** | ❌ **完全缺** |
| auto-assign / auto-close cron | **不存在** | ❌ **完全缺** |
| 状态变化 IM 消息（resolved/reopened/closed） | 只实现 `jgm:ticketassign` | ❌ **缺 5 种** |
| CSAT 评价（客服发卡 + 客户回复） | **不存在** | ❌ **完全缺** |
| 标签（vip/refund/logistics/...） | 不存在 | ❌ Sprint 4+ |
| 转派 | 不存在（claim 只支持自我认领） | ❌ Sprint 4+ |
| 备注（NOTE 模式） | 不存在 | ❌ Sprint 4+ |
| 优先级 | 不存在 | 📌 暂搁 |

---

## 3. 现状「重合」清单

### 3.1 路径级别对齐

| 前端 SERVER_PATH | Server 接口 | 状态 |
|---|---|---|
| `USER_LOGIN` | `POST /jmate/user/login` | ✅ |
| `AGENT_MYBOTS` | `GET /jmate/aibots/mybots` | ✅ |
| `AGENT_SESSION_*`（6 个） | `/aibots/sessions/*` 全套 | ✅ |
| `TICKET_LIST` | `GET /jmate/tickets/list` | ✅ |
| `TICKET_CLAIM` | `POST /jmate/tickets/:ticket_id/claim` | ✅ |
| `Customer.Start` | `POST /jmate/customers/start` | ✅ 但**没接 Agent Session 注入** |

### 3.2 IM 协议对齐

- `jgm:ticketassign` — Server 已发，前端 `MessageTicketAssign.vue` 已渲染 ✅
- `assigned` / `my_ticket` tag — Server 已 tag，前端 `im.js` 已订阅 ✅
- `IM_TOKEN` 注册 — `registerIMUser` / `registerCustomerIMUser` 已就绪 ✅
- `IM 群组 = TicketId` — Server 用 `TicketId` 直接当 `GroupId` ✅

### 3.3 数据库层对齐

- `User.Role` 枚举（1=客服 / 2=管理员） → 您要的"管理员可关闭/释放"直接用
- `Inbox.ChannelType` → 您要的"按渠道配置 agent"基础在（结构化存储需新增表）

---

## 4. 现状「不一致 / 矛盾」清单

### 4.1 客户发起时完全没有 agent 分流（最关键）

```go
// 现状：TelegramWebhook / JuggleIMWebhook → startCustomerTicket
//   - 查 customer → upsert
//   - 查 inbox → 校验
//   - 建 IM 群（含所有 inbox 成员）
//   - 建 ticket(pending)
//   - sendMsg 进群
//   - 返回 im_token 给客户
//   - **结束。不查渠道 agent 配置，不建 Session**
```

**对比您的需求**：
```
客户发起 → 创建会话 → 查渠道配置 default_agent
  ├─ 有 → 自动注入 Session → agent 协同/接管
  └─ 无 → 纯人工模式 → 入"待处理池"
```

**Server 现在一律走"无 agent"分支**，**不管渠道配没配**。

### 4.2 群成员粒度不对（次关键）

**现状**：`createGroupForCustomer` 把**所有 inbox 成员**都拉进群。

**您想要的**：
- 客户发起时只拉入"指定坐席或全组"（按渠道策略）
- 认领时再加特定人进群
- 转派时改群成员

**差距**：Server 没有"动态增删群成员"的调用（看代码：`MemberIds` 一次性传入建群后没看到 add/remove）。

### 4.3 客户在 resolved/closed 后再发消息 = 静默丢失 reopen 机会

```go
// 现状：TelegramWebhook
ticket, _ := ticketStorage.FindBySource(appkey, rel.SourceId)
if ticket == nil { /* 建新工单 */ }
// 否则直接 sendMsg 进旧群（不判断 status）
```

**对比您的需求**：
> "客户可以评价，也可以重新开启。重新开启进入待处理状态。"

**Server 现状**：
- resolved 后客户发消息 → 进旧群，但 ticket.status 还是 resolved
- closed 后客户发消息 → 进旧群，但 ticket.status 还是 closed
- **没有 reopen 逻辑**，**没有"算新工单"逻辑**

### 4.4 没有渠道配置表

Server 当前的 `Inbox.ChannelConf` 字段是**字符串**：
```go
type Inbox struct {
    ChannelConf string  // 散在字符串里
}
func ParseJuggleIMChannelConf(s string) *JuggleIMChannelConf { ... }
func ParseWebWidgetChannelConf(s string) *WebWidgetChannelConf { ... }
func ParseTelegramChannelConf(s string) *TelegramChannelConf { ... }
```

您要的 `default_agent_id / default_mode / assignment_rule / auto_claim_timeout_min / csat_enabled` **没有任何字段在表里**。

### 4.5 状态枚举不一致

```
Server 现状（Go）：
  TicketStatusPending=0, TicketStatusProcessing=1, TicketStatusClosed=2
前端 Sprint 1 设计稿（Vue）：
  TICKET_STATUS = { PENDING:'pending', PROCESSING:'processing', RESOLVED:'resolved', CLOSED:'closed', REOPENED:'reopened' }
您需求（flow-design §6）：
  5 态
```

**冲突**：
1. Server int (0/1/2) vs 前端 string — **不一致**
2. Server 没有 `Resolved` 和 `Reopened` —— 缺 2 态
3. **`Resolved` 必须新增到 Server**：因为 resolve 后 72h 没动作才 close，需要中间过渡态

**建议方案**：
- Server 加 `TicketStatusResolved=3, TicketStatusReopened=4`
- 前端按 Server 状态码 0/1/2/3/4 映射 5 个中文 label
- Sprint 1 设计稿的 string enum 改成数字 enum 或加映射表

### 4.6 没有 cron / job 框架

Go Server 当前没有常驻 cron 框架（看 `main.go`），只启动 HTTP server。Sprint 2 的 auto_assign_job / auto_close_job / csat_expire_job / stale_release_job 需要引入 `robfig/cron` 或类似。

---

## 5. 闭环 MVP 拆解（修正版）

### 5.1 闭环定义（MVP）

> **从客户首条消息 → 按渠道策略（AI 或人工）→ 客服处理 → 解决 → 发 CSAT 卡 → 客户评价或重开**全跑通。
>
> 不含：标签、转派、备注、自动分配 UI（仅 cron 兜底）、团队管理、报表、SLA、动态群成员管理。

### 5.2 Sprint 拆分（修正版）

#### Sprint 1：状态机扩 5 态 + 基础接口（后端 5 人天 / 前端 2 人天）

**后端**：

| # | 任务 | 文件 | 工作量 |
|---|---|---|---|
| B1 | `Ticket.Status` 扩展：加 `Resolved=3, Reopened=4` | `storages/models/ticket.go` | 0.2d |
| B2 | DB migration：新 enum + 加 `version` / `csat_status` / `reopen_count` / `closed_*` / `pending_start_at` 字段 | `commons/dbcommons/sqls/` | 0.5d |
| B3 | `Resolved` / `Reopened` / `Closed` / `Released` 转换的 storage 方法 | `storages/dbs/` | 0.8d |
| B4 | `POST /jmate/tickets/:id/resolve` | `apis/ticket.go` + `services/ticketservice.go` | 0.5d |
| B5 | `POST /jmate/tickets/:id/reopen` | 同上 | 0.4d |
| B6 | `POST /jmate/tickets/:id/close` | 同上 | 0.3d |
| B7 | `POST /jmate/tickets/:id/release` | 同上 | 0.3d |
| B8 | `GET /jmate/tickets/:id` 详情接口 | 同上 | 0.3d |
| B9 | 5 种 IM 自定义消息：resolved/reopened/closed/auto_assigned/auto_closed | `services/notifyservice.go` | 0.7d |
| B10 | Webhook 改造：客户在 resolved/closed 后发消息 → 触发 reopen 或新建工单 | `services/juggleimwebhookservice.go` + `telegramwebhookservice.go` | 1.0d |

**前端**：直接复用 `sprint-1-frontend-impl-points.md`

#### Sprint 2：渠道配置 + agent 自动注入（后端 6 人天 / 前端 2 人天）⚠️ 关键 Sprint

**后端**：

| # | 任务 | 文件 | 工作量 |
|---|---|---|---|
| B11 | 新表 `channel_configs` + migration | `commons/dbcommons/sqls/` | 0.5d |
| B12 | `GET /jmate/channels/config` 接口 | `apis/channels.go` (新) + `services/channelservice.go` (新) | 0.5d |
| B13 | **Webhook 改造**：客户发起时读 channel_configs.default_agent → 自动调 `aibots.CreateSession` 注入默认 agent | `services/juggleimwebhookservice.go` + `telegramwebhookservice.go` | 1.5d |
| B14 | 改造 webhook：客户在 pending 时发消息不创建新会话（已存在），但确保消息正确路由 | 同上 | 0.3d |
| B15 | 群成员动态管理：建群时只拉入"渠道默认坐席组"，不拉所有 inbox 成员 | `services/customerservice.go` | 0.8d |
| B16 | 接入 `robfig/cron` 框架 | `main.go` | 0.3d |
| B17 | auto_assign_job（每 1 分钟，pending 超 15min 自动分配 least_busy） | 新增 `jobs/auto_assign_job.go` | 0.6d |
| B18 | auto_close_job + stale_release_job（每 10 分钟） | 新增 | 0.6d |
| B19 | csat_expire_job（每 1 小时） | 新增 | 0.3d |
| B20 | console 端：渠道配置管理 UI（管理员可配 default_agent / assignment_rule / 超时时长） | `console/apis/` | 0.6d |

**前端**：
- 启动拉 channel_configs 缓存
- 处理 IM 状态消息的气泡渲染
- console 端的渠道配置管理页（如果 B20 做了）

#### Sprint 3：CSAT 闭环（后端 3 人天 / 前端 1.5 人天）

**后端**：
- `csat_survey_responses` 表 + migration
- `POST /jmate/tickets/:id/resolve` 加 `send_csat` 开关
- `POST /jmate/csat/:ticket_id/response` 接口
- `GET /jmate/csat/:ticket_id/status` 接口
- 评价卡消息（`jgm:csat`）+ 客户回复消息（`jgm:csat_response`）

**前端**：
- resolve 弹层加 "发评价卡" 开关
- 客户评价卡气泡（`MessageCSAT.vue`）
- 客服侧显示评分

#### Sprint 4：动态群成员 + 转派 + 备注（后端 4 人天 / 前端 2 人天）

**后端**：
- IM 群 add/remove member API
- 转派：`PATCH /jmate/tickets/:id` body `{assignee_id, reassign_note}`
- 备注：IM 自定义消息 `jgm:note`
- 渠道 webhook：客户在 closed 后发消息 → 创建新工单（不是 reopen）

**前端**：
- 转派弹层
- 备注 Tab + 灰色气泡
- 群成员变更 UI

### 5.3 总估（修正版）

| Sprint | 后端 | 前端 | 合计 | 交付物 |
|---|---|---|---|---|
| S1 | 5d | 2d | 7d | 5 态工单 + webhook 状态判定 |
| S2 | 6d | 2d | 8d | 渠道配置 + agent 自动注入 + 自动分配兜底 |
| S3 | 3d | 1.5d | 4.5d | CSAT 闭环 |
| S4 | 4d | 2d | 6d | 转派 / 备注 / 动态群成员 |
| **合计** | **18d** | **7.5d** | **25.5d** | **MVP 闭环** |

> **注意**：第一次估算的 12 人天严重偏低，**没有把 Sprint 2 的 agent 自动注入和动态群成员算进去**。

---

## 6. 与 Chatwoot 的对位

| Chatwoot 能力 | 我们 MVP | 备注 |
|---|---|---|
| 统一收件箱（多渠道） | ✅ 已有 | Telegram / JuggleIM / Widget 三渠道 |
| 按渠道配置 agent | Sprint 2 | 缺 |
| 标签 | Sprint 4+ | MVP 不含 |
| 预设回复 | MVP 不含 | Sprint 5+ |
| 自动分配（轮询/容量） | Sprint 2 简化版（least_busy） | |
| 自动化规则 | MVP 不含 | 远期 |
| 知识库（Help Center） | 不做 | JuggleChat 没这概念 |
| 报表 | 不做 | 远期 |
| SLA | 不做 | 您明确暂搁 |
| CSAT | Sprint 3 | |
| AI Copilot（Captain） | ⚠️ 已有近似 | Agent Session / Feedback 是 JuggleChat 差异化 |
| 私有部署 | ✅ Go 单体 | 比 Rails 更轻 |
| SSO / SAML | 不做 | 不在 MVP 范围 |

**我们的差异化**：
- AI 原生（Session 体系内置免费，Chatwoot Captain 收费）
- IM 原生（群 = 工单天然支持多人协作）
- 更轻量（单 Go 二进制）

**我们的劣势**：
- 没有 Plugin 体系
- 没有企业级 SSO / SLA / 审计
- 报表 MVP 完全缺
- 起步阶段

---

## 7. 优先级决策树

```
                     ┌─────────────────────────────────┐
                     │  目标：客服 MVP 闭环（4 个 Sprint） │
                     └────────────────┬────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
   ┌─────────┐                  ┌──────────┐                  ┌──────────┐
   │ Sprint1 │                  │ Sprint2  │                  │ Sprint3  │
   │  必做    │ ────────────────►│  必做     │ ────────────────►│  必做    │ ...
   │ 5d 后端  │  没 S1 做容器    │ 6d 后端   │  没 S2 客户发起  │ 3d 后端  │
   └─────────┘  下游全跑不动     │ agent 不   │  这条主线不闭环  │ CSAT    │
                                │ 自动注入   │                  └──────────┘
                                └──────────┘
```

---

## 8. 风险与决策点

### 8.1 必须您拍板的（修正）

| # | 决策点 | 建议 | 影响 |
|---|---|---|---|
| 1 | ~~Server `Ticket.Status` 扩展方向~~ | ✅ **v3 已决议**：4 态 + closed=99 隐藏 | 已确定 |
| 2 | 客户在 resolved 后发消息 → 重开 vs 新工单 | 7 天内 = 重开，7 天后 = 新工单 | Webhook 加判断（B10） |
| 3 | 客户在 closed 后发消息 → 重开 vs 新工单 | **新建工单**（closed 是最终态） | Webhook 加判断（Sprint 4） |
| 4 | resolve 后客户多久不响应自动 close | 72h | auto_close_job 阈值 |
| 5 | auto-assign 兜底时长 | 15min | auto_assign_job 阈值 |
| 6 | 群成员粒度：建群时拉入谁 | **只拉渠道默认坐席组（inbox_member 里指定 role=default 的）**，不拉全部 | Sprint 2 B15 |
| 7 | 默认 agent 缺失时是否允许纯人工 | **允许**（现状就是纯人工） | 0 工作量 |
| 8 | Bot 切换是否允许跨渠道 | 不允许 | Sprint 4+ |

### 8.2 已规避的风险

- ✅ **抢单冲突**：Server 已有 CAS
- ✅ **IM 消息名**：扩展不冲突
- ✅ **角色权限**：已与您需求一致
- ✅ **DB 框架**：复用 `commons/dbcommons` 即可
- ✅ **AI Bot 基础设施**：全齐

### 8.3 仍未覆盖的风险

- ⚠️ **Go Server 没 cron 框架**：Sprint 2 需引入 `robfig/cron` 或类似
- ⚠️ **群成员动态管理**：Server IM SDK 是否支持 add/remove member 需要验证
- ⚠️ **IM SDK 是否支持 `kickFromGroup`**：close 后是否要把客服踢出群？可能不需要（closed 群只读）
- ⚠️ **客户在 closed 后建新工单**：需要新建 customer_inbox_rel 还是复用旧的？建议复用 + 建新 ticket
- ⚠️ **渠道配置变更时正在进行的工单**：存量工单是否要回填 default_agent？建议不回填（按工单创建时的配置）

---

## 9. 总结

### 9.1 结论

- ⚠️ **Server 真正能直接用的客服主线流程 ≈ 10%**（只有 IM 群 + tag + claim CAS + Bot 基础设施可用）
- ❌ **核心缺口**：
  1. 客户发起时**没有 agent 分流逻辑**（最重要）
  2. 客户在 resolved/closed 后再发消息**不会触发 reopen / 新工单**
  3. 群成员粒度不对（全 inbox 拉入）
  4. 没有 5 态状态机
  5. 没有 CSAT / 自动分配 / 渠道配置表
- 🎯 **MVP 闭环 = 25.5 人天**（4 Sprint），比第一次估算的 12 天翻倍
- 💡 **差异化**：Agent Session 是 Chatwoot Captain 的免费替代

### 9.2 下一步建议

**选项 A**：**直接进入 Sprint 1 后端实施**（5 人天后端 + 2 人天前端）。
- 已经看完了 Sprint 1 设计稿 + 本次差距分析
- 实施顺序：B1 → B2 → B3 → B4-B8 并行 → B9 → B10

**选项 B**：**先拍板 §8.1 的 8 个决策点**。
- 特别是 #2（resolved 后消息处理）和 #6（群成员粒度）会直接影响 Sprint 2 的实施

**选项 C**：**先做 Sprint 2 的关键设计**（agent 自动注入 + 群成员粒度）。
- 这两块是您需求的核心，**比 Sprint 1 更值得先设计**
- 但 Sprint 1 不做就没"5 态容器"，CSAT / 评价 / 重开都没法跑

---

