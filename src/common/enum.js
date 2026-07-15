// Event Names
export const EVENT_NAME = {
  UNAUTHORIZED: 'unauthorized',
  USER_INFO_UPDATE: 'user_info_update',
  // Cross-component actions emitted via common/emitter. Names mirror the
  // original snailchat constants so the migrated code can stay 1:1.
  SEND_MESSAGE: 'on_send_message',
  ON_GROUP_MEMBER_ADDED: 'on_group_member_added',
  ON_GROUP_MEMBER_REMOVED: 'on_group_member_removed',
  ON_APP_LANGUAGE_CHANGED: 'on_app_language_changed'
}

// Storage Keys
export const STORAGE = {
  PREFIX: 'hubchat',
  USER_TOKEN: 'user_auth_token',
  USERS: 'users_auth',
  SERVER_SETTING: 'server_setting'
}

// Response Codes
export const RESPONSE = {
  SUCCESS: 0,
  UNAUTHORIZED: 401
}

// Error Codes (from server)
export const ERROR_CODE = {
  SUCCESS: 0,
  PARAM_ERROR: 17001,
  USER_EXISTED: 17008,
  USER_NOT_EXIST: 17009,
  LOGIN_ERR_PASS: 17010
}

// Custom message names registered alongside the IM SDK. Anything that isn't
// `MessageType.TEXT/IMAGE/...` falls into this bucket — group notifications,
// friend notifications, contact cards, animation stickers, replay chain, etc.
export const MSG_NAME = {
  GROUP_NTF: 'jgd:grpntf',
  FRIEND_NTF: 'jgd:friendntf',
  CONTACT_CARD: 'jgd:contactcard',
  ANIMATION_STICKER: 'snl:sticker',
  TYPING_NTF: 'snl:typing',
  REPLAY_MSG: 'snl:replay',
  TICKET_ASSIGN: 'jgm:ticketassign',
  // 工单转移广播消息名。命名沿用 TICKET_ASSIGN 的无下划线风格以保持
  // 与 jugglemate-server 现存自定义消息名规范一致（待后端最终确认）。
  // payload 见 docs/sprint-1-revised-backend.md §3.2：
  //   { ticket_id, from:{id,name}, to:{id,name}, note }
  TICKET_REASSIGN: 'jgm:ticketreassign'
}

export const TYPING_STATUS = {
  START: 1,
  END: 0
}

// Operation type used by the transfer / multi-select overlay. Transfer is
// forward-to-friend (single or merged), Remove deletes locally + on the server.
export const TRANSFER_TYPE = {
  NONE: -1,
  ONE: 1,
  MERGE: 2,
  DELETE: 3
}

// Operation type used by the message right-click menu. The right-click event
// dispatches one of these so the right component can show the right options.
export const MESSAGE_OP_TYPE = {
  TRANSLATE: 1,
  REMOVE: 2
}

// Burn-after-read durations. Kept in enum for the burner timer component (P4).
export const MESSAGE_BURN_TYPE = {
  MIN: '1m',
  HOUR: '1h',
  DAY: '1d',
  WEEK: '1w',
  OFF: 'off'
}

// 会话 tag id（业务侧定义的 IM SDK 会话分组）。
//   assigned  — 工单被认领后，对应会话打上这个 tag（全员视角）
//   my_ticket — 当前认领人额外打上这个 tag（用于"我的"过滤）
// 这些 id 是和 IM 服务端约定好的固定字符串，不要随意改。
export const CONVERSATION_TAG_ID = {
  ASSIGNED: 'assigned',
  MY_TICKET: 'my_ticket'
}

// IM 全局 tag —— 工单分配 / 平台 / 工单状态 三类会话 tag 的统一枚举。
// 这些 id 是和 IM 服务端约定好的固定字符串，不要随意改。
// 列表侧栏筛选用：视图（VIEW）/ 平台（PLATFORM）/ 工单状态（TICKET_STATUS_TAG）。
//   - 视图（mine/unassigned）走 CONVERSATION_TAG_ID.ASSIGNED + MY_TICKET，
//     通过协议层的 tag / exceptTag 字段实现（语义上不属于"全局 tag"）。
//   - 平台 / 工单状态 这两类走全局 tag，用 QryConversationsReq.tag 单值查询。
//
// 工单分配维度（保留以兼容 inbox_member 早期协议，未来会废弃）：
//   ASSIGNED / UNASSIGNED
//
// 工单状态维度（业务态 4 + 隐藏 1）：
//   STATUS_PENDING / STATUS_PROCESSING / STATUS_REOPEN：业务态，前端可见
//   STATUS_CLOSED：隐藏态，前端 enum 保留以兼容 server（server 实际不打此 tag，
//                  closed 状态仅靠 tickets.status 字段表达，列表接口层过滤）
//
// 平台维度：
//   CHANNEL_WIDGET / CHANNEL_TELEGRAM / CHANNEL_JUGGLEIM
export const TICKET_GLOBAL_TAG = {
  // 工单分配
  ASSIGNED: 'assigned',
  UNASSIGNED: 'unassigned',

  // 工单状态（4 态业务 + 1 隐藏）
  STATUS_PENDING: 'ticket_status_pending',
  STATUS_PROCESSING: 'ticket_status_processing',
  STATUS_CLOSED: 'ticket_status_closed',
  STATUS_REOPEN: 'ticket_status_reopen',

  // 平台
  CHANNEL_WIDGET: 'channel_widget',
  CHANNEL_TELEGRAM: 'channel_telegram',
  CHANNEL_JUGGLEIM: 'channel_juggleim'
}

// 工单状态筛选维度选项（用于 Conversations 侧栏"工单状态"过滤列）。
// 与 PLATFORM_META 同构：label / color / order 决定渲染，dot 用于未读徽标。
// `key=''` 代表"全部"，等价于不携带 tag 走"不过滤"路径。
// closed 不在前端 UI 出现，仅 enum 保留。
export const TICKET_STATUS_TAG = {
  ALL: '',                                       // 空 = 不传 tag
  PENDING: TICKET_GLOBAL_TAG.STATUS_PENDING,
  PROCESSING: TICKET_GLOBAL_TAG.STATUS_PROCESSING,
  REOPEN: TICKET_GLOBAL_TAG.STATUS_REOPEN
  // CLOSED 故意不暴露
}

export const TICKET_STATUS_TAG_META = {
  [TICKET_STATUS_TAG.ALL]: {
    label: '全部',
    color: '',
    order: 0,
    icon: ''
  },
  [TICKET_STATUS_TAG.PENDING]: {
    label: '待处理',
    color: '#FF8800',
    order: 1,
    // 钟表：表示「待处理 / 等待中」
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 16 14"></polyline></svg>'
  },
  [TICKET_STATUS_TAG.PROCESSING]: {
    label: '处理中',
    color: '#1E88FF',
    order: 2,
    // 回旋箭头：表示「流转中 / 进行中」
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.5-7.1"></path><polyline points="21 4 21 10 15 10"></polyline></svg>'
  },
  [TICKET_STATUS_TAG.REOPEN]: {
    label: '重新打开',
    color: '#7C4DFF',
    order: 3,
    // 反向回旋箭头：表示「回到起点 / 重新开始」
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>'
  }
}

// 工单状态数值枚举（来自 backend /jmate/customers/tickets 等接口）。
//  - 0  pending    待处理（未分配 / 待分配 — UI 文案采用「待处理」与列表筛选列保持一致）
//  - 1  processing 处理中（已分配）
//  - 2  resolved   已解决
//  - 3  reopened   重新打开
//  - 99 closed     隐藏终态，UI 不展示（保留以兼容 server 极端返回）
export const TICKET_STATUS = {
  PENDING:   0,
  PROCESSING: 1,
  RESOLVED:  2,
  REOPENED:  3,
  CLOSED:    99
}

// TICKET_STATUS 数值 → UI 元数据（label / icon / color）。
//  - icon: 16x16 stroke 风格 SVG path 字符串，电流风格与 nav-rail / 视图列同源。
//  - color: 主色（不再用作 chip 背景色 —— AgentPanel 历史工单的状态徽标用 icon + label，
//            不再依赖背景色块，遵循用户「去掉颜色用 icon」的要求）。
export const TICKET_STATUS_META = {
  [TICKET_STATUS.PENDING]: {
    label: '待处理',
    color: '#FF8800',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 16 14"></polyline></svg>'
  },
  [TICKET_STATUS.PROCESSING]: {
    label: '处理中',
    color: '#1E88FF',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.5-7.1"></path><polyline points="21 4 21 10 15 10"></polyline></svg>'
  },
  [TICKET_STATUS.RESOLVED]: {
    label: '已解决',
    color: '#07C160',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
  },
  [TICKET_STATUS.REOPENED]: {
    label: '重新打开',
    color: '#7C4DFF',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>'
  },
  [TICKET_STATUS.CLOSED]: {
    label: '已关闭',
    color: '#9CA3AF',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>'
  }
}

// 左侧会话分类。和 `filter` ref 的取值一一对应。
//   mine       — 我的（tag = my_ticket）
//   unassigned — 未分配的（tag != assigned）
//   all        — 全部（不筛 tag）
export const SESSION_FILTER = {
  MINE: 'mine',
  UNASSIGNED: 'unassigned',
  ALL: 'all'
}

// 平台 tag id（业务侧定义，对应会话对象的 platform 字段）。
// 和 `PLATFORM` 下面的 key 一一对应；选中"全部"时上层不携带 tag。
export const PLATFORM_TAG_ID = {
  WEB: 'web',
  TELEGRAM: 'telegram',
  JUGGLECHAT: 'jugglechat'
}

// 平台选项。`ALL` 排在最前，默认选中；`ALL` 不携带 tag 走"不过滤"路径。
export const PLATFORM = {
  ALL: 'all',
  WEB: 'web',
  TELEGRAM: 'telegram',
  JUGGLECHAT: 'jugglechat'
}

// 平台展示元信息（label / 圆点颜色 / 顺序）。
// 顺序决定侧栏渲染顺序，颜色给会话列表里的 plat-dot 用。
export const PLATFORM_META = {
  [PLATFORM.ALL]:        { label: '全部',     color: '',            order: 0 },
  [PLATFORM.WEB]:        { label: 'Web',      color: '#7C3AED',     order: 1 },
  [PLATFORM.TELEGRAM]:   { label: 'Telegram', color: '#FF2442',     order: 2 },
  [PLATFORM.JUGGLECHAT]: { label: 'JuggleChat', color: '#07C160',   order: 3 }
}

// 历史值 'takeover' / 'pending_reply' / 'ai_takeover' 已下线：
// 「AI 托管中」视图已移除，不再作为会话列表的过滤维度。
// 接管 tag（jm_takeover）相关的 SDK / IM 协议层逻辑保留，
// 仅 UI 不再渲染这条分类（参见 im.js TAKEOVER_TAG_ID 注释）。
export const VIEW = {
  MINE: 'mine',                 // 我的（tag = my_ticket）
  UNASSIGNED: 'unassigned',     // 待分配（tag != assigned）
  ALL: 'all'                    // 全部
}

// 视图展示元信息。label 给 UI 看，icon 是 24x24 stroke 风格 SVG path 字符串。
// 视图 3 个：我的 / 待分配 / 全部。
//
// 视觉基线：1.6 stroke-width、stroke-linecap=round、stroke-linejoin=round、currentColor
// ——和 nav-rail 里现有图标的风格保持一致。
export const VIEW_META = {
  [VIEW.MINE]: {
    label: '我的',
    order: 0,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>'  },
  [VIEW.UNASSIGNED]: {
    label: '待分配',
    order: 1,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>'  },
  [VIEW.ALL]: {
    label: '全部',
    order: 2,
    // 三个层叠的圆点 / 列表：左侧 3 个不同状态的小圆，右侧 2 条横线，传达"所有会话"
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6"  r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none"/><line x1="10" y1="6"  x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/></svg>'
  }
}
