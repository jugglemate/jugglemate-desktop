# JuggleMate 产品文档

> 一份面向产品/业务同学的产品视角说明，描述当前代码里 **已经在做什么**、**做到哪一步**、**还有什么没做**。所有内容都基于 `src/` 下的实际实现，不做预期描述。

---

## 1. 产品一句话

**JuggleMate 是一个面向客服/运营的"多平台私信 + 多 AI Agent 协作"工作台**：把抖音、小红书、Telegram 等渠道的私信收进同一个收件箱，每个会话旁边有 AI Agent 给出的回复建议和接管能力，复杂任务还能拉一组 Agent 进"群组"协同。

副标题（Login 页直接写在 UI 里）：

> 一个窗口，管理所有平台的对话；一个面板，调度所有 AI 助手

---

## 2. 目标用户

| 角色 | 场景 | 关键诉求 |
| --- | --- | --- |
| 品牌客服 | 抖音/小红书私信回复 | 快速看到所有平台消息；少打字；统一话术 |
| 商务 BD | 合作洽谈对话 | 切换话术风格；保留可复用回复 |
| 跨境运营 | 英文/海外客户 | 一键切换英文 Agent；时区不卡 |
| 营销负责人 | 多 Agent 出营销方案 | 让多个 Agent 在同一群里协作 |

---

## 3. 信息架构

```
/login                 登录
/register              注册
/                      主工作台 (MainView)
  ├─ TitleBar          顶部栏（品牌 / 布局切换 / 退出）
  ├─ ConversationList  左栏：会话列表 + Agent 群组
  ├─ ChatMain          中栏：当前会话 + 消息流 + 建议 + 输入
  └─ AgentPanel        右栏（三栏布局时）：Agent 列表 + 接管
```

- 三栏 ↔ 双栏（专注）切换在 `TitleBar`，专注模式自动隐藏 Agent 面板。
- 当前选中态在 URL 之外，全部存在 `MainView` 的 ref 里（冷启动不恢复）。

---

## 4. 页面与功能清单

### 4.1 登录 / 注册（`LoginView` / `RegisterView`）

- 表单：账号（6–20 位字母数字）、密码（≥6 位）。
- 登录成功 → 写 token → 触发 `im.connect` → 跳 `/`。
- 注册成功 → 账号加入"已使用列表"缓存 → 1.5s 后跳登录（不自动登录）。
- 错误码映射：账号不存在 / 密码错 / 账号已存在 / 参数错。
- 视觉：左侧品牌区 + 右侧表单；亮色 token。

### 4.2 主工作台

#### 4.2.1 会话列表（`ConversationList`）

- **筛选**：全部 / 未读 / 接管中。
- **置顶条**：当 IM 返回 `isTop` 的会话时，在主列表上方出现头像条。
- **条目展示**：头像（按用户名 hash 着色 / 平台标）+ 会话名 + 最后一条预览 + 时间（HH:mm / 周X / M-D）+ 未读红点（`99+` 截断 / 免打扰变点）。
- **状态**：本地临时数据（empty 占位）+ IM 实时数据。IM 未连接时显示本地占位。
- **搜索框**：UI 占位（仅样式，不接后端）。
- **右键菜单**（`ConversationMenu`）：标记未读、删除会话。其它项（置顶、免打扰、清空消息）在 UI 中已留位，本期未接。
- **事件订阅**：`STATE_CHANGED / CONVERSATION_CHANGED / CONVERSATION_ADDED / CONVERSATION_REMOVED / MESSAGE_RECEIVED / CONVERSATION_TOP`。
- **typing 状态**：收到 `snl:typing` 消息时显示"对方正在输入"（5s 自动消失）。

#### 4.2.2 聊天主区（`ChatMain`）

- 头部：头像 + 会话名 + 平台标签（抖音 🎵 / 小红书 📕 / Telegram ✈️）+ 在线状态。
- 接管横幅：单聊模式下"接管/收回"切换；接管中顶部出现脉动 banner。
- 消息流：
  - 拉取历史（`getMessages`），上滑加载更多，保留视觉位置。
  - 时间分隔条自动插入（`chat-time-utils` 判定间隔）。
  - 发送/接收均按 `sentTime` 升序渲染。
- 消息操作：复制、引用、表情回应、撤回、删除、转发（合并转发到其它会话）。
- 消息类型分发（`MessageItem`）：text / image / file / video / voice / contact card / merge / reaction / recall / timeline / unknown。
- 附件发送：图片/视频/文件带进度条与本地预览；上传失败时给可读错误（识别 `1302 UPLOAD_PLUGIN_ERROR`）。
- "Agent 回复建议"：会话模式下，从所有 Agent 候选中取前 3 条扁平展示，点击直接填入输入框。
- 键盘快捷键：Ctrl+1 / Ctrl+2 / Ctrl+3 对应第 1/2/3 张建议卡。
- 输入区（`MessageSender`）：附件按钮 + textarea + 发送按钮；Enter 发送 / Shift+Enter 换行；上传后自动 focus。
- 引用 banner（`ReplyQuote`）：显示被引用消息的简短预览，可取消。
- 图片预览（`ImagePreviewer`）：全屏灯箱。
- 表情选择器（`EmojiPicker`）：从消息右键菜单触发，乐观更新 + 失败回滚。
- 转发对话框（`TransferDialog`）：选择目标会话，发送一条 merge-forward。
- typing 上报：单聊（非群）才发；3s 节流；输入框 blur 主动发 END。

#### 4.2.3 Agent 面板（`AgentPanel`）

- Agent 列表：emoji 头像 + 名称 + 角色 + 每 Agent 3 条建议。
- 点击建议：抛 `useSuggestion` 事件 → MainView → 写入输入框（已迁移到 ChatMain 本地写入）。
- 底部按钮：创建 Agent、接管/收回。
- 收起/展开：双栏模式下自动收起。

#### 4.2.4 创建 Agent（`AgentCreateSlideover`）

侧滑表单，字段：
- 名称、角色描述
- 回复风格（亲切活泼 / 专业正式 / 简洁直接 / 自定义 Prompt）
- 知识库（拖拽上传区，仅 UI）
- 适用平台（多选：抖音 / 小红书 / Telegram）
- 接管权限（Toggle）
- 温度参数（0–1 slider）
- 最大回复长度（数字）

提交后追加到 `agents` reactive 列表；首屏 emoji 按列表长度取模分配。**本期不会同步到后端**。

#### 4.2.5 Agent 群组（`MainView` 内嵌）

- 群组列表渲染在 `ConversationList` 底部"Agent 群组"分组里。
- 群组内是多 Agent 协作的"聊天室"视图，渲染 `messages` 数组：用户消息 + 多个 Agent 依次回复。
- **当前为本地 demo 数据**（营销策划组、技术方案评审组），不接 IM。

---

## 5. 核心交互流

### 5.1 登录 → 看到首屏

1. 用户提交登录 → HTTP 登录拿 `im_token` → 写 `hubchat_user_auth_token`。
2. `userService.login` 同步触发 `im.connect`（带 `success / error` 回调）。
3. 跳转到 `/`（`MainView`）。
4. `main.js` 在冷启动时也会检查 token → 重连 IM。
5. `ConversationList` 监听 `STATE_CHANGED` → 连接成功后 `getConversations` 拉一次。
6. 用户点会话 → `MainView.handleConvoSelect` → `ChatMain` 收到 prop 变化 → 拉历史 → 滚到底。

### 5.2 收到新消息

1. IM 推 `MESSAGE_RECEIVED`。
2. `ConversationList.onMessageReceived` 更新该条目的 preview / time / unread。
3. `ChatMain.onMessageReceived` 如果是当前会话 → 追加到 `imMessages` 末尾 + 滚到底。
4. 如果是 `snl:typing` 类型的 status 消息，单独走 typing 提示逻辑。
5. 当前选中会话的未读立刻清零；其它会话未读 +1（已开免打扰的不加）。

### 5.3 发送一条文本

1. `MessageSender` Enter → `onSend` → `ChatMain.sendText`。
2. 乐观插入 `SENDING` 态消息，scroll to bottom。
3. 调 `juggle.sendMessage` → onbefore 写入 sentTime；成功后改 `SUCCESS`。
4. 失败：标 `FAILED`，hover 出现重发按钮。
5. 引用过的消息会把 `referMsg` 一并发出去；`ReplyQuote` banner 自动清掉。

### 5.4 接管会话

- 顶部"接管"按钮：单聊模式独有，群组模式不显示。
- 接管中：顶部出现脉动 banner，所有"Agent 回复建议"会变灰（条件 `!isTakeover`，建议只在非接管时显示）。
- 收回后恢复建议展示；接管语义仅前端，未与服务端建立协同通道。

### 5.5 使用 Agent 建议

- `ChatMain.handleSuggestionClick(suggestion)`：直接写 `composerText` + 清掉 `replyTo` + nextTick focus + 仍 emit `useSuggestion` 给父级。
- 父级 `MainView.handleUseSuggestion` 留作未来钩子（当前 no-op），保持事件契约。

---

## 6. 数据 / 协议

### 6.1 后端地址与 AppKey

- API 基址：`http(s)://localhost:8050/jmate/...`（见 `src/config.js`，**当前为硬编码**，未走环境变量）。
- IM WebSocket：`wss://ws.snailchat.im`（支持多个 serverList）。
- AppKey：`nwm6fxqt2aeebhb7`（硬编码）。

### 6.2 HTTP API

| 路径 | 方法 | 用途 | 错误码 |
| --- | --- | --- | --- |
| `/jmate/user/register` | POST | 注册；返回 `user_id / im_token / nick_name / avatar / authorization` | 17001 / 17008 / 17009 / 17010 |
| `/jmate/user/login` | POST | 登录；返回同上 | 17001 / 17009 / 17010 |

`request.js` 公共头部：`AppKey`、`Authorization`（从 localStorage 取）、`Content-Type: application/json`；遇 401 自动清 token 跳登录。

### 6.3 IM SDK

- 库：`src/libs/juggleim-es-1.9.13.js`，本地打包。
- 网关：`src/common/im.js`，封装 `init / connect / disconnect / getCurrent / isConnected / sendTyping / msgShortFormat` 并 re-export 全部 SDK 枚举。
- 自定义消息类型（已注册）：
  - `jgd:grpntf`（群通知）
  - `jgd:friendntf`（好友通知）
  - `jgd:contactcard`（名片）
  - `snl:sticker`（动画表情）
  - `snl:typing`（typing 状态，非存储）
  - `snl:replay`（群接龙）
- IM 事件已订阅：`STATE_CHANGED / CONVERSATION_CHANGED / CONVERSATION_ADDED / CONVERSATION_REMOVED / MESSAGE_RECEIVED / MESSAGE_RECALLED / MESSAGE_UPDATED / MESSAGE_READ / MESSAGE_REACTION_CHANGED / MESSAGE_REMOVED / CONVERSATION_TOP`。

### 6.4 本地存储（localStorage，前缀 `hubchat_`）

| Key | 用途 |
| --- | --- |
| `hubchat_user_auth_token` | 当前登录用户（id / token / authorization / name / portrait） |
| `hubchat_users_auth` | 账号列表缓存（用于未来"切换账号"UI） |
| `hubchat_server_setting` | 预留（未使用） |

**不**使用 IndexedDB / SQLite，所有会话与消息在内存里。

---

## 7. Agent 体系

> 这一块是产品差异化的核心，但**本期实现是纯前端 demo**，没有 Agent 推理服务。

| 维度 | 当前实现 | 备注 |
| --- | --- | --- |
| Agent 定义 | 内存对象：`{ id, name, role, emoji, suggestions[] }` | 最多 demo 3 个 + 动态追加 |
| 建议来源 | 写死文本 + 创建 Agent 时给 3 条占位 | 不调任何模型 |
| 平台 | 仅做 UI 标识（douyin/xhs/tg） | 不影响行为 |
| 风格 | select 字段 | 不影响行为 |
| 温度 / 长度 | 表单字段 | 不影响行为 |
| 接管 | 仅 UI 横幅 | 不触发自动回复 |
| 群组协作 | demo 消息数组 | 不接 IM |

**已规划未实现**：把 Agent 配置写进后端、给 LLM 走 stream、把接管转成"Agent 接管时静默发 typing + stream text"。

---

## 8. 设计系统

- CSS 入口：`main.js` 依次引入 `hubchat.css`（设计 token 基底）→ `hubchat-custom.css`（具体组件样式）→ `login.css`（登录页）。
- Token（节选自 `hubchat.css`）：
  - 颜色：`--bg-root / --bg-surface / --bg-elevated / --bg-hover`、`--text-primary / secondary / tertiary`、`--accent / --accent-dim`、`--border-subtle`
  - 形状：`--radius-md`、`--shadow-md`
  - 字体：`--font-sans`
  - 动效：`--transition-fast`
- 复用组件：`Avatar`、`Button`、`Input`、`Modal`、`Slideover`、`Toggle`、`Toast`、`EmojiPicker`。
- 命名风格：`tyn-` 前缀是历史样式名，新代码使用 `jm-` 前缀（如 `.jm-sender`、`.jm-messages`、`.jm-msg`、`jm-reply-quote`），不要混用前缀。

---

## 9. 已实现 vs 计划中 vs 不做

### 9.1 已实现 ✅

- 登录 / 注册 / 退出，token 持久化与自动重连
- 会话列表：拉取、置顶条、筛选、未读、免打扰、typing 提示、右键标记未读/删除
- 消息流：历史分页、乐观发送、状态机、撤回、表情回应、删除、转发（合并）、引用、复制、图片灯箱
- 消息类型：text / image / file / video / voice / contact card / merge / reaction / recall / timeline / unknown
- 附件上传：图片 / 视频 / 文件，带进度与失败提示
- Agent 建议：列表、点击填入、Ctrl+1/2/3 快捷键
- 三栏 / 双栏布局切换、接管横幅、Agent 面板折叠
- 创建 Agent 表单（前端）
- Agent 群组视图（demo 数据）
- 通用：Toast、Modal、Slideover、Avatar

### 9.2 计划中（P2 / P3）

- 会话侧栏（信息 / 群成员 / 媒体 / 链接 / 搜索）
- 消息搜索
- 群管理（成员增减、群设置）
- @提及 / 翻译
- 流式文本消息（`MessageType.STREAM_TEXT` 已识别，渲染器暂复用 `MessageText`）
- 会话列表的"置顶 / 免打扰 / 清空消息"操作（菜单入口已留位）

### 9.3 明确不做（当前阶段）

- 音视频通话（JuggleCall）
- 表情贴纸库
- 阅后即焚
- i18n / 多语言
- 离线持久化（IndexedDB / SQLite）
- 把 `localhost:8050` 改成可配置
- Agent 真正接 LLM

---

## 10. 已知限制

- **API 地址硬编码**：换环境必须改 `src/config.js`。
- **冷启动不恢复上次会话**：刷新后会回到空状态。
- **会话搜索框**只有样式，搜不出东西。
- **附件上传依赖后端存储插件**：未配置时会得到特定 1302 错误，已做可读化处理。
- **Agent 体系完全 demo 化**：所有"AI"行为都是预设字符串。
- **群组视图不走 IM**：纯前端数据。

---

## 11. 术语

| 术语 | 解释 |
| --- | --- |
| JuggleMate | 本项目品牌名（与 snailchat 同源） |
| JuggleIM | 使用的 IM SDK（`juggleim-es-1.9.13`） |
| 接管 (Takeover) | 单聊模式下由人工接管，关闭 Agent 自动回复；当前为 UI 状态，不联动后端 |
| Agent | 一个具有名称 / 角色 / 候选回复的虚拟客服；本期是数据对象 |
| Agent 群组 | 多 Agent 在一个 room 内协作的视图（demo） |
| Suggestion | Agent 给出的回复建议；点击会写入输入框 |
| referMsg | 引用消息；发送文本消息时可携带 |
| Merge / 合并转发 | 把若干消息打成一条转发（当前实现：单条 → 目标会话 1 条 merge） |
| 平台 | 数据来源渠道标识：抖音 douyin / 小红书 xhs / Telegram tg |
| STORAGE.* | localStorage 的 key 列表（带 `hubchat_` 前缀） |
| MSG_NAME.* | 自定义消息类型名（`jgd:*` / `snl:*`） |
| TYPING_STATUS | typing 消息内容 type 字段：1=START / 0=END |

---

## 12. 代码地图（按角色）

| 角色 | 文件 |
| --- | --- |
| 入口 | `index.html`、`src/main.js`、`src/App.vue`、`src/router/index.js` |
| 登录 / 注册 | `src/views/LoginView.vue`、`src/views/RegisterView.vue` |
| 主视图 | `src/views/MainView.vue` |
| 会话列表 | `src/components/ConversationList.vue`、`ConversationMenu.vue` |
| 聊天主区 | `src/components/ChatMain.vue`、`MessageSender.vue`、`ReplyQuote.vue`、`ImagePreviewer.vue`、`MessageMenu.vue`、`EmojiPicker.vue`、`TransferDialog.vue` |
| 消息渲染 | `src/components/message/*` |
| Agent | `src/components/AgentPanel.vue`、`AgentCreateSlideover.vue` |
| 通用 | `src/components/Avatar.vue`、`Modal.vue`、`Slideover.vue`、`Input.vue`、`Button.vue`、`Toggle.vue`、`Toast.vue` |
| 顶层 | `src/components/TitleBar.vue` |
| 业务服务 | `src/services/api.js`、`src/services/user.js` |
| IM 封装 | `src/common/im.js`、`src/libs/juggleim-es-1.9.13.js` |
| 通用能力 | `src/common/request.js`、`src/common/storage.js`、`src/common/toast.js`、`src/common/emitter.js`、`src/common/enum.js`、`src/common/utils.js`、`src/common/chat-time-utils.js` |
| 配置 | `src/config.js` |
| 样式 | `src/assets/css/hubchat.css`、`hubchat-custom.css`、`login.css` |
| 文档 / 计划 | `docs/PRODUCT.md`（本文）、`docs/im-migration-plan.md`、`docs/design/*` |
