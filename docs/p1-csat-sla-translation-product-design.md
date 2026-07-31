# P1.4 CSAT / SLA / Analytics + Multilingual Translation Product Design

> 适用范围：`jugglemate-desktop` 为主，必要时同步影响 `jugglemate-customer-chat`
>
> 目标：把客服坐席端补成一个能面向海外卖的“服务质量 + 多语言协作”模块，而不是只做会话列表和回复窗口。

---

## 1. 设计目标

本次只细化两块能力：

1. **CSAT、SLA 和基础运营分析**
2. **消息翻译和多语言协作**

这两块是海外市场最容易被问到的能力：

- 客户会问：首响多久？多久解决？超 SLA 了吗？满意不满意？
- 主管会问：哪个渠道最慢？哪个队列最忙？哪些工单 AI 参与后更快？
- 海外客户会问：原文在哪？译文是否可信？能不能看到客户原话？敏感信息会不会被外部翻译服务带走？

这两个能力不能做成“两个零散按钮”，而要做成一套可以被 UI、接口、报表和后续自动化一起消费的产品能力。

---

## 2. 竞品实现模式归纳

下面不是逐家复刻，而是提炼成熟产品普遍采用的逻辑。

### 2.1 CSAT / SLA / Analytics 的竞品共性

#### Zendesk
- 常见做法是把 **CSAT 放在工单关闭后自动触发**，不影响客服处理过程。
- SLA 通常是 **策略化配置**：不同工单优先级、业务线、时间段对应不同 SLA。
- 报表会把 **响应时间、解决时间、队列时长、工单量、坐席绩效** 放在一起看。
- 好的地方在于：主管不是只看“满意度分”，而是把 CSAT 和 SLA、回复质量、工单量联动。

#### Salesforce / Microsoft / Genesys
- 更强调 **运营 dashboard**：按渠道、队列、坐席、知识、AI 使用量、服务水平分层。
- SLA 和 routing 往往是一个系统：先决定谁接，再决定是否超时、是否升级。
- 企业级产品会把 **质量评估、客户健康、AI 介入效果** 也接进报表。

#### Intercom / Zoho Desk
- 更适合做 **帮助台型闭环**：
  - 关闭后问卷；
  - 解决时长；
  - 首响时间；
  - SLA breach；
  - 人工 / AI 处理对比。
- 逻辑上非常强调：**“客户评价”只是一层，真正要看的是“评价前后发生了什么”**。

#### 国内产品（Udesk / 腾讯企点 / 华为 AICC / 智齿）
- 更常见的是 **报表 + SLA + 工单流转 + 坐席绩效** 一起给。
- 海外化时需要补的不是“有没有报表”，而是：
  - 字段定义是否国际化；
  - 时区是否正确；
  - 多语言界面是否完整；
  - 是否支持更标准的 webhook / export。

### 2.2 Translation / Multilingual 的竞品共性

#### Microsoft / Google / enterprise contact center
- 翻译一般不是“覆盖整段页面”，而是 **按会话/消息/片段翻译**。
- 常见逻辑是：
  - 原文永久保留；
  - 译文作为辅助层；
  - 明确标记来源；
  - 有时会显示置信度或“机器翻译”标签。
- 好产品会让坐席 **一键切换原文/译文**，而不是只看翻译。

#### Zendesk / Intercom / Zoho 类帮助台
- 更常见的方式是把翻译能力嵌入 **知识库、宏、回复建议或消息处理** 中。
- 重点不是“翻译得多炫”，而是：
  - 译文有没有保留上下文；
  - 术语是否一致；
  - 敏感内容是否被外发；
  - 是否能让主管追溯原文。

#### 成熟产品的共同原则
1. **原文永远不可丢**
2. **译文是辅助，不是覆盖**
3. **翻译是上下文相关的**
4. **翻译需要可追溯**
5. **敏感内容必须可脱敏 / 可关闭外部翻译**
6. **语言、地区、时区必须和工单 / SLA 绑定**

---

## 3. 这两块能力在产品里的定位

### 3.1 CSAT / SLA / Analytics 的定位

它不是“报表页”，而是坐席端的运营基础设施。

在产品里它应当支持三层人群：

- **坐席**：知道自己这单剩多久、是否超时、是否要升级。
- **主管**：知道哪个队列、坐席、渠道、工单类型在拖慢。
- **产品 / 运营**：知道 AI、知识库、流程优化到底有没有提升结果。

### 3.2 Multilingual / Translation 的定位

它不是单纯的翻译工具，而是 **跨语言协作层**。

在产品里它应当支持三层对象：

- **客户**：用自己的语言发消息。
- **坐席**：用自己的语言理解、回复、必要时查看原文。
- **主管 / 审计**：可以追溯原文、译文和翻译动作。

---

## 4. CSAT / SLA / Analytics 详细产品设计

## 4.1 核心对象模型

建议把下面几个对象做成后端一级实体，而不是只存前端状态：

### Ticket / Conversation 维度
- `ticket_id`
- `conversation_id`
- `customer_id`
- `channel`
- `priority`
- `status`
- `assignee_id`
- `team_id`
- `locale`
- `timezone`
- `opened_at`
- `first_response_at`
- `resolved_at`
- `closed_at`
- `reopened_at`
- `sla_policy_id`
- `csat_survey_id`

### SLA 维度
- `first_response_target_seconds`
- `resolution_target_seconds`
- `business_hours_only`
- `pause_conditions`
- `breach_actions`
- `warning_thresholds`
- `escalation_rules`

### CSAT 维度
- `survey_type`
- `trigger_event`
- `trigger_delay_seconds`
- `delivery_channel`
- `rating_value`
- `comment`
- `submitted_at`
- `submitted_by`
- `hidden_reason`

### Analytics 事件维度
- `event_type`
- `event_timestamp`
- `actor_type`
- `actor_id`
- `ticket_id`
- `channel`
- `queue_id`
- `agent_id`
- `duration_ms`
- `metadata`

---

## 4.2 CSAT 设计

### 4.2.1 触发时机

建议支持三种触发方式：

1. **自动触发**
   - 工单关闭后自动弹出 / 推送评分。
   - 适合绝大多数海外场景。

2. **人工重发**
   - 主管或坐席手动重发一次评分请求。
   - 适合客户没收到、客户要求补评、异常关闭修正。

3. **规则触发**
   - 某些高优先级工单、某类渠道、某些地区使用不同问卷或不同发送延迟。

### 4.2.2 评分形态

建议从轻到重支持三种：

- **Emoji / Smiley**：适合轻量客户场景。
- **1~5 星**：最常见，容易进入报表。
- **1~10 分**：适合更细颗粒度分析。

不建议一开始做太复杂的组合问卷。海外 MVP 先做：

- 评分
- 可选评论
- 可选原因标签

### 4.2.3 CSAT 的发送逻辑

#### 标准流程
1. 工单进入 `resolved` 或 `closed`。
2. 系统根据 `csat_policy` 判断是否发送。
3. 若允许，经过 `trigger_delay` 后发送问卷。
4. 客户提交后写入 CSAT 记录。
5. 报表更新，同时把结果回写到 ticket timeline。

#### 过滤规则
- 同一工单只发一次，除非手动重发。
- 已回复过的重复请求不覆盖结果，只能形成新记录并标记版本。
- 对某些渠道可禁用评分（例如某些纯被动通知渠道）。

### 4.2.4 CSAT 在 UI 中怎么呈现

#### 坐席侧 Ticket Detail
- 一个 **CSAT 卡片**：
  - 当前状态：未发 / 已发 / 已收 / 已过期 / 已忽略
  - 最近评分
  - 最近留言
  - 评分发送时间
  - 是否来自自动触发
- 工单列表可显示一个 **小徽标**：
  - `CSAT 5`
  - `CSAT pending`
  - `CSAT n/a`

#### 主管 Dashboard
- CSAT 趋势图
- 按队列 / 渠道 / 坐席 / 工单类型的平均评分
- 负面评论 Top N 主题
- 低分工单回溯到责任坐席 / 流程 / 频道

### 4.2.5 CSAT 的产品逻辑

CSAT 不应该只是“评分收集”，而要能回答下面四个问题：

1. 哪些工单类型最容易低分？
2. 哪些坐席 / 队列 / 渠道更容易低分？
3. 低分前是否发生超时、升级、转派、重开？
4. 低分是因为服务态度、响应速度、还是结果不满意？

---

## 4.3 SLA 设计

### 4.3.1 SLA 的层级

建议做三层 SLA：

1. **全局默认 SLA**
   - 适合没有复杂配置的租户。

2. **队列 / 渠道 / 优先级 SLA**
   - 按不同业务线和渠道区分。

3. **客户等级 / 合同 SLA**
   - VIP、企业客户、普通客户、特定地区客户可以不同。

### 4.3.2 SLA 指标

最少支持：

- **First Response SLA**：首次响应时限
- **Resolution SLA**：解决时限

建议增加：

- **Wait SLA**：排队等待时限
- **Escalation SLA**：升级处理时限
- **Reopen SLA**：重开后的新 SLA 规则

### 4.3.3 SLA 计时规则

#### 时间计算原则
- 支持 **工作时间 / 非工作时间**。
- 支持 **暂停 / 恢复**。
- 支持 **节假日 / 时区 / 地区工作日**。
- 支持 **人工接手前的机器人阶段是否计时** 的可配置规则。

#### 暂停条件示例
- 客户等待补充信息。
- 工单被转派到其他队列。
- 系统异常或人工标记为 paused。
- 外部系统依赖未返回。

#### 恢复条件示例
- 客户补充信息后恢复计时。
- 人工重新激活工单后恢复计时。
- 自动重试成功后恢复计时。

### 4.3.4 SLA 状态机

建议至少有：

- `on_track`
- `warning`
- `breached`
- `paused`
- `resolved_before_breach`
- `resolved_after_breach`

### 4.3.5 SLA 在 UI 中怎么呈现

#### Ticket Detail 顶部
建议放一个醒目的 SLA 区块：

- 首响倒计时
- 解决倒计时
- 当前状态颜色
- 是否暂停
- 触发告警时间
- 预计 breach 时间

#### Ticket List
建议放两个轻量字段：

- `FRT 00:12`
- `RES 01:45`

如果已 breach，显示红色 warning chip。

#### 主管视图
- SLA 达成率
- 超时数
- 超时 Top 队列 / 坐席 / 渠道 / 工单类型
- 暂停比例
- 工作时间外积压

### 4.3.6 SLA 的产品逻辑

SLA 最重要的不是“显示倒计时”，而是：

1. 能不能准确暂停和恢复；
2. 能不能按不同业务线定不同规则；
3. 能不能把 breach 和责任归因拆开；
4. 能不能对外 export / webhook。

---

## 4.4 基础运营分析设计

### 4.4.1 指标层级

#### 基础服务效率
- 接待量
- 首响时长
- 平均处理时长
- 平均等待时长
- 解决时长
- 转派率
- 重开率
- 放弃率

#### 服务质量
- CSAT
- 低分率
- 质检分
- 差评原因分布
- 投诉率
- 重复咨询率

#### 资源效率
- 队列负载
- 坐席在线率
- 坐席利用率
- 峰值流量
- 闲置率

#### AI 效果
- AI 首答占比
- AI 解决率
- AI 转人工率
- AI 建议采纳率
- AI 参与后的平均处理时长

### 4.4.2 报表维度

最少要能切：

- 时间
- 渠道
- 队列
- 坐席
- 工单类型
- 优先级
- 地区 / 时区
- 客户等级
- AI / 人工

### 4.4.3 报表页面建议

建议拆成 4 个页面：

1. **Overview**
   - 今日概况
   - SLA 风险
   - CSAT 趋势
   - 队列压力

2. **Conversation / Ticket Analytics**
   - 渠道、工单类型、响应、解决、重开

3. **Agent Performance**
   - 坐席处理量、速度、CSAT、超时、AI 采纳

4. **AI & Knowledge Analytics**
   - AI 使用、知识命中、AI 转人工、建议采纳率

### 4.4.4 对外输出

建议报表支持：
- CSV / Excel 导出
- Webhook / event export
- 按租户 / 项目 / 团队定时推送
- API 查询

---

## 5. Multilingual / Translation 详细产品设计

## 5.1 设计目标

要让客服系统支持海外用户，翻译不是附属品，而是“跨语言协作层”。

核心目标：

- 客户用自己的语言说话。
- 坐席可以用自己最熟悉的语言工作。
- 原文和译文都能保留。
- 翻译结果可追溯、可审计、可关闭。
- 敏感内容不默认外发。

---

## 5.2 语言模型设计

建议至少区分 4 个语言字段：

- `customer_locale`：客户消息语言或偏好语言
- `agent_locale`：坐席工作语言
- `conversation_locale`：这条会话的主语言
- `translation_locale`：系统输出给坐席看的目标语言

同时支持：

- `timezone`
- `region`
- `translation_provider`
- `translation_mode`

### translation_mode 建议

- `off`：不翻译
- `assist`：辅助翻译，保留原文
- `auto`：自动翻译但可切回原文
- `forced`：某些队列强制翻译

默认建议是 `assist`。

---

## 5.3 翻译对象模型

建议一条消息对应一条 translation record：

- `message_id`
- `source_lang`
- `target_lang`
- `original_text`
- `translated_text`
- `provider`
- `confidence`
- `risk_level`
- `created_at`
- `created_by`
- `is_redacted`
- `review_status`

### 为什么要保留原文和译文

因为海外客服里最常见的场景不是“翻译一次就结束”，而是：

- 客户投诉后要审计原文；
- 坐席怀疑机器翻译不准；
- 主管要复盘服务过程；
- 法务要看原始措辞；
- AI 结果要在原文和译文之间对齐。

---

## 5.4 翻译展示逻辑

### 5.4.1 消息级展示

每条消息建议支持三种视图：

1. **原文**
2. **译文**
3. **原文 + 译文并列**（默认建议给主管或高级坐席）

### 5.4.2 翻译标记

译文必须带明显标识：

- `Translated by AI`
- `Source: fr-FR`
- `Confidence: High / Medium / Low`
- `May contain sensitive content`

如果是人工修订过的翻译，还应显示：

- `Reviewed`
- `Edited by agent`

### 5.4.3 原文 / 翻译文切换

坐席端顶部建议提供一个全局切换：

- `Original`
- `Translated`
- `Split view`

切换规则：
- 只影响阅读，不改变消息存储。
- 回复时永远以当前 agent_locale 编写。
- 发送前可选是否附带自动翻译预览。

---

## 5.5 发送与回复逻辑

### 5.5.1 客户消息进来时

1. 收到原文。
2. 先做语言识别。
3. 如果与坐席语言不一致：
   - 生成译文；
   - 标注语言；
   - 保留原文。
4. 如果包含敏感片段：
   - 可脱敏后再发给外部翻译；
   - 或直接走本地/私有模型。

### 5.5.2 坐席回复时

建议支持两种模式：

- **坐席直接写母语**，系统自动转成客户语言。
- **坐席查看草稿译文**后再发送。

发送前应提供：
- 原文编辑框
- 目标语言译文预览
- 敏感词提醒
- 术语修正入口

### 5.5.3 术语和品牌词

海外客服非常常见的问题是：品牌名、产品名、套餐名、法律术语被翻错。

因此建议加一个 **Translation Glossary**：
- 品牌名不翻译
- 特定术语强制翻译成指定短语
- 客户自定义术语库
- 按租户 / 业务线 / 渠道配置

---

## 5.6 敏感内容保护

这部分必须进入设计，不然海外无法上线。

### 建议策略

1. **PII 检测后再翻译**
   - 邮箱、电话、身份证件、卡号、地址等先标记。

2. **支持脱敏模式**
   - 例如：`john***@email.com`。

3. **可配置 provider**
   - 对敏感租户使用私有模型或自建服务。

4. **禁止自动外发的内容类型**
   - 法务文本
   - 支付信息
   - 健康信息
   - 内部工单备注

### UI 提示

当消息被脱敏或使用受限翻译时，应显示：
- `Sensitive content hidden`
- `Translation provider restricted`
- `Manual review required`

---

## 5.7 翻译相关 UI 设计建议

### 5.7.1 Conversation Message
每条消息下方增加三个轻量元素：

- 语言标签：`FR` / `EN` / `ES`
- 翻译状态：`Auto translated`
- 原文展开按钮：`View original`

### 5.7.2 Ticket Sidebar
在客户信息右侧增加：

- 客户主语言
- 当前会话语言
- 坐席显示语言
- 翻译模式开关
- glossary 状态

### 5.7.3 回复框
在 composer 上方加：

- `Reply in English`
- `Preview translation`
- `Glossary` 入口
- `Sensitive content warning`

---

## 5.8 翻译统计

建议统计以下指标：

- 翻译消息数
- 翻译命中率
- 人工纠错率
- 低置信度比例
- 敏感内容拦截数
- 翻译后首响时长
- 翻译后 CSAT
- 哪些语言对话最容易转人工

这会直接帮助判断：
- 哪些地区值得优先投放；
- 哪些语言需要本地坐席；
- 哪些问题适合先做 AI。

---

## 6. 两块能力如何组合成一个页面体系

建议在坐席端把这两块收进同一个“Service Quality”体系，而不是散落在多个地方。

### 页面结构建议

#### 6.1 Ticket Detail 右侧栏
分成四个卡片：
1. Customer Profile
2. SLA Status
3. Translation Settings
4. CSAT Status

#### 6.2 Conversation Timeline
每条消息显示：
- 原文 / 译文
- 语言
- 时间
- 翻译来源
- 是否触发 SLA 状态变化
- 是否触发 CSAT 条件

#### 6.3 Supervisor Dashboard
分两个 tab：
- `Service Quality`：CSAT + SLA + Queue + Agent
- `Multilingual`：语言分布 + 翻译质量 + 敏感拦截

---

## 7. 建议 API 方向

下面是给开发的契约方向，不是强制接口名。

### CSAT / SLA
- `GET /tickets/:id/sla`
- `POST /tickets/:id/sla/pause`
- `POST /tickets/:id/sla/resume`
- `POST /tickets/:id/csat/send`
- `POST /tickets/:id/csat/submit`
- `GET /analytics/service-overview`
- `GET /analytics/agents`
- `GET /analytics/queues`
- `GET /analytics/channels`

### Translation
- `POST /messages/:id/translate`
- `GET /messages/:id/translations`
- `POST /translations/glossary`
- `GET /translations/glossary`
- `PATCH /tickets/:id/translation-mode`
- `GET /analytics/translations`

### Event Export / Webhook
- `ticket.resolved`
- `ticket.reopened`
- `csat.submitted`
- `sla.breached`
- `message.translated`
- `translation.flagged_sensitive`

---

## 8. UI 设计交付给前端时的关键状态

后续做 UI 时，至少要准备这些状态：

### CSAT / SLA
- no policy
- active
- warning
- breached
- paused
- resolved before breach
- resolved after breach
- survey pending
- survey sent
- survey submitted
- survey expired

### Translation
- translation off
- translation loading
- translation ready
- translation failed
- original view
- translated view
- split view
- sensitive redacted
- provider restricted

---

## 9. 推荐的产品优先级

### 第一优先：SLA
因为它最直接影响客服运营，且是海外客户最容易识别的能力。

### 第二优先：CSAT
因为它和 SLA 一起构成“服务闭环”。

### 第三优先：消息翻译
因为它是海外多语言协作的基础，但可以先做半自动模式。

### 第四优先：报表联动
因为指标要能沉淀到 dashboard、导出和 webhook。

---

## 10. 最终建议

如果要给 UI 设计和开发排序，建议你按下面的颗粒度往下拆：

1. **Ticket Detail 页面**：SLA 卡片 + CSAT 卡片 + Translation 卡片
2. **Conversation Message 组件**：原文/译文切换 + 语言标签 + 敏感提醒
3. **Supervisor Dashboard**：CSAT / SLA / 翻译质量 / 语言分布
4. **Rule Settings 页面**：SLA policy + CSAT policy + translation glossary + sensitive content policy
5. **Event / Export 设置页**：Webhook / CSV / API / 订阅配置

这样拆完后，UI 能直接照着做，开发也能按对象模型和接口去落。
