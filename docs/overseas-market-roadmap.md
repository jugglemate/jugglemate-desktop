# 海外市场客服坐席端补强路线图

> 范围：`/Users/helena/Work/code/ai/jugglemate-customer-chat` + `/Users/helena/Work/code/ai/jugglemate-desktop`
>
> 目标：先把“能稳定服务海外客户”的基础能力补齐，再做 AI 和行业差异化。

## 1. 结论先行

现阶段两端已经具备一个可用的客服闭环雏形：

- 客户侧已经能完成 start、IM 连接、历史消息、图片/文件发送、人工转接事件、基础 i18n，以及访客身份持久化；关键入口在 `src/facade/JuggleChat.ts:69-220`、`src/facade/JuggleChat.ts:254-394` 和 `src/config/defaults.ts:16-116`。
- 坐席侧已经能看到会话列表、按渠道筛选、加载历史、做 AI 辅助回复、认领/转移工单，并查看客户历史工单和部分客户信息；关键入口在 `src/services/api.js:4-70`、`src/services/agent.js:41-399`、`src/components/Conversations.vue`、`src/components/ChatMain.vue`、`src/components/AgentPanel.vue`。

但如果目标是海外市场，这套能力还不够生产化。当前最先要补的是：

1. **安全与配置**：去掉硬编码 AppKey / Authorization / 固定 API 地址，支持区域化部署。
2. **隐私与合规**：同意、保留、删除、脱敏、审计必须先做。
3. **真实生命周期**：handoff、claim、transfer、resolve、reopen、close 要形成统一状态机。
4. **实时可靠性**：断线重连、游标恢复、事件重放、状态重同步要补齐。
5. **国际化**：桌面端英文、本地化时间、时区、长字符串、RTL 基础。
6. **海外运营 MVP**：至少打通一个海外渠道，并把搜索、分页、权限、CSAT/SLA、报表和 CRM/Webhook 做起来。

---

## 2. 当前能力基线

### 客户侧现状

- `src/start/customerStart.ts:46-83` 负责启动会话、获取 IM token、conversationId 和 welcome message。
- `src/facade/JuggleChat.ts:69-220` 负责 boot、IM 初始化、连接和欢迎语注入。
- `src/facade/JuggleChat.ts:254-306` 已支持 text/image/file 发送。
- `src/facade/JuggleChat.ts:335-394` 已支持历史拉取和 `transferToHuman()` 事件，但它目前只是事件，不是后端 handoff。
- `src/config/defaults.ts:16-116` 里已经有 region、language、csat、workingHours、persistVisitor、showTransferToHuman 等配置入口。

### 坐席侧现状

- `src/services/api.js:4-70` 已有工单列表、认领、转移、成员列表、客户工单、客户详情、Agent 列表等接口。
- `src/services/agent.js:41-399` 已有转移候选拉取、active agent 列表、SSE 流式 AI 回复、绑定/解绑工单与 Agent。
- `src/services/agent.js:270-274` 的 SSE 请求仍然硬编码 AppKey 和 Authorization，这是海外化和安全的高优先级问题。
- `src/components/Conversations.vue` 以本地过滤/多请求交集做渠道和状态筛选，适合早期验证，不适合大规模海外数据量。
- `src/components/ChatMain.vue` 和 `src/components/AgentPanel.vue` 已承担历史消息和客户上下文展示，但客户信息仍存在 demo 回退和局部硬编码问题。

---

## 3. 优先级路线

## P0 — 海外生产阻断项

这一层不做完，海外市场只能算 demo，不能算可交付产品。

### P0.1 统一 customer / conversation / ticket / channel 数据模型

**为什么要先做：**
现在客户侧、坐席侧、IM 和工单的标识并不完全统一。海外一旦接入更多渠道、支持重开/转派/状态变更，就会出现重复单、错绑单和状态漂移。

**要补什么：**
- 明确 customer_id、visitor_id、conversation_id、ticket_id、channel_identity 的关系。
- 定义 ticket status machine：pending / processing / resolved / reopened / closed。
- 统一 source message id、idempotency key、assignment version、audit log。
- 让客户端不要再靠局部推断替代后端契约。

**建议涉及文件：**
- `src/facade/JuggleChat.ts:335-394`
- `src/services/api.js:39-70`
- `src/services/agent.js:349-399`
- `src/common/enum.js`

### P0.2 去掉硬编码凭证和固定区域配置

**为什么要先做：**
`src/services/agent.js:270-274` 直接把 AppKey 和 Authorization 写死在请求里；`src/config.js:4-16` 也有固定 API 地址和 IM server。海外部署、审计和安全都会直接卡住。

**要补什么：**
- 统一请求鉴权层，HTTP 和 SSE 共用同一套 auth builder。
- API base、AppKey、IM server、region、tenant 全部配置化。
- 只保留短期 token 或 session token，不把生产密钥放进 bundle。
- 如果需要，SSE 改成后端代理或短期签名。

**建议涉及文件：**
- `src/services/agent.js:126-140,252-347`
- `src/config.js:4-25`
- `src/common/request.js`
- `src/facade/JuggleChat.ts:79-160`

### P0.3 隐私、同意、保留、删除、脱敏

**为什么要先做：**
海外市场首先看 GDPR / data lifecycle / consent。当前客户端默认持久化访客 ID，且没有完整的删除、导出、脱敏和 retention 控制。

**要补什么：**
- 访客持久化开关与 consent 流程。
- 删除/导出 customer、conversation、ticket、message、attachment、analytics 的能力。
- 日志、AI prompt、SSE payload、客服记录脱敏。
- 数据保留策略和地域存储策略。

**建议涉及文件：**
- `src/config/defaults.ts:16-116`
- `src/facade/JuggleChat.ts:308-435`
- `src/identity/Visitor.ts`
- `src/start/customerStart.ts:46-83`

### P0.4 真正的 handoff + 完整工单状态机

**为什么要先做：**
现在客户侧的 `transferToHuman()` 只是发事件，坐席侧虽然有 claim / transfer，但没有 resolve / reopen / close 的完整闭环。对海外客户而言，这会直接影响 SLA 和满意度。

**要补什么：**
- 人工接管要成为后端动作，而不是纯前端事件。
- 工单状态机要支持 resolved、reopened、closed 的回流与约束。
- 客户消息在 resolved/closed 后的处理规则要明确：重开还是新单。
- 所有状态变更要有审计和幂等。

**建议涉及文件：**
- `src/facade/JuggleChat.ts:386-394`
- `src/services/api.js:39-52`
- `src/components/ChatMain.vue`
- `src/components/Conversations.vue`

### P0.5 实时连接重连、恢复和重放

**为什么要先做：**
海外网络环境更复杂，移动网络和代理切换更常见。只靠当前 IM 连接和 SSE 流，断线后很容易出现消息、状态和 AI 回复错位。

**要补什么：**
- IM 和 SSE 的 reconnect / backoff / heartbeat。
- cursor / last-event-id / message replay。
- 断线后重新同步 ticket status、assignment 和 unread。
- UI 明确展示连接状态、降级状态、恢复状态。

**建议涉及文件：**
- `src/im/IMAdapter.ts`
- `src/im/jim/JIMChannel.ts`
- `src/common/im.js`
- `src/services/agent.js:252-347`

### P0.6 英文桌面、时区和基础本地化

**为什么要先做：**
客户侧虽然已经有 zh-CN / en-US 的基础，但坐席端目前仍偏中文，并大量使用本地时间格式。海外销售和交付都需要一致的语言/时间体验。

**要补什么：**
- 坐席端统一英文可用。
- 时间、日期、SLA 和工作时间改成 locale/timezone aware。
- 长文案、截断、表格宽度和 RTL 基础准备好。

**建议涉及文件：**
- `src/common/enum.js`
- `src/components/Conversations.vue`
- `src/components/ChatMain.vue`
- `src/views/LoginView.vue`
- `src/views/MainView.vue`

---

## P1 — 海外运营 MVP

这一层决定你能不能开始卖，而不是只能内部试用。

### P1.1 先打通一个海外渠道的端到端闭环

**建议策略：**
不要一开始就全渠道铺开。先选一个海外渠道做端到端闭环，再复制适配层。优先级可按目标市场选择 Web + WhatsApp / Telegram / Instagram / LINE 其中一个。

**要补什么：**
- 渠道适配器接口。
- 渠道身份映射、收发、回执、附件、Webhook 验证。
- 每个渠道的 opt-out / 合规提醒。

**验收标准：**
客户从该渠道发起咨询后，能够完成 AI 首答、转人工、坐席回复、工单转移、状态变更和结束闭环。

### P1.2 服务端搜索、游标分页和大规模数据过滤

**为什么要做：**
`src/components/Conversations.vue` 现在更多是本地过滤和多请求交集，数据量上来后会失真。海外客户一旦量大，这种实现会明显卡顿。

**要补什么：**
- conversation / ticket / customer 统一搜索。
- 渠道、状态、坐席、日期、未读等服务端过滤。
- cursor pagination 和稳定排序。

**建议涉及文件：**
- `src/components/Conversations.vue`
- `src/services/api.js`
- `src/components/ChatMain.vue`

### P1.3 真实客户数据、角色权限、审计和 SSO 基线

**为什么要做：**
`src/components/AgentPanel.vue` 还存在 demoProfile 回退；权限也主要是 admin / non-admin 的粗粒度控制。海外企业客户会马上问 SSO、审计和角色隔离。

**要补什么：**
- 真实 customer detail 和 historical ticket 数据。
- role / permission matrix，至少 agent / supervisor / admin。
- 审计日志和敏感操作记录。
- SSO / OIDC / SAML 的基础方案。

**建议涉及文件：**
- `src/components/AgentPanel.vue`
- `src/views/LoginView.vue`
- `src/views/MainView.vue`
- `src/components/NavSidebar.vue`

### P1.4 CSAT、SLA 和基础运营分析

**为什么要做：**
海外客户会非常关注响应时长、解决率、满意度和 SLA。没有这些指标，就很难和 Zendesk / Salesforce / Microsoft / Genesys 的产品语言对齐。

**要补什么：**
- CSAT 评价。
- 首响、解决时长、SLA breach。
- 队列、坐席、渠道、工单和 AI 使用情况报表。
- CRM / webhook / event export。

**建议涉及文件：**
- `src/services/api.js`
- `src/views/MainView.vue`
- `src/components/Conversations.vue`
- `src/components/ChatMain.vue`

---

## P2 — 规模化能力

这一层是做大后拉开差距的能力，但不应阻塞海外首发。

### P2.1 多渠道适配器框架

- 增加 WhatsApp、LINE、Instagram、Facebook Messenger、Email、WebChat 等适配器。
- 统一消息模型、回执、附件和状态。
- 做渠道健康监控和限流。

### P2.2 消息翻译和多语言协作

- 坐席端“原文 / 翻译文”切换。
- AI 翻译的出处标记和敏感内容保护。
- 客户端和坐席端都能显示 locale。

### P2.3 标签、内部备注、优先级和自动分配

- 标签、内部备注、优先级、自动分派、自动升级。
- 支持工作时间、节假日和地区差异。

### P2.4 完整报表和区域数据驻留

- 各渠道、各地区、各产品线、各坐席的报表。
- 数据驻留、租户隔离和区域路由。
- 附件安全扫描和签名下载。

### P2.5 离线和降级模式

- 对消息发送、工单操作和 AI 建议做可恢复队列。
- 任何依赖服务中断时，UI 仍然可操作但明显提示降级。

---

## P3 — 差异化能力

这一层更适合在基础闭环可用、指标稳定后再投入。

### P3.1 AI Copilot 深化

- grounded knowledge。
- 建议回复带引用。
- 自动摘要、自动分类、自动路由。
- 质量评分和 AI 结果追踪。

### P3.2 全量质检和客服教练

- 全量会话质检。
- 违规提醒、风险提醒、教练建议。
- 面向 supervisor 的 coaching view。

### P3.3 主动服务和客户健康度

- 基于产品事件、订单、支付、物流或使用行为主动触达。
- 客户健康度和流失预警。
- 与 CRM / 订单 / 订阅系统联动。

### P3.4 预测和容量规划

- 峰值预测。
- 人力调度建议。
- 渠道和区域的服务成本分析。

---

## 4. 推荐实施顺序

### 第 1 阶段：先把“能安全卖出去”补齐

1. 去硬编码凭证和固定区域。
2. 完成隐私、保留、删除、脱敏。
3. 建真实 handoff 和完整 ticket 状态机。
4. 补实时重连和恢复。
5. 做英文桌面和时区基础。

### 第 2 阶段：打通一个海外可卖的 MVP

1. 选一个海外渠道做全链路闭环。
2. 做服务端搜索和分页。
3. 补角色权限、审计和 SSO 基线。
4. 加 CSAT、SLA 和基础报表。
5. 打通 CRM / webhook / event export。

### 第 3 阶段：扩大覆盖和能力上限

1. 多渠道适配器。
2. 翻译和多语言协同。
3. 标签、备注、自动分配、区域路由。
4. 完整报表、数据驻留和附件安全。

### 第 4 阶段：做 AI 差异化

1. Copilot grounding。
2. 自动分类、自动路由和全量质检。
3. 主动服务和客户健康度。
4. 预测和容量规划。

---

## 5. 风险清单

| 风险 | 影响 | 处理方式 |
|---|---|---|
| 硬编码凭证泄露 | 安全和合规直接失败 | 把 auth 和 region 配置化，统一请求层 |
| 生命周期不一致 | 重复单、错单、漏单 | 统一 ticket state machine 和幂等键 |
| 断线后状态漂移 | 消息、AI、工单错位 | reconnect + replay + resync |
| 只做中文 UI | 海外销售和交付受阻 | 全面英文化 + locale/timezone |
| 只做本地筛选 | 数据量大时性能和准确性差 | 后端搜索和分页 |
| AI 先于流程 | 功能看起来强，但无法交付 | 先补底层流程，再做 Copilot |

---

## 6. 本次结论

如果你们要先冲刺海外市场，**最优先不是扩更多 AI 功能，而是把“能稳定、合规、可运营”做出来**。最值得先做的，是：

1. 安全配置化；
2. 隐私和数据生命周期；
3. 真实 handoff 和 ticket 状态机；
4. 断线恢复；
5. 英文桌面和时区；
6. 一个海外渠道闭环；
7. 服务端搜索 / 权限 / CSAT / SLA / 报表。

等这些补齐后，再上多渠道、翻译、自动路由和 AI Copilot，产品才有机会在海外市场真正站住。
