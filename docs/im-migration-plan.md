# IM 核心功能迁移计划

> 把 `/Applications/work/snailchat-web` 中沉淀的 IM 核心能力（会话列表、会话操作、历史消息、消息操作、各类消息渲染）迁入 `jugglemate-web`。视觉与主题完全沿用 jugglemate-web 现有设计 token；不引入 snailchat 的样式系统、iconfont、i18n、IndexedDB 持久化等。

---

## 1. 目标与范围

### 1.1 必须迁移（本期）

- **会话列表**：拉取 / 排序 / 搜索 / 过滤（全部 / 未读） / 置顶 / 平台标识 / 未读红点。
- **会话操作**：置顶、免打扰、标记未读、清空消息、删除会话。
- **历史消息**：分页拉取、上拉加载、流式增量、滚动定位、时间分隔。
- **消息操作**：复制、引用回复、撤回、表情回复、删除、转发到其他会话。
- **消息类型渲染**：文本、图片、文件、视频、语音、名片、合并转发、群接龙、表情回应、撤回提示、群通知、好友通知、通话结束提示、流式文本、未知消息、时间分隔。
- **会话侧栏**（延后到第二阶段，本期**不**包含）：会话信息、群成员、文件/图片/链接聚合、消息搜索。

### 1.2 明确不迁

- 音视频通话 (JuggleCall)、表情贴纸库、@提及、翻译、阅后即焚、Markdown 富文本。
- 联系人 / 好友 / 群管理 / AI 助手 / 智能建议。
- 国际化 (i18n)。
- SQLite / IndexedDB 本地持久化；保持纯内存 + 服务端。

---

## 2. snailchat-web 关键能力盘点

| 模块 | 源文件 | 迁入方式 |
| --- | --- | --- |
| 会话列表 + 弹层 | `views/conversation/conversation-list.vue`、`conversation-body.vue`、`conversation-aside.vue`、`conversation-search-aside.vue` | 取列表 + 会话操作；侧栏延后 |
| 会话操作 handler | `views/conversation/conversation-handler.js`、`conversation-top-handler.js`、`conversation-remove-handler.js`、`conversation.js` | 重写为 `src/common/conversation-tools.js` |
| 消息主体 | `views/conversation/conversation.vue` | 拆分为 `ChatMain` + `MessageList` + `MessageSender` |
| 消息右键菜单 | `components/message-menu.vue` | 抽出 `MessageMenu.vue` |
| 消息类型组件 | `components/message-*.vue` | 进入 `components/message/` |
| 底层工具 | `common/utils.js`、`common/chat-time-utils.js`、`components/message-utils.js` | 按需取子集迁入 jugglemate |

---

## 3. jugglemate-web 现状

### 3.1 已有资产（保持不动 / 直接复用）

- `common/im.js`：已封装 `init / connect / disconnect / getCurrent`，**作为本次迁移的 IM SDK 网关**。
- `components/Conversations.vue`：已接 IM 事件、会话映射、置顶、过滤、头像配色、空态、平台点。**继续作为会话列表的内核**，本次只补 `ConversationMenu` 接入。
- `views/MainView.vue` + `components/ChatMain.vue`：三栏布局、Agent 建议、接管横幅。`ChatMain` 改造为接入消息列表 + 发送区。
- 设计 token：`assets/css/hubchat.css`（`--bg-*` / `--text-*` / `--accent` / `--border-*` / `--space-*` / `--radius-*` / `--shadow-*` / `--font-sans` / `--transition-*`）。
- 通用组件：`Avatar.vue`、`Modal.vue`、`Slideover.vue`、`Input.vue`、`Button.vue`、`Toggle.vue`。

### 3.2 需要补充

- `common/utils.js`（snailchat 子集 + 本地缺失的 `map/filter/clone`）。
- `common/chat-time-utils.js`、`common/emitter.js`（轻量 mitt 风格，约 20 行）。
- `common/im.js` 扩枚举导出 + `msgShortFormat` + `isUnreadTag` + `sendTyping`。
- `common/enum.js` 补 `MSG_NAME` / `MESSAGE_OP_TYPE` / `TRANSFER_TYPE` / `MESSAGE_BURN_TYPE`。
- `components/message-utils.js`（`isGroup` / `getGroupReadPercent` / 发送状态常量）。
- `components/message/*`（15+ 消息渲染组件）。
- `MessageMenu.vue`、`ConversationMenu.vue`。
- `MessageSender.vue`（输入区：textarea + 附件 + 发送）。

---

## 4. 抽象的组件 / 工具结构

```
src/
├── common/
│   ├── im.js                      # 扩展：枚举导出、msgShortFormat、isUnreadTag、sendTyping
│   ├── enum.js                    # 扩展：MSG_NAME / MESSAGE_OP_TYPE / TRANSFER_TYPE / MESSAGE_BURN_TYPE
│   ├── utils.js                   # 新建：extend / find / forEach / isEmpty / isEqual / isInclude / map / filter / clone / templateFormat / getUUID / formatTime / parse / stringify / noop
│   ├── chat-time-utils.js         # 新建：shouldShowTimeSeparator / getTimeSeparatorText / getConversationTime
│   ├── emitter.js                 # 新建：极简 mitt 风格事件总线，替代 snailchat emmit
│   └── storage.js                 # 保持
├── components/
│   ├── message/                   # ★ 新建目录
│   │   ├── MessageItem.vue        # 路由分发器：按 message.name 渲染对应子组件
│   │   ├── MessageAvatar.vue      # 单条消息左侧头像 + 群昵称
│   │   ├── MessageBubble.vue      # 气泡外壳：出/入站、burn 倒计时、已读、失败重发
│   │   ├── MessageContext.vue     # 单条消息容器：时间分隔 / 右键 / 选择
│   │   ├── MessageText.vue
│   │   ├── MessageImage.vue
│   │   ├── MessageFile.vue
│   │   ├── MessageVideo.vue
│   │   ├── MessageVoice.vue
│   │   ├── MessageMerge.vue       # 合并转发
│   │   ├── MessageContactCard.vue
│   │   ├── MessageReaction.vue    # 表情回复条
│   │   ├── MessageRecall.vue
│   │   ├── MessageTimeline.vue    # 时间分隔
│   │   ├── MessageGroupNotify.vue
│   │   ├── MessageFriendNotify.vue
│   │   ├── MessageCallFinished.vue
│   │   ├── MessageStreamText.vue
│   │   ├── MessageUnknown.vue
│   │   └── message-utils.js       # isGroup / getGroupReadPercent / 发送状态映射
│   ├── MessageMenu.vue            # 右键菜单（复制 / 引用 / 撤回 / 表情回复 / 转发 / 删除 / 置顶）
│   ├── ConversationMenu.vue       # 会话项右键菜单（置顶 / 免打扰 / 标记未读 / 清空 / 删除）
│   └── MessageSender.vue          # 消息输入区：textarea + 附件按钮 + 发送
└── views/
    └── MainView.vue               # 调整：把 ChatMain 拆出的会话 + 消息交给新组件
```

### 4.1 关键抽象原则

1. **`MessageItem.vue` 单一分发入口**。父组件只 `v-for` + `<MessageItem :message="m" />`，分发器按 `message.name` 选具体渲染器；新消息类型只动分发器一处。
2. **气泡与内容分离**。`MessageBubble` 处理方向 / 状态 / 重发；`MessageText/Image/...` 只负责内容渲染。
3. **右键菜单可拔插**。`MessageContext` 通过事件 `context/open`，由 `ChatMain` 统一弹 `MessageMenu`，不耦合具体业务。
4. **工具函数按需取**。`utils.js` 不全盘复制，只搬 `extend / find / forEach / isEmpty / isEqual / isInclude / templateFormat / getUUID / formatTime / parse / stringify / noop`，加 `map/filter/clone`。
5. **样式统一走 jugglemate-web token**。snailchat 大量 `oklch(...)` 颜色原值改为 token 引用（`--accent` / `--bg-surface` / `--text-secondary` 等）；iconfont 的 `wr-*` 改用简单 SVG / Unicode 字符；动画统一用 `var(--transition-*)`。
6. **事件总线本地最小化**。自建一个 `emitter.js`（mitt 风格），不引用 snailchat 的全局 `emmit`。

---

## 5. 分阶段交付

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0 基础** | `utils.js` / `chat-time-utils.js` / `emitter.js` / `message-utils.js` + `im.js` 扩展 + `enum.js` 扩展 + `MessageItem` 分发 + `MessageText / Timeline / Unknown / Recall` + 消息列表/历史拉取/上拉加载 | 选会话能看到历史文本消息，能发送，时间分隔正确，撤回 / 未识别消息正常显示 |
| **P1 富媒体** | `MessageImage / File / Video / Voice / ContactCard` + 附件发送（图片 / 文件 / 视频）+ 图片预览 | 发图、文件、视频能正常上下载；图片点击放大 |
| **P2 会话操作** | `ConversationMenu`（置顶 / 免打扰 / 标记未读 / 清空 / 删除）+ `ConversationList` 接入 + 免打扰 icon + 标记未读 badge | 列表项右键可触发 5 种操作，服务端同步生效 |
| **P3 消息操作** | `MessageMenu`（复制 / 引用 / 撤回 / 表情回复 / 删除 / 转发）+ 消息选中态 + `MessageReaction` + `MessageMerge` | 长按消息弹出菜单；表情回复能加 / 去；引用可在发送时显示回复条 |
| **P4 体验增强** | 已读回执（群阅读百分比 / 私聊已读）+ 发送状态（发送中 / 失败 / 重发）+ 流式文本 (StreamText) + 失败重发 | 群聊能看到 X 人已读；失败消息能重发；流式输出按事件追加 |
| **P5 会话侧栏（延后）** | `ConversationAside`（单聊资料 / 群资料 + 成员列表 / 群设置）+ `ConversationSearchAside`（按关键字搜历史） | 顶栏"…"打开侧栏；群能看成员；侧栏输入关键字跳到对应消息并高亮 |

每阶段结束跑 `npm run dev` 截图、build 校验，并在 MainView 验收清单。P0 / P1 优先；P2 / P3 不可拆分；P4 视时间排。**P5 留作第二阶段**，不在本期合并。

---

## 6. 文件改动清单（首版估算）

新增约 **25** 个组件 / 工具文件，修改约 **6** 个既有文件：

- **新建**：`common/utils.js`、`common/chat-time-utils.js`、`common/emitter.js`、`components/message/message-utils.js`、15 个 `components/message/*` 组件、`MessageMenu.vue`、`ConversationMenu.vue`、`MessageSender.vue`。
- **修改**：`common/im.js`（扩枚举 / 工具）、`common/enum.js`（补枚举）、`components/ChatMain.vue`（接入 MessageItem + MessageSender）、`components/Conversations.vue`（接 ConversationMenu 事件）、`views/MainView.vue`（透传会话上下文）。

---

## 7. 风险与对策

1. **snailchat 强耦合 i18n / emitter / contacts 路由**。组件迁移时剥除 i18n 字面量（直接写中文，文末可加 todo 留位）；emitter 自建一个最小事件总线，弃用 snailchat 的全局 `emmit`。
2. **样式系统差异**。snailchat 大量 `wr-*` iconfont、OKLCH 硬编码颜色，迁移时统一替换为 jugglemate-web token + 简洁 SVG / Unicode 字符；动画统一用 `var(--transition-*)`。
3. **依赖项差异**。snailchat 用 `clipboard.js` / `v-viewer` / `vue3-image-preview` / `markdown-it` / `qrcode` / `html2canvas`，jugglemate 不引入新依赖：图片预览用 `<dialog>` + 自写预览，复制走 `navigator.clipboard`。
4. **业务请求接口缺失**。`Group.get / User.getInfo / Mix.getConversationSetting` 等 snailchat 用的接口，jugglemate-web 暂未实现。本期相关调用写成"占位 + 注释"，数据返回空时不阻塞 UI（首批只读 IM SDK 返回的字段）。
5. **会话侧栏（P5）依赖服务接口**。群成员 / 资料 / 消息搜索的接口未到位前不做，避免引入半成品 UI。

---

## 8. 确认事项

执行 P0 前需要确认以下三点：

1. **范围**：第 1 节"必须迁移 / 明确不迁"是否符合预期？特别是音视频通话 / 表情贴纸 / 翻译 / 阅后即焚 / 会话侧栏**本期不做**、延后到第二阶段。
2. **样式替换策略**：snailchat 的 iconfont（`wr-*` 几百个图标）+ OKLCH 硬编码颜色，直接改为 jugglemate-web token + 简单 SVG / Unicode 字符，是否接受？
3. **依赖**：不引入新 npm 包（图片预览用原生 `<dialog>`，复制用 `navigator.clipboard`），可以吗？还是希望直接装 `v-viewer` 等？

确认后按 P0 → P4 推进；P5（会话侧栏）作为独立里程碑在第二阶段启动。每完成一个阶段停下来汇报进度。
