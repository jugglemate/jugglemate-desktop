# Sprint 1 后端契约（DDL + 接口 + 定时任务）

> 配套文档：
> - `customer-support-flow-design.md` §6 总览
> - `customer-support-frontend-iteration-plan.md` §8 接口契约（前端视角）
> - `sprint-1-frontend-impl-points.md` §5 service 层（前端调用形态）
>
> 目的：给后端同学一份**直接可拿去实现**的契约，**前端不依赖**这份文档等后端就绪，先用 mock 跑闭环。

---

## 0. 范围说明

### 0.1 Sprint 1 后端需要做的

1. **DDL**：1 张新表（`channel_configs`）+ 1 张新表（`ticket_status_logs`）+ 1 张新表（`ticket_claim_logs`）+ `tickets` 表字段扩展 + `agents` 表字段扩展
2. **REST 接口**：6 个（list 升级、claim 升级、resolve、reopen、close、release、ticket 详情）
3. **内部接口**：2 个（auto-assign cron、auto-close cron）
4. **定时任务**：4 个
5. **IM 自定义消息**：本 Sprint 内 6 种（jgm:ticket_assign / resolved / reopened / closed / auto_assigned / auto_closed）

### 0.2 不在 Sprint 1 后端范围

- 标签接口（Sprint 3）
- 转派接口（Sprint 4）
- CSAT 完整接口（Sprint 5）
- 优先级（暂搁）
- SLA / 团队 / 知识库 / 自动化 / 报表（远期）

---

## 1. 数据库表结构

### 1.1 新增表 `channel_configs`

```sql
CREATE TABLE channel_configs (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  platform                VARCHAR(32) NOT NULL COMMENT 'web / telegram / jugglechat / 未来扩展',

  -- agent 路由
  default_agent_id        VARCHAR(64) DEFAULT NULL COMMENT 'NULL=走人工；否则 LLM agent ID',
  default_mode            VARCHAR(16) NOT NULL DEFAULT 'collaborative' COMMENT 'collaborative / managed',
  available_agents        JSON DEFAULT NULL COMMENT '["agent_id_1","agent_id_2"] 渠道可用 agent 白名单',

  -- 分配规则
  assignment_rule         VARCHAR(32) NOT NULL DEFAULT 'manual' COMMENT 'manual / round_robin / least_busy / route',
  route_target            JSON DEFAULT NULL COMMENT '{type:"agent"|"team", id:"xxx"}',

  -- 超时兜底
  auto_claim_timeout_min  INT NOT NULL DEFAULT 15 COMMENT 'pending 超时自动分配阈值（分钟）',
  auto_close_hours        INT NOT NULL DEFAULT 72 COMMENT '客户沉默自动关闭阈值（小时）',
  reassign_offline_hours  INT NOT NULL DEFAULT 1 COMMENT '坐席离线自动释放阈值（小时）',

  -- CSAT
  csat_enabled            TINYINT(1) NOT NULL DEFAULT 1,
  csat_template           VARCHAR(512) DEFAULT NULL,
  csat_expire_days        INT NOT NULL DEFAULT 7 COMMENT '评价卡过期天数',

  -- SLA（先留字段，不实现）
  sla_minutes             INT DEFAULT NULL,

  -- 时间
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_platform (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='渠道配置';
```

**初始数据**：
```sql
INSERT INTO channel_configs (platform, default_agent_id, default_mode, assignment_rule) VALUES
('web',        'gcwknn85zss', 'collaborative', 'manual'),  -- 有 agent 默认
('telegram',   NULL,           'collaborative', 'manual'),  -- 无 agent 走人工
('jugglechat', 'gj4qls9yfwc', 'collaborative', 'manual');
```

### 1.2 `tickets` 表字段扩展

```sql
ALTER TABLE tickets
  -- 渠道关联
  ADD COLUMN channel_config_id      BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 channel_configs.id',

  -- 分配相关
  ADD COLUMN assignment_rule        VARCHAR(32) DEFAULT 'manual' COMMENT '本次分配触发的规则',
  ADD COLUMN auto_assigned_at       TIMESTAMP NULL DEFAULT NULL COMMENT '自动分配时刻',
  ADD COLUMN auto_assign_reason     VARCHAR(64) DEFAULT NULL COMMENT 'timeout / rule_match / manual_override',

  -- agent 协同
  ADD COLUMN current_agent_id       VARCHAR(64) DEFAULT NULL COMMENT '当前协同 agent ID',
  ADD COLUMN current_agent_mode     VARCHAR(16) DEFAULT 'collaborative' COMMENT 'collaborative / managed',

  -- 路由目标
  ADD COLUMN routed_agent_id        VARCHAR(64) DEFAULT NULL,
  ADD COLUMN routed_team_id         VARCHAR(64) DEFAULT NULL,

  -- 重开 / CSAT
  ADD COLUMN reopen_count           INT NOT NULL DEFAULT 0,
  ADD COLUMN csat_status            VARCHAR(16) NOT NULL DEFAULT 'none' COMMENT 'none/pending/completed/expired',
  ADD COLUMN csat_score             TINYINT DEFAULT NULL COMMENT '1-5',
  ADD COLUMN csat_comment           VARCHAR(512) DEFAULT NULL,
  ADD COLUMN csat_sent_at           TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN csat_responded_at      TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN csat_expires_at        TIMESTAMP NULL DEFAULT NULL,

  -- 抢单防护
  ADD COLUMN version                INT NOT NULL DEFAULT 0 COMMENT '乐观锁',

  -- 关闭
  ADD COLUMN closed_reason          VARCHAR(64) DEFAULT NULL COMMENT 'agent_close / customer_silence / admin_close',
  ADD COLUMN closed_by              VARCHAR(64) DEFAULT NULL COMMENT 'agent_id / "system"',
  ADD COLUMN closed_at              TIMESTAMP NULL DEFAULT NULL,

  -- 时间
  ADD COLUMN pending_start_at       TIMESTAMP NULL DEFAULT NULL COMMENT '进入 pending 状态的时间，用于超时判定',

  ADD INDEX idx_status_assignee (status, assignee_id),
  ADD INDEX idx_channel_status (channel_config_id, status),
  ADD INDEX idx_pending_start (status, pending_start_at),
  ADD INDEX idx_csat_expires (csat_status, csat_expires_at);
```

**`status` 字段约束**（DB 层校验）：
```sql
-- 如有 CHECK 约束需求（MySQL 8+）：
ALTER TABLE tickets ADD CONSTRAINT chk_status CHECK (
  status IN ('pending','processing','resolved','closed','reopened')
);
```

### 1.3 新增表 `ticket_status_logs`

```sql
CREATE TABLE ticket_status_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id     VARCHAR(64) NOT NULL,
  from_status   VARCHAR(16) DEFAULT NULL,
  to_status     VARCHAR(16) NOT NULL,
  operator_id   VARCHAR(64) NOT NULL COMMENT 'agent_id / "system"',
  operator_type VARCHAR(16) NOT NULL DEFAULT 'agent' COMMENT 'agent / system / customer',
  reason        VARCHAR(256) DEFAULT NULL,
  metadata      JSON DEFAULT NULL COMMENT '额外上下文 { source, rule, ... }',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ticket (ticket_id, created_at),
  INDEX idx_operator (operator_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工单状态变更审计';
```

### 1.4 新增表 `ticket_claim_logs`

```sql
CREATE TABLE ticket_claim_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id   VARCHAR(64) NOT NULL,
  agent_id    VARCHAR(64) NOT NULL,
  claim_type  VARCHAR(16) NOT NULL COMMENT 'manual / auto_round_robin / auto_least_busy / auto_route',
  source      VARCHAR(16) NOT NULL COMMENT 'pending_pool / reopen / transfer',
  from_status VARCHAR(16) NOT NULL,
  to_status   VARCHAR(16) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ticket (ticket_id, created_at),
  INDEX idx_agent (agent_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='认领日志';
```

### 1.5 `agents` 表字段扩展

```sql
ALTER TABLE agents
  ADD COLUMN default_platforms   JSON DEFAULT NULL COMMENT '["telegram","web"] 默认服务渠道',
  ADD COLUMN max_concurrent      INT NOT NULL DEFAULT 10 COMMENT '同时在办工单上限',
  ADD COLUMN skills              JSON DEFAULT NULL COMMENT '远期：技能标签',
  ADD COLUMN is_online           TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN last_seen_at        TIMESTAMP NULL DEFAULT NULL,
  ADD INDEX idx_online (is_online, last_seen_at);
```

---

## 2. REST 接口契约

### 2.1 通用约定

**请求头**：
- `Authorization: <token>`
- `AppKey: <app_key>`
- `Content-Type: application/json`

**统一响应格式**：
```json
{ "code": 0, "msg": "success", "data": { ... } }
```

**错误码表**：

| code | 含义 | HTTP status |
|---|---|---|
| 0 | 成功 | 200 |
| 17001 | 参数错误 | 400 |
| 17009 | 工单不存在 | 404 |
| 17010 | 无权操作（非 assignee / 非管理员） | 403 |
| 17011 | 状态机非法转换 | 409 |
| 17012 | 乐观锁冲突（version 不匹配） | 409 |
| 17013 | CSAT 已存在 | 409 |
| 17014 | 目标坐席不在线 | 409 |
| 17015 | 渠道配置不存在 | 404 |
| 17016 | 抢单冲突（他人已认领） | 409 |

---

### 2.2 渠道配置

#### `GET /jmate/channels/config`

拉所有渠道配置（前端启动拉一次，缓存到 localStorage）。

**请求**：无 body

**响应**：
```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "platform": "web",
        "default_agent_id": "gcwknn85zss",
        "default_mode": "collaborative",
        "available_agents": ["gcwknn85zss", "gj4qls9yfwc"],
        "assignment_rule": "manual",
        "auto_claim_timeout_min": 15,
        "auto_close_hours": 72,
        "csat_enabled": true,
        "csat_expire_days": 7
      },
      {
        "platform": "telegram",
        "default_agent_id": null,
        "default_mode": "collaborative",
        "available_agents": [],
        "assignment_rule": "manual",
        "auto_claim_timeout_min": 15,
        "auto_close_hours": 72,
        "csat_enabled": true,
        "csat_expire_days": 7
      },
      {
        "platform": "jugglechat",
        "default_agent_id": "gj4qls9yfwc",
        "default_mode": "managed",
        "available_agents": ["gj4qls9yfwc"],
        "assignment_rule": "least_busy",
        "auto_claim_timeout_min": 5,
        "auto_close_hours": 48,
        "csat_enabled": true,
        "csat_expire_days": 7
      }
    ]
  }
}
```

---

### 2.3 工单基础

#### `GET /jmate/tickets/list`

**Sprint 1 升级点**：在现有 query 基础上加 `channel_platform`、`assignee_id` 过滤。

**Query**：
- `status` (可选, 多个用逗号分隔) `pending,processing,resolved,closed,reopened`
- `assignee_id` (可选) `__SELF__` 解析为当前用户
- `channel_platform` (可选, Sprint 1 新增)
- `q` (可选, 关键词)
- `page` (默认 1)
- `size` (默认 20, max 100)

**响应**：
```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "ticket_id": "tk_001",
        "conversation_key": "1_42",
        "status": "processing",
        "channel_platform": "telegram",
        "assignee_id": "u_007",
        "assignee_name": "小红",
        "current_agent_id": "gcwknn85zss",
        "current_agent_mode": "collaborative",
        "csat_status": "none",
        "csat_expires_at": null,
        "reopen_count": 0,
        "last_message_preview": "请问订单什么时候发货？",
        "pending_start_at": null,
        "created_at": 1730000000,
        "updated_at": 1730000050,
        "version": 1
      }
    ],
    "total": 8,
    "page": 1,
    "size": 20
  }
}
```

---

#### `GET /jmate/tickets/:id`

**响应**：
```json
{
  "code": 0,
  "data": {
    "ticket_id": "tk_001",
    "conversation_key": "1_42",
    "status": "processing",
    "channel_config_id": 2,
    "channel_platform": "telegram",
    "assignment_rule": "manual",
    "auto_assigned_at": null,
    "auto_assign_reason": null,
    "current_agent_id": "gcwknn85zss",
    "current_agent_mode": "collaborative",
    "routed_agent_id": null,
    "routed_team_id": null,
    "reopen_count": 0,
    "csat_status": "pending",
    "csat_score": null,
    "csat_comment": null,
    "csat_sent_at": 1730000100,
    "csat_responded_at": null,
    "csat_expires_at": 1730604100,
    "closed_reason": null,
    "closed_by": null,
    "closed_at": null,
    "pending_start_at": null,
    "created_at": 1730000000,
    "updated_at": 1730000050,
    "version": 1
  }
}
```

---

### 2.4 工单状态变更

#### `POST /jmate/tickets/:id/claim`

**Sprint 1 升级点**：加乐观锁校验。

**Body**：
```json
{ "expected_version": 0 }
```

**响应（成功）**：
```json
{
  "code": 0,
  "data": {
    "ticket_id": "tk_001",
    "status": "processing",
    "assignee_id": "u_007",
    "assignee_name": "当前用户",
    "version": 1,
    "updated_at": 1730000050
  }
}
```

**错误**：
- `code: 17009` 工单不存在
- `code: 17011` 当前状态不允许认领（非 pending/reopened）
- `code: 17012` 乐观锁冲突（已返回 `current_version`）
- `code: 17016` 抢单冲突（已被人认领）

**后端副作用**：
1. UPDATE tickets SET status='processing', assignee_id=current_user_id, version=version+1, pending_start_at=NULL WHERE id=? AND version=?
2. INSERT ticket_claim_logs
3. INSERT ticket_status_logs
4. IM 广播 jgm:ticket_assign
5. IM SDK: addConversationsToTag(assigned, my_ticket) × 2

---

#### `POST /jmate/tickets/:id/resolve`

**Body**：
```json
{ "expected_version": 1, "send_csat": true, "note": "已为客户办理退款" }
```

**响应**：
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
- 当前 status ∈ {processing, reopened}
- 校验 assignee_id = current_user_id（或 role=1）
- 校验 expected_version

**后端副作用**：
1. UPDATE tickets SET status='resolved', resolved_at=now, csat_status, csat_expires_at, version=version+1
2. INSERT ticket_status_logs (from=processing, to=resolved, reason=note)
3. 如 send_csat=true → 广播 jgm:csat 卡片消息
4. 广播 jgm:ticket_resolved
5. IM SDK: removeConversationsFromTag(assigned, my_ticket) × 2

---

#### `POST /jmate/tickets/:id/reopen`

**Body**：
```json
{ "expected_version": 2, "reason": "客户有补充问题", "by": "agent" }
```

`by` 取值：`agent`（客服手动）/ `customer`（客户发消息触发）

**响应**：
```json
{
  "code": 0,
  "data": {
    "ticket_id": "tk_001",
    "status": "reopened",
    "reopen_count": 1,
    "pending_start_at": 1730000200,
    "version": 3
  }
}
```

**校验**：
- 当前 status = resolved
- by=agent 时校验 assignee_id = current_user_id
- by=customer 时不校验身份（来自 IM 消息路由）

**后端副作用**：
1. UPDATE tickets SET status='reopened', reopen_count+=1, pending_start_at=now, version=version+1
2. INSERT ticket_status_logs (from=resolved, to=reopened, by=by, reason=reason)
3. 广播 jgm:ticket_reopened
4. IM SDK: removeFromMyTicketTag (保留 assigned)

---

#### `POST /jmate/tickets/:id/close`

**Body**：
```json
{ "expected_version": 3, "reason": "agent_close", "by": "agent" }
```

`reason` 取值：`agent_close`（坐席手动） / `customer_silence`（超时自动） / `admin_close`（管理员）
`by` 取值：`agent` / `system` / `admin`

**响应**：
```json
{ "code": 0, "data": { "ticket_id": "tk_001", "status": "closed", "closed_at": 1730000300, "version": 4 } }
```

**校验**：
- 当前 status ∈ {processing, reopened, resolved, closed}（closed 幂等）
- by=admin 时校验 role=1
- pending 状态不允许 close

**后端副作用**：
1. UPDATE tickets SET status='closed', closed_*, version=version+1
2. INSERT ticket_status_logs
3. 广播 jgm:ticket_closed
4. IM SDK: removeFromTag(assigned, my_ticket) × 2

---

#### `POST /jmate/tickets/:id/release`

**Body**：`{ "expected_version": 1 }`

**响应**：
```json
{ "code": 0, "data": { "ticket_id": "tk_001", "status": "pending", "assignee_id": null, "pending_start_at": 1730000400, "version": 2 } }
```

**校验**：
- 仅 role=1（管理员）可调用
- 当前 status ∈ {processing, reopened, resolved, closed}

**后端副作用**：
1. UPDATE tickets SET status='pending', assignee_id=NULL, pending_start_at=now, version=version+1
2. INSERT ticket_status_logs (to=pending, operator_type=admin, reason='release')
3. 广播 `jgm:ticket_assign`（payload.by=release 给前端识别）
4. IM SDK: removeFromTag(assigned, my_ticket) × 2

---

### 2.5 内部 cron 接口（不暴露前端）

#### `POST /jmate/internal/tickets/auto-assign`

由 `auto_assign_job` 定时调用，**不鉴权用户，靠内部 token / IP 白名单**。

**Body**：
```json
{
  "ticket_id": "tk_001",
  "rule": "least_busy",
  "assignee_id": "u_008"
}
```

**响应**：
```json
{ "code": 0, "data": { "ticket_id": "tk_001", "status": "processing", "version": 2 } }
```

**校验**：
- 当前 status ∈ {pending, reopened}
- assignee_id 必须 is_online=1

**副作用**：等同 `claim` 但 claim_type='auto_least_busy'，assignee_id 由 cron 算出。

---

#### `POST /jmate/internal/tickets/auto-close`

由 `auto_close_job` 定时调用。

**Body**：
```json
{ "ticket_id": "tk_001", "reason": "customer_silence" }
```

**响应**：
```json
{ "code": 0, "data": { "ticket_id": "tk_001", "status": "closed", "version": 3 } }
```

**副作用**：等同 `close` 但 by='system'。

---

## 3. 状态机规范（服务端权威）

### 3.1 状态转换图

```
              ┌─────────────────────────────────────────────────────┐
              │                                                     │
              ▼                                                     │
          ┌────────┐    claim      ┌────────────┐    resolve      ┌──────────┐
          │pending │ ────────────► │ processing │ ─────────────► │ resolved │
          └────────┘               └────────────┘                └──────────┘
              ▲                         │  ▲                       │   ▲
              │                         │  │                       │   │
              │ release                 │  │ reassign              │   │ reopen
              │ (admin)                 │  │ (Sprint 4)            │   │ (agent/customer)
              │                         │  │                       │   │
              │      ┌──────────────────┘  │                       │   │
              │      │                     │                       │   │
              │      │ auto_assign         │                       │   │
              │      │ (cron, 15min)       │                       │   │
              │      ▼                     │                       │   │
              │   ┌────────┐               │                       │   │
              └── │reopened│ ◄─────────────┘                       │   │
                  └────────┘                                       │   │
                      │                                           │   │
                      │ close (admin/system)                      │   │
                      │                                           │   │
                      ▼                                           ▼   │
                  ┌────────┐  ◄─────── close ─────────────────────┘
                  │ closed │  (任何非 pending 状态可关)
                  └────────┘
```

### 3.2 合法转换矩阵

| from \\ to | pending | processing | resolved | closed | reopened |
|---|---|---|---|---|---|
| **pending** | — | claim, auto_assign | ❌ | ❌ | ❌ |
| **processing** | release, auto_release (offline) | — (reassign 是同状态) | resolve | close, auto_close | reopen (via customer msg + agent) |
| **resolved** | release | ❌ | — | close | reopen |
| **closed** | release | ❌ | ❌ | —（幂等关闭） | ❌ |
| **reopened** | release | claim, auto_assign (timeout) | resolve | close | —（转 processing） |

> 注：reopened 状态本身不可达，**再次 claim/auto_assign 时直接落 processing**。这是为了避免"重复重开"的中间态，前端展示时可把 reopened 当 processing 看待。

### 3.3 自动转换触发

| 触发 | 转换 | 触发方 |
|---|---|---|
| 客户在 resolved 后发消息 | resolved → reopened | IM 消息路由 |
| pending 超时（T1=5min） | 仅 Toast 提示，不改状态 | 前端 |
| pending 超时（T2=15min） | pending → processing | cron auto_assign_job |
| processing 坐席离线 1h+ | processing → pending | cron stale_release_job |
| resolved 坐席 72h 无客户响应 | resolved → closed | cron auto_close_job |

---

## 4. 定时任务（Job）

### 4.1 `auto_assign_job`

**周期**：每 1 分钟
**SQL**：
```sql
SELECT t.id, t.channel_config_id
FROM tickets t
JOIN channel_configs cc ON cc.id = t.channel_config_id
WHERE t.status = 'pending'
  AND t.pending_start_at < NOW() - INTERVAL cc.auto_claim_timeout_min MINUTE
LIMIT 100;
```

**处理**：
1. 对每条工单按 channel_configs.assignment_rule 算 assignee：
   - `manual`：跳过（manual 没有自动分配）
   - `round_robin`：取在线坐席按 RR 排
   - `least_busy`：取 processing 数最少的在线坐席
   - `route`：取 route_target.id
2. 调内部 `auto-assign` 接口（或直接调内部 service）

---

### 4.2 `auto_close_job`

**周期**：每 10 分钟
**SQL**：
```sql
SELECT t.id, t.channel_config_id, t.status
FROM tickets t
JOIN channel_configs cc ON cc.id = t.channel_config_id
WHERE (
    (t.status = 'resolved' AND t.csat_status IN ('none','expired') AND t.updated_at < NOW() - INTERVAL cc.auto_close_hours HOUR)
    OR
    (t.status = 'processing' AND t.updated_at < NOW() - INTERVAL 1 HOUR AND EXISTS (
      SELECT 1 FROM agents a WHERE a.id = t.assignee_id AND a.is_online = 0
    ))
)
LIMIT 100;
```

**处理**：
- 调内部 `auto-close` 接口

---

### 4.3 `csat_expire_job`

**周期**：每 1 小时
**SQL**：
```sql
UPDATE tickets
SET csat_status = 'expired'
WHERE csat_status = 'pending'
  AND csat_expires_at < NOW();
```

---

### 4.4 `stale_release_job`

**周期**：每 5 分钟
**SQL**：
```sql
-- 找出 processing 工单 + assignee 离线超过 1h 的
SELECT t.id, t.assignee_id, t.updated_at
FROM tickets t
JOIN agents a ON a.id = t.assignee_id
WHERE t.status = 'processing'
  AND a.is_online = 0
  AND a.last_seen_at < NOW() - INTERVAL 1 HOUR
  AND t.updated_at < NOW() - INTERVAL 1 HOUR
LIMIT 100;
```

**处理**：调 `release` 接口（管理员代理）/ 调 `auto-assign` 转给其他人。

---

## 5. IM 自定义消息

### 5.1 消息注册

> IM 后端需在 `juggle.registerMessage` 列表加：

```js
[
  { name: 'jgm:ticket_assign',    isCount: true, isStorage: true },
  { name: 'jgm:ticket_resolved',  isCount: true, isStorage: true },
  { name: 'jgm:ticket_reopened',  isCount: true, isStorage: true },
  { name: 'jgm:ticket_closed',    isCount: true, isStorage: true },
  { name: 'jgm:ticket_auto_assigned', isCount: true, isStorage: true },
  { name: 'jgm:ticket_auto_closed',   isCount: true, isStorage: true },
]
```

### 5.2 Payload Schema

#### `jgm:ticket_assign`
```json
{
  "ticket_id": "tk_001",
  "operator": { "id": "u_007", "name": "小红", "avatar": "..." },
  "assignee": { "id": "u_007", "name": "小红" },
  "by": "manual"  // manual / auto_round_robin / auto_least_busy / auto_route / release
}
```

#### `jgm:ticket_resolved`
```json
{
  "ticket_id": "tk_001",
  "operator": { "id": "u_007", "name": "小红" },
  "send_csat": true,
  "note": "已退款"
}
```

#### `jgm:ticket_reopened`
```json
{
  "ticket_id": "tk_001",
  "reason": "客户追问",
  "by": "customer"  // customer / agent
}
```

#### `jgm:ticket_closed`
```json
{
  "ticket_id": "tk_001",
  "reason": "customer_silence",  // customer_silence / agent_close / admin_close
  "by": "system"  // system / agent / admin
}
```

#### `jgm:ticket_auto_assigned`
```json
{
  "ticket_id": "tk_001",
  "rule": "least_busy",
  "assignee": { "id": "u_008", "name": "坐席B" }
}
```

#### `jgm:ticket_auto_closed`
```json
{
  "ticket_id": "tk_001",
  "reason": "customer_silence"
}
```

---

## 6. 接口对照表（前端视角）

> 这一节是给前端同学对照用的，前端无需新增 SERVICE_PATH，已有的 `SERVER_PATH.TICKET_CLAIM` 等需要**扩展**而非新增。

| 文档 § | 接口 | 前端 SERVER_PATH | 改造点 |
|---|---|---|---|
| 2.2 | `GET /jmate/channels/config` | **新增** `CHANNELS_CONFIG` | 启动拉一次缓存 |
| 2.3 | `GET /jmate/tickets/list` | 已有 `TICKET_LIST` | 升级：支持 `channel_platform`、状态多值 |
| 2.3 | `GET /jmate/tickets/:id` | **新增** `TICKET_DETAIL` | 详情页用 |
| 2.4 | `POST /jmate/tickets/:id/claim` | 已有 `TICKET_CLAIM` | 升级：body 加 `expected_version` |
| 2.4 | `POST /jmate/tickets/:id/resolve` | **新增** `TICKET_RESOLVE` | |
| 2.4 | `POST /jmate/tickets/:id/reopen` | **新增** `TICKET_REOPEN` | |
| 2.4 | `POST /jmate/tickets/:id/close` | **新增** `TICKET_CLOSE` | |
| 2.4 | `POST /jmate/tickets/:id/release` | **新增** `TICKET_RELEASE` | |

> 内部 cron 接口（auto-assign / auto-close）前端**不调用**，由后端 Job 直接调。

---

## 7. 幂等性 / 并发保证

### 7.1 写接口幂等

| 接口 | 幂等键 | 重试策略 |
|---|---|---|
| claim | expected_version | version 不匹配返 17012，前端提示刷新 |
| resolve | expected_version | 同上 |
| reopen | expected_version | 同上 |
| close | expected_version | 同上 |

### 7.2 IM 消息广播幂等

- 每次状态变更广播的 IM 消息带 `event_id`（UUID），IM 端去重
- 客户端收到重复消息时直接丢弃

### 7.3 抢单冲突

```
场景：坐席 A 和坐席 B 同时点「认领」
- A 请求先到：UPDATE 成功 version=1, 广播 tag
- B 请求后到：UPDATE 失败（version=0 不匹配），返 17012
- 前端 B 收到 17012 → 弹「已被 XXX 认领」+ 列表实时刷新
```

---

## 8. 性能 / 索引建议

- `tickets.status + assignee_id` 联合索引 → 列表查询主路径
- `tickets.pending_start_at` 单独索引 → cron 扫表用
- `tickets.csat_expires_at` 索引 → csat_expire_job 用
- `ticket_status_logs` 按 ticket_id+created_at 索引 → 工单详情页拉历史用

---

## 9. 测试用例清单（后端 QA 用）

| # | 场景 | 预期 |
|---|---|---|
| T1 | pending → claim 成功 | 状态 processing，version+1，IM tag add |
| T2 | claim 时 expected_version 不匹配 | 返 17012 |
| T3 | claim 时已被他人认领 | 返 17016 |
| T4 | processing → resolve | 状态 resolved，IM tag remove，发评价卡 |
| T5 | pending → resolve（非法） | 返 17011 |
| T6 | resolved → reopen by=agent | 状态 reopened |
| T7 | resolved → reopen by=customer | 状态 reopened，pending_start_at 重置 |
| T8 | processing → close by=admin | 状态 closed |
| T9 | pending → close（非法） | 返 17011 |
| T10 | closed → claim（非法） | 返 17011 |
| T11 | release 非管理员 | 返 17010 |
| T12 | release 后工单 pending_start_at 重置 | cron 15min 后能正确触发 |
| T13 | auto_assign 离线坐席 | 自动跳过，选下一个 |
| T14 | auto_assign 无可用坐席 | 不分配，发管理员通知 |
| T15 | auto_close 72h 后 resolved 工单 | 状态 closed |
| T16 | stale_release 1h 离线 + processing | 状态 pending |
| T17 | csat_expire 7 天过期 | csat_status='expired' |
| T18 | list 多状态过滤 | 返回 status IN (...) |
| T19 | list channel_platform 过滤 | 正确过滤 |
| T20 | 状态机非法转换 | 返 17011 |

---

## 10. 实施优先级建议（给后端排期）

| 优先级 | 内容 | 工作量估 |
|---|---|---|
| **P0-1** | DDL（5 张表 / 扩展） | 0.5d |
| **P0-2** | `claim` 升级（乐观锁） | 0.5d |
| **P0-3** | `resolve` / `reopen` / `close` / `release` 新接口 | 1.5d |
| **P0-4** | 6 种 IM 自定义消息广播 | 1d |
| **P0-5** | 4 个 cron job | 1d |
| **P1-1** | `GET /jmate/tickets/list` 升级 | 0.5d |
| **P1-2** | `GET /jmate/tickets/:id` | 0.5d |
| **P1-3** | `GET /jmate/channels/config` + 初始数据 | 0.5d |
| **P2** | 内部接口（auto-assign / auto-close） | 0.5d |

合计：约 **6.5d / 1 人**

---

