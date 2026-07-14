# Sprint 1 修订版 · 后端契约（DDL + 接口 + IM 消息）

> **本次修订核心**：
> 1. **状态机精简到 4 态**（pending / processing / resolved / reopened）；closed 字段保留作隐藏终态
> 2. **`PATCH /jmate/tickets/:id/status` 通用状态变更接口**（替代 resolve / reopen / close / release 4 个独立接口）
> 3. **`POST /jmate/tickets/:id/transfer` 工单转移接口**
> 4. **3 个 Agent 接口**：`GET /agents/available` / `GET /agents/online` / `GET /agents/:id/stats`
> 5. **2 个 Customer 接口**：`GET /customers/:id` / `GET /customers/:id/sessions`
> 6. **IM 消息**：`jgm:ticket_reassign`（新增，transfer 用）
>
> 配套文档：
> - `sprint-1-revised-frontend.md`（本次新出，前端改造要点）

---

## 0. 范围说明

### 0.1 Sprint 1 后端需要做的

1. **DDL**：tickets 表字段扩展 + agents 表字段扩展
2. **REST 接口**：6 个（status PATCH、transfer POST、agents 3 个、customers 2 个；原有 claim/list 不变）
3. **IM 自定义消息**：1 种新增（`jgm:ticket_reassign`）
4. **状态机校验**：服务端权威，前端粗校验 + 后端兜底

### 0.2 不在 Sprint 1 后端范围

- 渠道配置表（Sprint 2）
- 自动分配 cron（Sprint 2）
- 群成员动态管理（Sprint 2/3）
- CSAT 完整接口（Sprint 5）
- 标签 / 转派 / 备注 UI 相关接口（Sprint 4）

---

## 1. 数据库表结构

### 1.1 `tickets` 表字段扩展（精简到 4 态）

```sql
-- 状态枚举扩展（Go 端 enum：0=pending / 1=processing / 2=resolved / 3=reopened / 99=closed）
-- closed 字段保留为隐藏终态（仅后端 cron 清理用，前端不可见）
ALTER TABLE tickets
  ADD COLUMN pending_start_at       TIMESTAMP NULL DEFAULT NULL COMMENT '进入 pending 状态的时间，用于超时判定',
  ADD COLUMN csat_status            VARCHAR(16) NOT NULL DEFAULT 'none' COMMENT 'none/pending/completed/expired',
  ADD COLUMN csat_score             TINYINT DEFAULT NULL COMMENT '1-5',
  ADD COLUMN csat_comment           VARCHAR(512) DEFAULT NULL,
  ADD COLUMN csat_sent_at           TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN csat_responded_at      TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN csat_expires_at        TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN reopen_count           INT NOT NULL DEFAULT 0,
  ADD COLUMN closed_at              TIMESTAMP NULL DEFAULT NULL COMMENT 'hidden 字段，前端不可见',
  ADD COLUMN customer_id            VARCHAR(64) DEFAULT NULL COMMENT '关联客户',
  ADD COLUMN version                INT NOT NULL DEFAULT 0 COMMENT '乐观锁',

  ADD INDEX idx_status_assignee (status, assignee_id),
  ADD INDEX idx_customer (customer_id),
  ADD INDEX idx_pending_start (status, pending_start_at),
  ADD INDEX idx_csat_expires (csat_status, csat_expires_at);

-- 已有字段（无需新增）：
--   ticket_id / source_id / inbox_id / assignee_id / status / created_time / updated_time / app_key / resolved_at
```

**状态枚举（Go 端）**：
```go
type TicketStatus int

const (
    TicketStatusPending    TicketStatus = 0
    TicketStatusProcessing TicketStatus = 1
    TicketStatusResolved   TicketStatus = 2
    TicketStatusReopened   TicketStatus = 3
    TicketStatusClosed     TicketStatus = 99  // 隐藏终态，前端不展示
)
```

### 1.2 `agents` 表字段扩展

```sql
ALTER TABLE agents
  ADD COLUMN is_online           TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN last_seen_at        TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN max_concurrent      INT NOT NULL DEFAULT 10 COMMENT '同时在办工单上限',
  ADD COLUMN current_tickets     INT NOT NULL DEFAULT 0 COMMENT '当前在办数（缓存）',
  ADD INDEX idx_online (is_online, last_seen_at);
```

### 1.3 不在 Sprint 1 范围

- ❌ `channel_configs` 表（Sprint 2）
- ❌ `ticket_status_logs` 表（Sprint 2）
- ❌ `csat_survey_responses` 表（Sprint 5）
- ❌ `ticket_claim_logs` 表（Sprint 2）

---

## 2. REST 接口契约

### 2.1 通用约定

**请求头**：
- `Authorization: <token>`
- `AppKey: <app_key>`
- `Content-Type: application/json`

**统一响应**：
```json
{ "code": 0, "msg": "success", "data": { ... } }
```

**错误码表**：

| code | 含义 | HTTP status |
|---|---|---|
| 0 | 成功 | 200 |
| 17001 | 参数错误 | 400 |
| 17009 | 工单不存在 | 404 |
| 17010 | 无权操作 | 403 |
| 17011 | 状态机非法转换 | 409 |
| 17012 | 乐观锁冲突（version 不匹配） | 409 |
| 17016 | 抢单冲突（他人已认领） | 409 |
| 17017 | 客户不存在 | 404 |
| 17018 | Agent 不在线 | 409 |
| 17019 | 不能转移给当前 assignee | 400 |

---

### 2.2 工单状态变更（合并版）

#### `PATCH /jmate/tickets/:id/status`  ⭐ Sprint 1 重点

**通用状态变更接口**，替代原来的 `POST /resolve` / `/reopen` / `/close` / `/release` 4 个接口。

**Body**：
```json
{
  "to_status": "resolved",        // pending | processing | resolved | reopened
  "operator": "agent",            // agent | system | customer
  "reason": "客户追问",            // 可选
  "expected_version": 1
}
```

**`to_status` 合法转换矩阵**：

| 当前 → 目标 | pending | processing | resolved | reopened |
|---|---|---|---|---|
| **pending** | — | ✅ claim | ❌ | ❌ |
| **processing** | ❌ | — | ✅ resolve | ❌ |
| **resolved** | ❌ | ❌ | — | ✅ reopen |
| **reopened** | ❌ | ✅ claim | ✅ resolve | — |
| **closed（隐藏）** | ❌ | ❌ | ❌ | ❌ |

**响应（成功）**：
```json
{
  "code": 0,
  "data": {
    "ticket_id": "tk_001",
    "status": "resolved",
    "resolved_at": 1730000100,
    "csat_status": "pending",
    "csat_expires_at": 1730604100,
    "version": 2
  }
}
```

**校验**：
- to_status ∈ {pending, processing, resolved, reopened}（不接受 closed）
- 转换矩阵合法（见上表）
- `to_status=processing`：要求 `operator=agent` 且 assignee_id=current_user_id（或管理员）
- `to_status=reopened`：要求 ticket 处于 resolved；reopen_count += 1；release my_ticket tag；release assignee_id
- `expected_version` 与 DB 一致

**后端副作用**（按 to_status 分支）：
- `processing`（claim）：
  1. UPDATE status, assignee_id=current_user, pending_start_at=NULL, version+1
  2. IM SDK: addConversationToTag(assigned, my_ticket) × 2
  3. 广播 `jgm:ticketassign`
- `resolved`：
  1. UPDATE status, resolved_at=now, csat_status=pending, csat_expires_at=now+7d, version+1
  2. IM SDK: removeConversationFromTag(assigned, my_ticket) × 2
  3. 广播 `jgm:ticket_resolved`
- `reopened`：
  1. UPDATE status, reopen_count+=1, assignee_id=NULL, pending_start_at=now, version+1
  2. IM SDK: removeConversationFromMyTicketTag
  3. 广播 `jgm:ticket_reopened`

---

### 2.3 工单转移

#### `POST /jmate/tickets/:id/transfer`  ⭐ Sprint 1 重点

**Body**：
```json
{
  "to_assignee_id": "u_008",
  "to_assignee_name": "坐席B",
  "note": "VIP 客户，麻烦优先处理",
  "expected_version": 1
}
```

**响应（成功）**：
```json
{
  "code": 0,
  "data": {
    "ticket_id": "tk_001",
    "old_assignee_id": "u_007",
    "old_assignee_name": "小红",
    "new_assignee_id": "u_008",
    "new_assignee_name": "坐席B",
    "version": 2,
    "updated_at": 1730000050
  }
}
```

**校验**：
- 当前 status ∈ {pending, processing, reopened}
- `to_assignee_id != current ticket.assignee_id`（不能转移给自己）
- `to_assignee_id` 用户存在且 role=客服
- `expected_version` 一致
- to_assignee 必须 `is_online=true`（推荐）

**后端副作用**：
1. UPDATE ticket SET assignee_id=to, version+1 WHERE id=? AND version=?
2. release 旧 assignee 的 `my_ticket` tag（如有）
3. add 新 assignee 的 `my_ticket` tag（如新 assignee=__SELF__）
4. 保留 `assigned` tag（工单仍属团队）
5. INSERT ticket_status_logs（reason=note）
6. 广播 IM 消息 `jgm:ticket_reassign`

---

### 2.4 工单详情（新增，Sprint 1 重点）

#### `GET /jmate/tickets/:id`

**响应**：
```json
{
  "code": 0,
  "data": {
    "ticket_id": "tk_001",
    "conversation_key": "1_42",
    "status": "processing",
    "assignee_id": "u_007",
    "assignee_name": "小红",
    "customer_id": "cust_001",
    "platform": "telegram",
    "csat_status": "none",
    "csat_score": null,
    "csat_expires_at": null,
    "reopen_count": 0,
    "pending_start_at": null,
    "resolved_at": null,
    "closed_at": null,
    "created_at": 1730000000,
    "updated_at": 1730000050,
    "version": 1
  }
}
```

> 注：响应**不包含** closed 状态字段（status=99 时返 404 或 status=closed 但前端不展示）。建议：`status=closed` 时仍返 200，但前端根据 status=99 完全忽略（前端 enum 不含 closed）。

---

### 2.5 Agent 接口 ⭐ Sprint 1 重点

#### `GET /jmate/agents/available`

**Query**：
- `exclude_self` (bool, 默认 true)
- `online_only` (bool, 默认 true)

**响应**：
```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "agent_id": "u_008",
        "name": "坐席B",
        "avatar": "...",
        "is_online": true,
        "current_tickets": 5,
        "max_concurrent": 10,
        "role": "客服"
      }
    ]
  }
}
```

**校验**：
- 当前用户 role=客服 或 role=管理员
- 默认排除自己
- 默认仅返回在线

---

#### `GET /jmate/agents/online`

**响应**：
```json
{
  "code": 0,
  "data": {
    "items": [
      { "agent_id": "u_008", "name": "坐席B", "avatar": "...", "is_online": true, "current_tickets": 5, "max_concurrent": 10 }
    ]
  }
}
```

---

#### `GET /jmate/agents/:id/stats`

**Query**：
- `from` (yyyy-mm-dd, 可选)
- `to` (yyyy-mm-dd, 可选)

**响应**：
```json
{
  "code": 0,
  "data": {
    "agent_id": "u_008",
    "today": { "tickets": 12, "resolved": 10, "csat_avg": 4.5 },
    "week":  { "tickets": 80, "resolved": 72, "csat_avg": 4.6 },
    "month": { "tickets": 320, "resolved": 290, "csat_avg": 4.5 },
    "active_sessions": 5
  }
}
```

---

### 2.6 Customer 接口 ⭐ Sprint 1 重点

#### `GET /jmate/customers/:id`

**响应**：
```json
{
  "code": 0,
  "data": {
    "customer_id": "cust_001",
    "nickname": "张三",
    "avatar": "https://...",
    "phone": "",
    "email": "",
    "identifier": "tg_12345",
    "channels": ["telegram", "web"],
    "first_seen_at": 1730000000,
    "last_seen_at": 1730900000,
    "total_sessions": 12,
    "csat_avg": 4.6
  }
}
```

---

#### `GET /jmate/customers/:id/sessions`

**响应**：
```json
{
  "code": 0,
  "data": {
    "items": [
      { "ticket_id": "tk_001", "status": "pending",   "created_at": 1730000000, "platform": "telegram", "last_message_preview": "..." },
      { "ticket_id": "tk_004", "status": "reopened",  "created_at": 1730080000, "platform": "telegram" },
      { "ticket_id": "tk_005", "status": "resolved",  "created_at": 1730500000, "platform": "web" }
    ]
  }
}
```

---

### 2.7 工单列表（沿用 + 升级）

#### `GET /jmate/tickets/list`（已有，扩展）

**Query 升级**：
- `status` (可选，多个用逗号分隔) `pending,processing,resolved,reopened` — **不接受 closed**
- `assignee_id` (可选) `__SELF__` 解析为当前用户
- `platform` (可选)
- `q` (可选, 关键词)
- `page` (默认 1)
- `size` (默认 20, max 100)

**响应**：同 Sprint 1 原设计，**过滤掉 status=closed** 的工单。

---

### 2.8 工单认领（已有，不变）

#### `POST /jmate/tickets/:id/claim`

**Body**：
```json
{ "expected_version": 0 }
```

> 该接口**保留**（前端已有），内部实现可改为调 `PATCH /status` body `{to_status: 'processing'}`。
> 也可以**保留原接口**，调用方不动。

---

## 3. IM 自定义消息

### 3.1 消息注册

> IM 后端需在 `juggle.registerMessage` 列表加：

```js
[
  { name: 'jgm:ticket_assign',     isCount: true, isStorage: true },  // 已有
  { name: 'jgm:ticket_resolved',   isCount: true, isStorage: true },
  { name: 'jgm:ticket_reopened',   isCount: true, isStorage: true },
  { name: 'jgm:ticket_reassign',   isCount: true, isStorage: true }   // 新增：transfer 用
]
```

### 3.2 Payload Schema

#### `jgm:ticket_reassign`（新增）

```json
{
  "ticket_id": "tk_001",
  "from": { "id": "u_007", "name": "小红" },
  "to":   { "id": "u_008", "name": "坐席B" },
  "note": "VIP 客户，麻烦优先处理"
}
```

#### 其他（沿用 Sprint 1）

- `jgm:ticketassign` — claim（已有）
- `jgm:ticket_resolved` — resolve
- `jgm:ticket_reopened` — reopen

---

## 4. 状态机规范（服务端权威）

### 4.1 状态转换图

```
              ┌─────────────────────────────────────────────────┐
              │                                                 │
              ▼                                                 │
          ┌────────┐    claim     ┌────────────┐    resolve   ┌──────────┐
          │pending │ ────────────►│ processing │ ───────────► │ resolved │
          └────────┘              └────────────┘              └──────────┘
              ▲                         │ ▲                       │ ▲
              │                         │ │                       │ │
              │                         │ │                       │ │
              │                         │ │ reassign              │ │ reopen
              │                         │ │ (assignee 变)         │ │ (agent/customer)
              │                         │ │                       │ │
              │      ┌──────────────────┘ │                       │ │
              │      │   auto_assign       │                       │ │
              │      │   (cron, 15min)     │                       │ │
              │      ▼                    │                       │ │
              │   ┌────────┐               │                       │ │
              └── │reopened│ ◄─────────────┘                       │ │
                  └────────┘                                       │ │
                      │                                           │ │
                      │ resolve                                   │ │
                      ▼                                           ▼ │
                  ┌────────┐                              ┌──────────┐│
                  │resolved│                              │ resolved ││
                  │(再次)  │ ◄────────────────────────────│(首次)    │┘
                  └────────┘                              └──────────┘
                      
                  ┌────────┐
                  │ closed │ ◄──── (隐藏终态，cron 30天后清理，前端不可见)
                  └────────┘
```

### 4.2 合法转换矩阵

| from \\ to | pending | processing | resolved | reopened | closed（隐藏） |
|---|---|---|---|---|---|
| **pending** | — | ✅ claim | ❌ | ❌ | ❌（cron 自动） |
| **processing** | ❌ | — (reassign 同状态) | ✅ resolve | ❌ | ❌（cron 自动） |
| **resolved** | ❌ | ❌ | — | ✅ reopen | ❌（cron 自动） |
| **reopened** | ❌ | ✅ claim | ✅ resolve | — | ❌（cron 自动） |
| **closed** | ❌ | ❌ | ❌ | ❌ | —（仅 cleanup_job 操作） |

### 4.3 自动转换触发（Sprint 2+）

| 触发 | 转换 | 触发方 |
|---|---|---|
| pending 超时 15min | pending → processing | cron auto_assign_job |
| resolved 超 72h 无动作 | resolved → closed（隐藏） | cron auto_close_job |
| processing 坐席离线 1h | processing → pending | cron stale_release_job |

---

## 5. 接口对照表（前端视角）

| 文档 § | 接口 | 前端 SERVER_PATH | 改造点 |
|---|---|---|---|
| 2.2 | `PATCH /jmate/tickets/:id/status` | **新增** `TICKET_SET_STATUS` | 替代原 4 个独立接口 |
| 2.3 | `POST /jmate/tickets/:id/transfer` | **新增** `TICKET_TRANSFER` | 合并原 reassign |
| 2.4 | `GET /jmate/tickets/:id` | **新增** `TICKET_DETAIL` | 详情页用 |
| 2.5 | `GET /jmate/agents/available` | **新增** `AGENTS_AVAILABLE` | 转移弹层 |
| 2.5 | `GET /jmate/agents/online` | **新增** `AGENTS_ONLINE` | team tab |
| 2.5 | `GET /jmate/agents/:id/stats` | **新增** `AGENT_STATS` | team tab 业绩卡 |
| 2.6 | `GET /jmate/customers/:id` | **新增** `CUSTOMER_DETAIL` | 用户信息模块 |
| 2.6 | `GET /jmate/customers/:id/sessions` | **新增** `CUSTOMER_SESSIONS` | 用户历史会话 |
| 2.7 | `GET /jmate/tickets/list` | 已有 `TICKET_LIST` | 升级：filter 不返 closed |
| 2.8 | `POST /jmate/tickets/:id/claim` | 已有 `TICKET_CLAIM` | 不变 |

---

## 6. 幂等性 / 并发保证

### 6.1 写接口幂等

| 接口 | 幂等键 | 重试策略 |
|---|---|---|
| PATCH /status | expected_version | version 不匹配返 17012 |
| POST /transfer | expected_version | 同上 |
| POST /claim | expected_version | 同上 |

### 6.2 IM 消息广播幂等

- 每次状态变更广播的 IM 消息带 `event_id`（UUID），IM 端去重
- 客户端收到重复消息时直接丢弃

### 6.3 抢单冲突

```
场景：坐席 A 和坐席 B 同时点「认领」
- A 请求先到：UPDATE 成功 version=1
- B 请求后到：UPDATE 失败（version=0 不匹配），返 17012
- 前端 B 收到 17012 → 弹「已被 XXX 认领」+ 列表实时刷新
```

---

## 7. 性能 / 索引建议

- `tickets.status + assignee_id` 联合索引 → 列表查询主路径
- `tickets.customer_id` 索引 → 用户历史会话查询
- `tickets.pending_start_at` 索引 → cron 扫表用
- `agents.is_online + last_seen_at` 联合索引 → online 列表

---

## 8. 测试用例清单（后端 QA 用）

| # | 场景 | 预期 |
|---|---|---|
| T1 | pending → PATCH /status to_status=processing | 成功，version+1，IM tag add |
| T2 | pending → PATCH /status to_status=resolved | 返 17011（非法转换） |
| T3 | processing → PATCH /status to_status=resolved | 成功，IM tag remove，发评价卡 |
| T4 | resolved → PATCH /status to_status=reopened | 成功，release my_ticket |
| T5 | resolved → PATCH /status to_status=reopened by=customer | 成功（IM 路由） |
| T6 | reopened → PATCH /status to_status=processing | 成功（claim） |
| T7 | reopened → PATCH /status to_status=resolved | 成功 |
| T8 | 任何 → PATCH /status to_status=closed | 返 17011（前端不允许） |
| T9 | POST /transfer to_assignee_id = 自己 | 返 17019 |
| T10 | POST /transfer to_assignee 不在线 | 返 17018 |
| T11 | POST /transfer version 不匹配 | 返 17012 |
| T12 | POST /transfer 成功 | IM 广播 jgm:ticket_reassign |
| T13 | GET /agents/available exclude_self=true | 返回列表不含自己 |
| T14 | GET /agents/available online_only=true | 返回列表全在线 |
| T15 | GET /agents/:id/stats | 返回 today/week/month |
| T16 | GET /customers/:id | 返 404 不存在 |
| T17 | GET /customers/:id/sessions | 按时间倒序返 |
| T18 | GET /tickets/list 含 status=closed | 过滤掉 closed |
| T19 | 客户在 resolved 后发消息触发 reopen | Sprint 1 不实现（webhook 改造在 Sprint 2） |
| T20 | status=closed 工单详情查询 | 仍返 200，status=99 |

---

## 9. 实施优先级建议（给后端排期）

| 优先级 | 内容 | 工作量估 |
|---|---|---|
| **P0-1** | DDL（tickets 字段扩展 + agents 字段扩展） | 0.5d |
| **P0-2** | `PATCH /tickets/:id/status` 接口 + service | 1.0d |
| **P0-3** | `POST /tickets/:id/transfer` 接口 + service | 0.7d |
| **P0-4** | `GET /tickets/:id` 详情接口 | 0.3d |
| **P0-5** | `GET /agents/available` + `online` + `:id/stats` | 1.0d |
| **P0-6** | `GET /customers/:id` + `:id/sessions` | 0.8d |
| **P0-7** | `jgm:ticket_reassign` IM 消息 | 0.3d |
| **P1-1** | `GET /tickets/list` 升级（过滤 closed） | 0.3d |
| **P1-2** | 工单状态机单元测试 | 0.5d |

合计：约 **5.4d / 1 人**

---

