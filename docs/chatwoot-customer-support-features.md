# Chatwoot 客服功能与流程梳理

> 基于 `/Users/helena/Work/code/ai/chatwoot` 源码梳理，覆盖 Agent（客服）日常使用的功能、对应流程，以及后台支撑能力。所有路径均为仓库内相对路径，便于定位实现。

## 项目定位

Chatwoot 是开源客服平台（README 自述：开源替代 Intercom/Zendesk），客服 Agent 的核心入口在 `app/javascript/dashboard/routes/dashboard/...`，路由聚合文件 `app/javascript/dashboard/routes/dashboard/dashboard.routes.js:1`。Ruby 端 `app/controllers/api/v1/accounts/...` 提供 API；`app/models/conversation.rb`、`app/services/...` 是业务核心。

## 一、Agent 在 Dashboard 端可见的功能

### 1. 收件箱 / 工单面板（核心入口）

- 路径：`accounts/:accountId/dashboard`、`/inbox`、`/inbox-view`、`/label/:label`、`/team/:teamId`、`/custom_view/:id`、`/mentions/conversations`、`/unattended/conversations`、`/participating/conversations`，见 `app/javascript/dashboard/routes/dashboard/conversation/conversation.routes.js:1`
- 会话列表 / 卡片：`components/widgets/conversation/ConversationCard.vue:1`
- Inbox V4 卡片：`components-next/Inbox/InboxCard.vue:1`，列表 `routes/dashboard/inbox/InboxList.vue:1`
- 单条工单右键菜单（改状态 / 优先级、分配 Agent/团队、加减标签、删除、复制链接、新窗口打开）：`components/widgets/conversation/contextMenu/Index.vue:1`

### 2. 单会话处理（详情三栏）

- 头部与操作：`components/widgets/conversation/ConversationHeader.vue:1`、`ConversationAction.vue`、`MoreActions.vue:1`（解决、重新打开、静音、发送会话邮件转录）
- 消息流统一渲染：`components-next/message/Message.vue:1`，按类型分发到 `components-next/message/bubbles/` 下的子组件（Text / Image / Audio / Video / File / Email / VoiceCall / InstagramStory / Location / Contact / Embed / Form / CSAT / Activity / Fallback / Unsupported / Dyte 等）
- 回复框 + 草稿：`components/widgets/conversation/ReplyBox.vue:1`，回复模式 `REPLY_EDITOR_MODES = { REPLY, NOTE }`（`components/widgets/WootWriter/constants.js:1`）
  - 多渠道适配：邮箱（CC / BCC / 标题 / 引用回复 / 签名）、WhatsApp 模板（`WhatsappTemplates/`）、Twilio WhatsApp（`ContentTemplates/`）、Web Widget、API Inbox、Telegram、Facebook、Instagram、TikTok、SMS、Line
  - 粘贴上传、拖拽、音频录制、表情、@ 提及用户、变量 `{{contact.name}}`、插入 Help Center 文章（`connectedPortalSlug`）、引用回复、签名自动追加（`sendWithSignature`）
  - 草稿持久化：`store/modules/draftMessages.js:1`，按 `draft-{convId}-{REPLY|NOTE}` 存 LocalStorage
- 实时输入状态：`store/modules/conversationTypingStatus.js:1` ↔ `services/conversations/typing_status_manager.rb:1`（通过 ActionCable 广播）

### 3. 分配与协作

- 单会话分配（Agent / 团队 / 优先级 / 状态 / 静音）：`store/modules/conversations/actions.js:1` 中 `assignAgent`、`assignTeam`、`assignPriority`、`toggleStatus`、`muteConversation`、`unmuteConversation`
- 围观者 / 抄送：`store/modules/conversationWatchers.js`、`ConversationParticipant.vue:1`
- 提及：回复里 `@agent`，对应 `mentions/conversations` 视图
- 自动分配（后台）：`services/auto_assignment/inbox_round_robin_service.rb:1`、`agent_assignment_service.rb:1`、`rate_limiter.rb:1`、`assignment_service.rb:1`，策略配置 UI 在 `routes/dashboard/settings/assignmentPolicy/`
- 容量管理（Enterprise）：`store/modules/agentCapacityPolicies.js:1`、`components-next/AssignmentPolicy/AgentCapacityPolicyCard`

### 4. 标签、视图、过滤器

- 会话标签：`store/modules/conversationLabels.js:1`、`labels.js`；侧栏 `components/widgets/conversation/conversation/LabelSuggestion.vue:1` 提供 AI 标签建议（Captain）
- 自定义视图（文件夹）：`store/modules/customViews.js:1`，路由 `custom_view/:id`
- 高级筛选：`services/conversations/filter_service.rb:1` + `permission_filter_service.rb:1`；前端 `components/widgets/conversation/advancedFilterItems/`、`ConversationBasicFilter.vue`、`FilterItem.vue`

### 5. 模板与宏（提效）

- 预设回复（Canned Response）：`store/modules/cannedResponse.js:1`、`components/widgets/conversation/CannedResponse.vue:1`（`/` 触发插入）
- 宏（Macro）：`store/modules/macros.js:1`，执行后端 `services/macros/execution_service.rb:1`；侧栏 `routes/dashboard/conversation/Macros/List.vue:1`、`MacroItem.vue:1`、`MacroPreview.vue:1`
  - 可执行动作见 `models/macro.rb:1` 的 `ACTIONS_ATTRS`：发消息、加 / 减标签、分配 Agent / 团队、静音、改状态、解决、暂停、改优先级、发邮件转录、附件、Webhook、加私密备注
- WhatsApp 模板消息：`components/widgets/conversation/WhatsappTemplates/`
- 内容模板（Twilio）：`components/widgets/conversation/ContentTemplates/`

### 6. Captain / AI Copilot（对话内 AI 助手）

- 触发按钮 `components-next/copilot/CopilotLauncher.vue:1`，侧栏 `components-next/copilot/Copilot.vue:1`，编辑器段落 `components/widgets/conversation/CopilotEditorSection.vue:1`
- 能力（`composables/useCopilotReply.js:1`）：重写（improve / professional / friendly / shorten / expand / rephrase / fix grammar…）、摘要、回复建议、追问
- 发送带 `CAPTAIN_EVENTS.AI_ASSISTED_MESSAGE_SENT` 埋点

### 7. 通知中心

- 路由 `routes/dashboard/notifications/`，store `store/modules/notifications/actions.js:1`：拉取、未读 / 已读、全部已读、删除、单条删除、snooze 通知
- `InboxCard.vue` 右键菜单可"标记已读 / 未读 / 删除"

### 8. 联系人管理

- 路由 `routes/dashboard/contacts/routes.js:1`：`/contacts`、`/segments/:id`、`/labels/:label`、`/active`、`/contacts/:id`
- `store/modules/contacts/actions.js:1`：搜索、列表、详情、创建、更新、删除、合并（merge）、导入 / 导出、批量删除、自定义属性筛选
- 详情 `components-next/Contacts/Pages/ContactDetails.vue:1`、`ContactsForm/ContactsForm.vue:1`；合并 `ContactMergeForm.vue`；导入 / 导出 `ContactImportDialog.vue` / `ContactExportDialog.vue`；分段 `CreateSegmentDialog.vue`
- 公司维度（企业版）：`components-next/Companies/`
- 联系人备注（会话内 ContactPanel）：`components/widgets/contact/ContactNotes.vue`
- ContactPanel 拖拽分组：`routes/dashboard/conversation/ContactPanel.vue:1`（会话操作、参与者、会话信息、联系人属性、过往会话、宏、Linear 问题、自定义属性、Shopify 订单）

### 9. 主动触达（Campaigns）

- 路由 `routes/dashboard/campaigns/campaigns.routes.js:1`
- 三类活动 `components-next/Campaigns/Pages/CampaignPage/`：
  - `LiveChatCampaign/`：网站主动邀请（URL Pattern + 停留时长）
  - `SMSCampaign/`：SMS 群发（按标签选受众、定时）
  - `WhatsAppCampaign/`：WhatsApp 模板消息（按标签选受众、定时）
- 列表 `CampaignList.vue:1`、`CampaignCard/CampaignCard.vue:1`

### 10. 报表

- 路由 `routes/dashboard/settings/reports/reports.routes.js:1`
- 实时概览 `LiveReports.vue:1`（对话 / 解决热力图、Agent / Team 实时数据）
- 对话报表 `Index.vue:1`，旧版 Agent / Inbox / Team / Label，新版 `*Index / *Show`（含导出 CSV）
- SLA 报表 `SLAReports.vue:1`
- CSAT 报表 `CsatResponses.vue:1`
- Bot 报表 `BotReports.vue:1`
- 数据由 `store/modules/reports.js:1` 拉取，`api/liveReports.js` 提供实时聚合

### 11. 知识库（Help Center）

- 路由 `routes/dashboard/helpcenter/`：`PortalsIndexPage`、`PortalsArticlesIndexPage / New / Edit`、`PortalsCategoriesIndexPage`、`PortalsLocalesIndexPage`、`PortalsSettingsIndexPage`、`PortalsNewPage`
- 客服在回复时可点 Help Center 按钮把文章作为回复插入（`ReplyBox.vue:1` 中 `connectedPortalSlug`、`showArticleSearchPopover`）

### 12. 通话（语音 / WhatsApp）

- 头部按钮 `components/widgets/conversation/ConversationCallButton.vue:1`
- Twilio 渠道走 `contacts/initiateCall`，WhatsApp 走 `composables/useWhatsappCallSession.js`
- 状态由 `stores/calls.js` + `components-next/call/CallCard.vue:1`、`FloatingCallWidget.vue:1` 维护；消息流气泡 `components-next/message/bubbles/VoiceCall.vue:1`

### 13. 解决时强制的"必填属性"

- `components-next/ConversationWorkflow/ConversationRequiredAttributes.vue:1`、`useConversationRequiredAttributes.js`
- 管理员开启"解决前必填某些自定义属性"才会强制弹窗，影响 `useBulkActions.js` 的批量 resolve 流程

## 二、后台 / 设置侧（管理员为客服配置的能力）

- 通用设置 `routes/dashboard/settings/account/`
- Agent & 团队：`agents/`、`teams/`（`teams.routes.js`、`teams/Create/Edit/FinishSetup`）
- Inbox 与渠道：`inbox/`、`channels/`（web widget / email / IMAP / WhatsApp / Facebook / Instagram / Twilio SMS / Telegram / Line / API 等，对应 `app/builders/messages/*`）
- 标签 `labels/`、宏 `macros/`、预设回复 `canned/`、自动化 `automation/`（事件 → 条件 → 动作，模型 `models/automation_rule.rb:1`）
- 自动化执行 `services/automation_rules/action_service.rb:1`，复用 `ActionService`（`services/action_service.rb:1`）
- SLA 策略 `routes/dashboard/settings/sla/`、`SlaForm.vue`；事件 `SLAEventItem.vue`；卡片 `SLACardLabel.vue`、`SLAPopoverCard.vue`
- 自动化轮询作业：`app/jobs/auto_assignment/assignment_job.rb`、`periodic_assignment_job.rb`
- 业务时间 / 自动应答：模型 `working_hour.rb`，`automation_rule` 事件订阅
- 集成：`integrations/`（Slack / Shopify / Linear / Captain / WhatsApp / Email）
- Captain：`routes/dashboard/captain/captain.routes.js:1` — Assistants、Documents（知识库）、Responses（FAQ）、Tools、Scenarios、Playground、Guardrails / Guidelines
- 计费、安全、日志：`billing/`、`security/`、`auditlogs/`
- 自定义角色 `customRoles/`：客服的可见菜单由 `custom_role` 权限位控制（如 `conversation_manage`、`conversation_participating_manage`）

## 三、主要 API（Ruby 后端对应）

`app/controllers/api/v1/accounts/`：

- `conversations/`：`conversations_controller`、`assignments`、`labels`、`messages`、`participants`、`draft_messages`、`unread_counts`
- 顶层：`agents`、`teams`、`labels`、`macros`、`canned_responses`、`automation_rules`、`assignment_policies`、`custom_filters`、`contacts`、`companies`、`campaigns`、`inboxes`、`inbox_members`、`agent_bots`、`dashboard_apps`、`webhooks`、`reports`、`csat_survey_responses`、`notifications`、`notification_settings`
- `app/controllers/api/v2/accounts/`：`accounts_controller`（SDK 端点）

## 四、典型一天的工作流串联

1. **接单**：登录 Dashboard，按"未分配 / 提及我 / 团队 / 标签 / 文件夹"过滤，InboxList + InboxCard 列出待办，铃铛处理 Notifications。
2. **打开会话**：进入 ConversationView → 顶栏看优先级、分配人、SLA 状态，`MoreActions` 解决 / 重新打开 / 静音 / 发邮件记录。
3. **理解上下文**：消息流看历史（邮件头 / 语音通话 / 表单 / CSAT 等气泡），右侧 ContactPanel 拉取客户属性、过往会话、备注、公司、Shopify 订单。
4. **回复客户**：选 REPLY 模式；`/` 触发 Canned Response，`@` 提及同事，`{}` 插入变量，可引用上一封邮件、可录制语音、可发附件，可让 Copilot 一键改写 / 总结 / 建议；WhatsApp / Twilio 走模板。
5. **组织会话**：顶栏切标签、改优先级、分配给自己或团队、加 participant 围观、加入文件夹视图；批量操作在 inbox 列表多选时弹出 `conversationBulkActions/`。
6. **解决**：点 Resolve（受必填自定义属性约束）；触发 `CsatSurveyService`（`services/csat_survey_service.rb:1`）发满意度问卷，结果进 `csat_reports`。
7. **主动跟进**：通过 Campaigns 给特定标签客户发 SMS / WhatsApp 模板；查阅 Reports 中的 Live / Conversation / Agent / SLA / CSAT / Bot 数据。
8. **AI 协作**：Captain Copilot 在侧栏帮忙总结对话、生成回复；LabelSuggestion 自动建议标签。

## 五、深入探索建议方向

- 宏设计（`models/macro.rb` + `services/macros/execution_service.rb`）
- 自动化规则引擎（`automation_rule.rb` + `automation_rules/action_service.rb` + `ConditionsFilterService`）
- Copilot 接入与提示词流（`composables/useCopilotReply.js` + Captain Assistant 后端）
- SLA 数据流（`events.types` → `reporting_event` → `reporting_events_rollup` → `SLAReports`）
- Captain Assistants（`routes/dashboard/captain/captain.routes.js:1` 及后端 `lib/captain`）
