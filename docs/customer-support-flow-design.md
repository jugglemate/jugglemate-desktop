# JuggleMate 客服流程设计：C 端发起 → 客服处理 → 评价 / 重开

> 范围：从客户 C 端**首条消息**起，到客服**重开 / 评价**的完整消息流。
>
> **2026-07-13 修订**：状态机精简为 **4 态**（待分配 / 处理中 / 已解决 / 重新打开），**移除 closed 业务态**（closed 字段保留作 DB 隐藏终态供 cron 清理，前端 UI 完全不可见）。
>
> 输出：①描述审核（找漏洞）②主流程图 ③时序图（多角色）④分配规则方案 ⑤数据支撑清单（前端 / 服务端）。
>
> 最新实现稿：`sprint-1-revised-frontend.md` / `sprint-1-revised-backend.md`。

---

## 1. 您的原始描述审核

### 1.1 原文（结构化复述）

```
客户 C 发起
  → 后端按渠道创建会话
  → 查渠道配置是否设置 default agent
       ├─ 有：AI Agent 直接接管会话
       └─ 无：人工模式（拉人进群 / 进收件箱）
  → 坐席在「待处理」认领
  → 处理（默认 agent = 渠道默认；可切换 agent 辅助回复）
  → 关闭 → 主动发评价卡 → 客户评价 或 重开
  → 重开 → 重新进「待处理」状态
```

### 1.2 逻辑闭环 ✅ / ⚠️ / ❌

| 步骤 | 评价 | 说明 |
|---|---|---|
| C 端发起 → 创建会话 | ✅ 闭环 | 但漏了「**会话 vs 工单**是否分离」 |
| 查渠道 default agent | ⚠️ 关键路径 | 应明确"agent 接管 = AI 自主回，还是 AI 提建议？"——影响坐席端 UX |
| 无 agent → 拉人进群 | ⚠️ 描述模糊 | "拉人进群"语义不清：是 IM 群组还是坐席间协作？建议改"分配到收件箱池" |
| 坐席在待处理位置看到 | ✅ 闭环 | 待处理视图 = exceptTag=assigned（已有协议） |
| 自己选择认领 | ✅ 闭环 | 现有 `TICKET_CLAIM` |
| 默认 agent + 可切换 | ✅ 闭环 | 需明确 agent 是"辅助建议"还是"托管"两种模式 |
| 关闭 → 发评价卡 | ⚠️ 漏 CSAT 重发 | 如果客户不评，怎么再发？什么时候算过期？ |
| 客户评价 | ✅ 闭环 | CSAT 写库 |
| 重开 → 待处理 | ⚠️ 状态机问题 | 「重新打开」= pending 还是 reopened？您后续规划里写了 reopened，建议保持 |
| | ⚠️ 缺一个 | **「客户沉默超时」**：客户发起后多久没坐席接 → 自动关 / 转人工 / 升级 |
| | ⚠️ 缺一个 | **「同一客户多渠道」**：客户从 Telegram 来过、又从 Web 来，要不要合并会话？ |
| | ⚠️ 缺一个 | **「agent 自己超时」**：AI 接管一段时间无进展，要不要转人工？ |
| | ⚠️ 缺一个 | **「坐席中途离线 / 下线」**：处理中的工单要不要自动释放回待处理？ |

### 1.3 关键边界补充（建议加进流程）

1. **客户首条消息触发**：现在 IM 已有消息进来 → 后端是否要"识别为首条"再创建工单？还是要"工单与会话生命周期独立"？
2. **agent 模式**分两种：
   - **协同模式**：agent 给建议，坐席手动采纳（您说的"辅助回复"）
   - **托管模式**：agent 自动回，客户说"转人工"才打断（您的"agent 接管"）
   - 建议**默认协同**，托管需要坐席主动开
3. **已解决 ≠ 关闭**：
   - 「已解决」= 客服点解决，认为客户满意 → 发评价卡
   - **「已关闭」业务态已移除**（DB 字段保留作为隐藏终态，仅 cron 30 天清理用，前端 UI 完全不可见）
   - 客户长期无响应 / 坐席放弃 / 超时 → 工单保持在「已解决」状态，不再流转
4. **重开归类**：
   - 客户在"已解决"状态下**主动发新消息** → 系统自动转「重新打开」→ 状态机判定后落「待分配」（无人认领）
   - 客户在"重新打开"状态下认领 → 转「处理中"
5. **分配粒度**：一个工单 = 一个会话 = 一个客户；不允许一个工单被多坐席同时认领（防抢单冲突）

---

## 2. 主流程图（泳道）

```
┌────────────┐    ┌────────────┐    ┌────────────────┐    ┌──────────────────┐    ┌────────────────┐
│  客户 C 端 │    │  IM 网关   │    │  JuggleMate     │    │  JuggleIM (SDK)  │    │  坐席端 (Agent) │
└──────┬─────┘    └──────┬─────┘    │     后端        │    └────────┬─────────┘    └────────┬───────┘
       │                 │          │ (业务服务)       │             │                      │
       │ ① 发首条消息    │          │                 │             │                      │
       │ ──────────────► │          │                 │             │                      │
       │                 │ ② 推到后端 │                 │             │                      │
       │                 │ ────────►│                 │             │                      │
       │                 │          │ ③ 查渠道配置     │             │                      │
       │                 │          │ ④ 建会话 + 工单  │             │                      │
       │                 │          │ ⑤ 判断分配策略   │             │                      │
       │                 │          │                 │             │                      │
       │                 │          │ ┌──[有 agent]──► │ ⑥ 同步 agent │                      │
       │                 │          │ │   协同/托管    │  会话上下文  │                      │
       │                 │          │ └───────────────┼────────────►│                      │
       │                 │          │                 │             │ ⑦ 推送给目标坐席     │
       │                 │          │                 │             │ ────────────────────►│
       │                 │          │ ┌──[无 agent]─┐ │             │                      │
       │                 │          │ │ 入"待处理"池 │ │             │                      │
       │                 │          │ └─────────────┘ │             │                      │
       │                 │          │                 │             │ ⑧ 坐席在「待处理」    │
       │                 │          │                 │             │    看到新工单        │
       │                 │          │                 │             │ ◄────────────────────│
       │                 │          │                 │             │                      │
       │                 │          │                 │             │ ⑨ 点「认领」        │
       │                 │          │ ◄──────────────────────────  │                      │
       │                 │          │ ⑩ claim: tag   │             │                      │
       │                 │          │   + 系统消息     │             │                      │
       │                 │          │ ──────────────►│             │                      │
       │                 │          │                 │ ⑪ 推给客户   │                      │
       │ ◄─────────────────────────────────────────────────────  │                      │
       │                 │          │                 │             │                      │
       │ ⑫ 客户继续回复  │          │                 │             │ ⑬ 坐席收到          │
       │ ─────────────────────────────────────────────────────► │                      │
       │                 │          │                 │             │                      │
       │                 │          │                 │             │ ⑭ 坐席打开会话      │
       │                 │          │                 │             │   - 看历史           │
       │                 │          │                 │             │   - 选 agent 协同    │
       │                 │          │                 │             │   - agent 给建议     │
       │                 │          │                 │             │   - 坐席采纳/改写    │
       │                 │          │                 │             │                      │
       │ ⑮ 收到坐席回复   │          │                 │             │ ⑯ 坐席点「解决」     │
       │ ◄─────────────────────────────────────────────────────  │                      │
       │                 │          │                 │             │                      │
       │                 │          │ ⑰ resolve:     │             │                      │
       │                 │          │   status=resolved│            │                      │
       │                 │          │   发评价卡       │             │                      │
       │ ◄────────────────────────────────────────────────────  │                      │
       │                 │          │                 │             │                      │
       │ ⑱ 客户评价 1-5星 │          │                 │             │                      │
       │ ─────────────────────────────────────────────────────► │                      │
       │                 │          │ ⑲ 写 CSAT 响应   │             │ ⑳ 客服看到评分     │
       │                 │          │ ──────────────►│             │                      │
       │                 │          │                 │             │ ◄────────────────────│
       │                 │          │                 │             │                      │
       │                 │          │                 │             │                      │
       │  分支 A：重开     │          │                 │             │                      │
       │ ㉑ 客户追问       │          │                 │             │                      │
       │ ─────────────────────────────────────────────────────► │                      │
       │                 │          │ ㉒ 自动 reopen  │             │                      │
       │                 │          │   status=pending│             │                      │
       │                 │          │ ──────────────►│             │                      │
       │                 │          │                 │ ㉓ 释放 tag   │                      │
       │                 │          │                 │ ㉔ 重回「待处理」 │                      │
       │                 │          │                 │ ──────────────────►│                │
       │                 │          │                 │             │ ㉕ 重新认领         │
       │                 │          │                 │             │ ◄────────────────────│
       │                 │          │                 │             │                      │
       │  分支 B：不评超时 │          │                 │             │                      │
       │ ㉖ N 小时无动作   │          │                 │             │                      │
       │                 │          │ ㉗ 自动 close   │             │                      │
       │                 │          │ ──────────────►│             │                      │
       │                 │          │                 │             │                      │
       │  分支 C：坐席中途 │          │                 │             │                      │
       │  下线 / 工单超时   │          │                 │             │                      │
       │                 │          │ ㉘ 自动 release │             │                      │
       │                 │          │   status=pending│             │                      │
       │                 │          │ ──────────────►│             │                      │
       │                 │          │                 │             │                      │
       └─────────────────┘          └─────────────────┘             └──────────────────────┘
```

---

## 3. 时序图（按角色分）

### 3.1 发起 + 分配（无 agent → 坐席认领）

```
Client(C)    IM-GW      Server(API)    Server(Job)    IM-SDK          Agent(坐席)
   │           │             │              │            │                 │
   │  ①sendMsg │             │              │            │                 │
   │ ─────────►│             │              │            │                 │
   │           │ ②push       │              │            │                 │
   │           │ ───────────►│              │            │                 │
   │           │             │ ③查渠道config│            │                 │
   │           │             │   default_agent?           │                 │
   │           │             │ ④无 → 落库    │            │                 │
   │           │             │   ticket     │            │                 │
   │           │             │   status=pending           │                 │
   │           │             │   assignee=null            │                 │
   │           │             │ ⑤push新增会话 │            │                 │
   │           │             │ ─────────►   │            │                 │
   │           │             │              │ ⑥IM事件    │                 │
   │           │             │              │ (CONV_ADDED,                 │
   │           │             │              │  tag-empty)│                 │
   │           │             │              │ ─────────►│                 │
   │           │             │              │            │ ⑦SDK 上抛       │
   │           │             │              │            │ ───────────────►│
   │           │             │              │            │                 │
   │           │             │              │            │                 │ ⑧坐席收件箱
   │           │             │              │            │                 │ 列表实时刷新
   │           │             │              │            │                 │ 显示新工单
   │           │             │              │            │                 │
   │           │             │              │            │                 │ ⑨点击「认领」
   │           │             │              │            │                 │ claim
   │           │             │ ◄─────────────────────────────── POST /jmate/tickets/:id/claim
   │           │             │              │            │                 │
   │           │             │ ⑩update      │            │                 │
   │           │             │  status=processing          │                 │
   │           │             │  assignee=坐席A             │                 │
   │           │             │              │            │                 │
   │           │             │ ⑪下发 2 个动作│            │                 │
   │           │             │  a. add assigned tag        │                 │
   │           │             │  b. add my_ticket tag       │                 │
   │           │             │ ─────────►   │            │                 │
   │           │             │              │ ⑫IM tag事件│                 │
   │           │             │              │ ─────────►│                 │
   │           │             │              │            │ ⑬SDK 通知       │
   │           │             │              │            │ ───────────────►│
   │           │             │              │            │                 │ ⑭视图切换
   │           │             │              │            │                 │ 「我的」+1
   │           │             │              │            │                 │
   │           │             │ ⑮发系统消息  │            │                 │
   │           │             │  jgm:ticketassign           │                 │
   │           │             │ ─────────►   │            │                 │
   │           │             │              │ ⑯广播      │                 │
   │           │             │              │ ─────────►│                 │
   │           │             │              │            │ ⑰气泡渲染      │
```

### 3.2 处理过程（agent 协同 / 切换）

```
Agent(A)            Server(API)        Server(AI/LLM)    IM-SDK          Client(C)
   │                     │                    │              │              │
   │ ①打开会话           │                    │              │              │
   │ GET /jmate/aibots/sessions/lookup       │              │              │
   │ ◄────────────────────│                    │              │              │
   │ ②看会话上下文        │                    │              │              │
   │ ③点「agent 建议」    │                    │              │              │
   │ POST /jmate/aibots/sessions/:id/chat     │              │              │
   │ ────────────────────►│ ④ 拿 agent 配置   │              │              │
   │                     │ ⑤ 组装 prompt     │              │              │
   │                     │ ⑥ 调 LLM          │              │              │
   │                     │ ─────────────────►│              │              │
   │                     │ ⑦ 流式返回建议     │              │              │
   │ ◄════════════════════│                    │              │              │
   │ ⑧采纳/改写          │                    │              │              │
   │ 点发送              │                    │              │              │
   │                     │                    │              │ ⑨ sendMsg   │
   │                     │                    │              │ ────────────►│
   │                     │                    │              │              │
   │ ⑩切换 agent         │                    │              │              │
   │ PATCH /jmate/aibots/sessions/:id/agent  │              │              │
   │ ────────────────────►│ ⑪更新 session     │              │              │
   │ ◄────────────────────│                    │              │              │
```

### 3.3 解决 / 重开

```
Agent(A)        Server(API)         IM-SDK           Client(C)
   │                │                   │                │
   │ ①点「解决」     │                   │                │
   │ 勾「发评价卡」   │                   │                │
   │ POST /jmate/tickets/:id/resolve    │                │
   │ ───────────────►│ ②update status=resolved            │
   │                │ release tag       │                │
   │                │ ③发 jgm:ticket_resolved            │
   │                │ ────────────────► │                │
   │                │ ④发 jgm:csat 卡片 │                │
   │                │ ─────────────────┼───────────────►│
   │                │                   │                │
   │                │                   │ ⑤ 客户点 5 星  │
   │ ◄────────────────────────────────────────────────────│
   │ POST /jmate/csat/:id/response    │                │
   │ ───────────────►│ ⑥写 csat 库     │                │
   │                │ ⑦发 jgm:csat_response              │
   │                │ ────────────────► │                │
   │                │                   │                │
   │   ─── 或者 客户重新发消息 ──────────────────────────►│
   │                │ ⑧后端检测 status=resolved + 客户新消息
   │                │   → 自动 reopen
   │                │   status=pending
   │                │   release tag     │                │
   │                │ ⑨广播 jgm:ticket_reopened           │
```

---

## 4. 分配规则方案

### 4.1 市面常见 4 种分配策略

| 策略 | 描述 | 适用 | 优 | 缺 |
|---|---|---|---|---|
| **纯认领**（您当前） | 工单入"待处理池"，坐席自己抢 | 小团队、灵活 | 实现简单、坐席自主 | 易抢单冲突、易拥堵、忙闲不均 |
| **纯自动** | 系统按规则直接分配 | 大团队、标准化 | 公平、可量化 | 不灵活、特殊场景需手动改派 |
| **认领 + 自动兜底** | 入池后 N 分钟无人认领 → 自动分配 | **主流方案** | 兼顾灵活与公平 | 规则需设计 |
| **轮询 / 按负载 / 按技能** | 三种自动子规则 | 混合团队 | 精细化 | 配置复杂 |

### 4.2 推荐方案：**认领 + 自动兜底（带子规则）**

```
新工单进入待处理池
   ↓
   ├─ 规则 1：路由到指定坐席（按来源/标签/客户等级）
   │   例如：标签 #vip → 必须坐席 A
   │   例如：来源 telegram → 坐席组 G1
   │
   ├─ 规则 2：轮询分配（Round Robin）
   │   按坐席轮值表分发
   │
   ├─ 规则 3：按负载分配（最少在办）
   │   选当前 `processing` 数最少的在线坐席
   │
   └─ 默认：留在待处理池，等认领
```

### 4.3 兜底超时设计

```
工单进入待处理池
   ↓
[0, T1) 分钟：仅"待处理"视图可见，等待人工认领
[T1, T2) 分钟：系统发提示（Toast 给所有在线坐席"工单已等待 X 分钟"）
[T2, ∞) 分钟：触发自动分配兜底
   ├─ 走规则 1/2/3 任一
   └─ 仍无坐席 → 升级（管理员 / 主管群组通知）
```

建议初值：T1 = 5min，T2 = 15min，**配在渠道层 / 全局层**可改。
> 2026-07-13 修订：超时后**不进入"已关闭"**，而是直接走自动分配兜底（pending → processing）或保持当前状态。具体规则详见 Sprint 2 设计稿。

### 4.4 抢单冲突防护

- **乐观锁**：claim 接口带 `version` 字段（前端提交当前 status，后端校验才生效），避免双坐席同时认领
- **灰度**：认领成功立即改 UI（先本地 +1），失败回滚
- **审计**：每次认领写一条 system log（谁、什么时候、哪个工单）

### 4.5 您现在应该做的决定（先选 1 个，后面好改）

| 决策点 | 建议默认 | 备注 |
|---|---|---|
| **分配模式** | 认领 + 自动兜底 | 兜底超时 15min |
| **自动分配子规则** | 按负载（最少在办） | 易解释、易调 |
| **路由规则** | 仅支持"按渠道"路由到指定坐席组 | 复杂路由留 V2 |
| **兜底仍无人** | 升级到管理员 + 群组通知 | 不强制分配，避免半夜打扰 |
| **优先级** | 暂不实现（按您的要求） | — |
| **VIP / 加急** | 等优先级模块上线后再做 | — |

---

## 5. 数据支撑清单

### 5.1 前端需要的数据

#### 5.1.1 渠道配置（拉一次缓存）

```js
// 来源：GET /jmate/channels/config
{
  platform: 'web' | 'telegram' | 'jugglechat',
  default_agent_id: 'gcwknn85zss' | null,   // null = 无 agent，走人工
  default_mode: 'collaborative' | 'managed', // agent 默认是协同还是托管
  available_agents: ['gcwknn85zss', 'gj4qls9yfwc'], // 该渠道可用 agent 列表
  assignment_rule: 'manual' | 'round_robin' | 'least_busy' | 'route',
  route_target: { type: 'agent' | 'team', id: 'u_007' | 't_001' } | null,
  sla_minutes: 30 | null,
  auto_close_hours: 72 | null,
  csat_template: '请问您对本次服务满意吗？'
}
```

#### 5.1.2 工单详情（实时）

> 同 `customer-support-frontend-iteration-plan.md §2` 的 schema，**本轮无需新增**字段。

#### 5.1.3 Agent 列表（已有 mock）

> `__MOCK_AGENTS__` 即可。本轮新增：每个 agent 加 `mode: 'collaborative'|'managed'`、`default: bool`、`available_platforms: []`。

#### 5.1.4 实时事件（IM SDK 推送）

| 事件 | 触发 | 前端响应 |
|---|---|---|
| `CONVERSATION_ADDED` | 新工单入池 | 「待处理」+1 |
| `MESSAGE_RECEIVED` | 客户发消息 | 消息流更新 + 角标 +1 |
| `TAG_CONVERSATION_ADDED/REMOVED` | tag 变化 | 列表视图切换 |
| `jgm:ticket_assign` | 系统通知 | 气泡 |
| `jgm:ticket_resolved` | 解决 | header 状态切换 |
| `jgm:ticket_reopened` | 重开 | 列表回待处理 |
| `jgm:ticket_closed` | 关闭 | header 状态切换 |
| `jgm:csat` | 评价卡 | 客服侧预览 |
| `jgm:csat_response` | 客户评价 | 客服侧显示分数 |
| `jgm:note` | 内部备注 | 灰色气泡 |

### 5.2 服务端需要预留的字段 / 表

#### 5.2.1 渠道配置表 `channel_configs`

```sql
CREATE TABLE channel_configs (
  id              BIGINT PK,
  platform        VARCHAR(32) UNIQUE NOT NULL,    -- 'web' | 'telegram' | 'jugglechat'
  default_agent_id VARCHAR(64),                    -- NULL = 走人工
  default_mode    VARCHAR(16) DEFAULT 'collaborative',
  available_agents JSON,                           -- ['agent_id_1', 'agent_id_2']
  assignment_rule VARCHAR(32) DEFAULT 'manual',    -- 'manual'|'round_robin'|'least_busy'|'route'
  route_target    JSON,                            -- { type, id }
  auto_claim_timeout_min INT DEFAULT 15,           -- 自动分配兜底
  auto_close_hours        INT DEFAULT 72,          -- 客户沉默超时
  csat_enabled     TINYINT(1) DEFAULT 1,
  csat_template    VARCHAR(512),
  sla_minutes      INT DEFAULT NULL,
  updated_at       TIMESTAMP
);
```

#### 5.2.2 工单表 `tickets`（在原有基础上扩展）

```sql
ALTER TABLE tickets ADD COLUMN
  -- 分配相关
  assignment_rule          VARCHAR(32) DEFAULT 'manual',   -- 触发此次分配的规则
  auto_assigned_at         TIMESTAMP NULL,                 -- 自动分配时刻
  auto_assign_reason       VARCHAR(64) NULL,               -- 'timeout' | 'rule_match' | 'manual_override'

  -- 渠道/agent 关系
  channel_config_id        BIGINT NULL,
  current_agent_id         VARCHAR(64) NULL,               -- 当前协同 agent
  current_agent_mode       VARCHAR(16) DEFAULT 'collaborative', -- 'collaborative'|'managed'

  -- 路由目标（人工模式下）
  routed_agent_id          VARCHAR(64) NULL,
  routed_team_id           VARCHAR(64) NULL,

  -- 重开 / CSAT
  reopen_count             INT DEFAULT 0,
  csat_score               TINYINT NULL,
  csat_comment             VARCHAR(512) NULL,
  csat_responded_at        TIMESTAMP NULL,
  csat_expires_at          TIMESTAMP NULL,                 -- 评价卡超时时间

  -- 抢单防护
  version                  INT DEFAULT 0,                  -- 乐观锁

  -- 关闭
  closed_reason            VARCHAR(64) NULL,               -- 'agent_close' | 'customer_silence' | 'admin_close'
  closed_at                TIMESTAMP NULL,

  INDEX idx_status_assignee (status, assignee_id),
  INDEX idx_channel_status (channel_config_id, status)
);
```

#### 5.2.3 工单状态变更日志 `ticket_status_logs`（审计 + 报表）

```sql
CREATE TABLE ticket_status_logs (
  id          BIGINT PK,
  ticket_id   VARCHAR(64),
  from_status VARCHAR(16),
  to_status   VARCHAR(16),
  operator_id VARCHAR(64),   -- 'system' | 坐席 ID
  reason      VARCHAR(256),
  created_at  TIMESTAMP,
  INDEX idx_ticket (ticket_id, created_at)
);
```

#### 5.2.4 认领日志 `ticket_claim_logs`

```sql
CREATE TABLE ticket_claim_logs (
  id          BIGINT PK,
  ticket_id   VARCHAR(64),
  agent_id    VARCHAR(64),
  claim_type  VARCHAR(16),   -- 'manual' | 'auto_round_robin' | 'auto_least_busy' | 'auto_route'
  source      VARCHAR(16),   -- 'pending_pool' | 'reopen' | 'transfer'
  created_at  TIMESTAMP
);
```

#### 5.2.5 Agent 表扩展 `agents`

```sql
ALTER TABLE agents ADD COLUMN
  default_platforms JSON,                  -- ['telegram','web']
  max_concurrent   INT DEFAULT 10,         -- 同时在办上限
  skills           JSON,                   -- ['refund','vip']  远期
  is_online        TINYINT(1) DEFAULT 0,
  last_seen_at     TIMESTAMP
```

### 5.3 服务端需要新增 / 升级的接口

#### 5.3.1 渠道配置

| 路径 | 方法 | 说明 |
|---|---|---|
| `/jmate/channels/config` | GET | 拉所有渠道配置（前端启动时拉一次缓存） |
| `/jmate/channels/:platform/config` | GET/PATCH | 单渠道配置管理（管理端，本轮 UI 不上） |

#### 5.3.2 工单基础（沿用规划文档 §8，本节仅列新增）

| 路径 | 方法 | 新增 |
|---|---|---|
| `/jmate/tickets/list` | GET | 升级：支持 `channel_platform`、`route_target` 过滤 |
| `/jmate/tickets/:id` | GET | 升级：返回 `current_agent_id`、`current_agent_mode`、`reopen_count`、`csat_expires_at`、`version` |
| `/jmate/tickets/:id/claim` | POST | **升级**：body 加 `{ expected_version }`（乐观锁），返回 `version` 给前端 |

#### 5.3.3 自动分配兜底（新增）

| 路径 | 方法 | 说明 |
|---|---|---|
| `/jmate/internal/tickets/auto-assign` | POST | 后端 cron 调用，按 channel 规则给超时工单分配 assignee |
| `/jmate/internal/tickets/auto-close` | POST | 后端 cron 调用，关闭超时沉默工单 |

#### 5.3.4 IM 自定义消息（新增）

> 已经在 `customer-support-frontend-iteration-plan.md §8.7` 列出，本节确认清单：

| 消息名 | 触发 | payload |
|---|---|---|
| `jgm:ticket_assign` | claim 成功 | `{ticket_id, assignee, ts}` |
| `jgm:ticket_resolved` | resolve | `{ticket_id, operator, send_csat}` |
| `jgm:ticket_reopened` | 重开 | `{ticket_id, reason, by: 'customer'|'agent'}` |
| _无_ | _closed 业务态已移除_ | _前端 UI 不可见_ |
| `jgm:ticket_auto_assigned` | 自动分配 | `{ticket_id, rule, assignee}`（通知原待处理池"已被领走"） |
| `jgm:csat` | 发评价卡 | `{ticket_id, expires_at}` |
| `jgm:csat_response` | 客户评 | `{ticket_id, score, comment?}` |
| `jgm:note` | 内部备注 | `{ticket_id, content, operator}` |

### 5.4 后端 Job / 定时任务

| 名称 | 周期 | 作用 |
|---|---|---|
| `auto_assign_job` | 每 1 min | 扫 `status=pending AND created_at < now() - T1`，触发兜底分配 |
| `auto_close_job` | 每 10 min | 扫 `status=resolved AND customer_silence_at < now() - T2` 或 `status=processing AND assignee_offline AND last_msg_at < now() - T3`，触发关闭 |
| `csat_expire_job` | 每 1 hour | 扫 `csat_sent=true AND csat_expires_at < now()`，标 `csat_status='expired'` |
| `stale_release_job` | 每 5 min | 扫 `status=processing AND assignee_status='offline'` 超时，release 回 pending |

---

## 6. 一句话总览

- **流程图**：5 阶段（发起 → 分配 → 处理 → 解决 → 重开/超时）
- **时序图**：4 个核心场景（发起+认领 / agent 协同 / 解决 / 重开）
- **分配规则**：**认领 + 自动兜底**（5min 提示、15min 自动轮询或按负载）
- **抢单防护**：乐观锁 `version` 字段
- **超时关闭**：客户沉默 72h、坐席离线 1h 自动释放
- **前端**：3 类数据（渠道配置、工单详情、IM 事件）
- **后端**：5 类新增（channel_configs 表、tickets 表扩字段、claim_logs 表、status_logs 表、agents 扩字段）+ 1 套定时 job + 8 个 IM 自定义消息

---

