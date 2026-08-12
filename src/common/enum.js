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
  TICKET_REASSIGN: 'jgm:ticketreassign',
  CSAT: 'jgm:csat',
  CSAT_REPLY: 'jgm:csatreply'
  // 工单转移广播 content 是 JSON 字符串（发送端 JSON.stringify 后下发，接收端
  // parseTicketAssignContent 同时兼容 string 和已解析 object 两种形态），示例：
  // {
  //   "ticket_id": "ticket_elBPmNz4QGC8MzHCBxn9hr",
  //   "from": { "id": "u_wAwQpH8Aqi2", "name": "user76476" },
  //   "to":   { "id": "u_Vnr45oakdbL", "name": "testkefu1" },
  //   "note":  "1111啊啊啊啊"
  // }
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
  CHANNEL_JUGGLEIM: 'channel_juggleim',
  CHANNEL_WATCHAPP: 'channel_watchapp'
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
    icon: '<svg t="1784174332590" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3153" width="16" height="16"><path d="M512 329.325a33.868 33.868 0 0 0-34.101 33.589v224.1c0 1.535 0.744 2.884 0.93 4.372 0.326 2.466 0.605 4.746 1.443 6.979 0.79 2 1.86 3.722 2.93 5.443 1.117 1.907 2.187 3.722 3.722 5.443 1.582 1.721 3.443 2.884 5.397 4.466 1.256 0.838 2.093 2.187 3.536 2.885l195.162 103.745a34.148 34.148 0 0 0 16.143 4.001 34.148 34.148 0 0 0 30.054-17.632 33.403 33.403 0 0 0-13.864-45.592l-177.25-94.302V362.914A33.961 33.961 0 0 0 512 329.324z m454.386 179.251a33.822 33.822 0 0 0-34.008 33.636c0 228.612-188.556 414.516-420.331 414.516-231.823 0-420.332-185.904-420.332-414.516 0-228.659 188.51-414.563 420.332-414.563a426.612 426.612 0 0 1 146.778 26.797l-44.754 11.817a33.543 33.543 0 0 0 8.792 66.062 34.38 34.38 0 0 0 8.84-1.117l109.56-28.983a56.292 56.292 0 0 0 34.66-26.146 54.897 54.897 0 0 0 5.582-42.521L752.15 25.392a33.961 33.961 0 0 0-41.731-23.82A33.59 33.59 0 0 0 686.32 42.7l14.98 55.22A497.327 497.327 0 0 0 512 60.424c-269.366 0-488.487 216.144-488.487 481.788S242.634 1024 512 1024c269.32 0 488.487-216.144 488.487-481.741 0-18.61-15.26-33.683-34.1-33.683z" p-id="3154"></path></svg>'
  },
  [TICKET_STATUS_TAG.PROCESSING]: {
    label: '处理中',
    color: '#1E88FF',
    order: 2,
    icon: '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><circle cx="512" cy="512" r="454" fill="none" stroke="currentColor" stroke-width="68"/><circle cx="338" cy="512" r="34" fill="currentColor"/><circle cx="512" cy="512" r="34" fill="currentColor"/><circle cx="686" cy="512" r="34" fill="currentColor"/></svg>'
  },
  [TICKET_STATUS_TAG.REOPEN]: {
    label: '重新打开',
    color: '#7C4DFF',
    order: 3,
    icon: '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><circle cx="512" cy="512" r="454" fill="none" stroke="currentColor" stroke-width="68"/><path d="M384 224l42 98c28-10 57-15 87-15 143 0 259 116 259 259S656 825 513 825c-113 0-210-72-245-174a34 34 0 0 1 64-22c26 75 97 128 181 128 106 0 191-85 191-191s-85-191-191-191c-20 0-40 3-59 9l34 80-232-34 128-206z" fill="currentColor"/></svg>'
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
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 16 14"></polyline></svg>'
  },
  [TICKET_STATUS.PROCESSING]: {
    label: '处理中',
    color: '#1E88FF',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.5-7.1"></path><polyline points="21 4 21 10 15 10"></polyline></svg>'
  },
  [TICKET_STATUS.RESOLVED]: {
    label: '已解决',
    color: '#07C160',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
  },
  [TICKET_STATUS.REOPENED]: {
    label: '重新打开',
    color: '#7C4DFF',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>'
  },
  [TICKET_STATUS.CLOSED]: {
    label: '已关闭',
    color: '#9CA3AF',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>'
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
  JUGGLECHAT: 'jugglechat',
  WATCHAPP: 'watchapp'
}

// 平台选项。`ALL` 排在最前，默认选中；`ALL` 不携带 tag 走"不过滤"路径。
export const PLATFORM = {
  ALL: 'all',
  WEB: 'web',
  TELEGRAM: 'telegram',
  JUGGLECHAT: 'jugglechat',
  WATCHAPP: 'watchapp'
}

// 平台展示元信息（label / 圆点颜色 / 顺序）。
// 顺序决定侧栏渲染顺序，颜色给会话列表里的 plat-dot 用。
export const PLATFORM_META = {
  [PLATFORM.ALL]:        { label: '全部',     color: '',            order: 0 },
  [PLATFORM.WEB]:        { label: 'Web', color: '#7C3AED', order: 1, icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21M12 3C9.7 5.5 8.5 8.5 8.5 12s1.2 6.5 3.5 9"/></svg>' },
  [PLATFORM.TELEGRAM]:   { label: 'Telegram', color: '#FF2442', order: 2, icon: '<svg width="16" height="16" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M834 128c-10 0-20 2-30 7-9 4-52 22-118 50L114 426s-11 4-23 12c-12 8-20 19-19 36 3 23 18 37 29 45 11 8 21 11 21 11l156 53c7 22 48 156 58 187 6 18 11 30 18 39 7 9 16 14 27 17 25 8 45-8 45-8l92-84 155 119c32 14 65 6 82-8 17-14 24-32 24-32l119-612c4-15 5-29 1-43-4-14-13-25-25-33-12-8-26-12-40-11zm-3 65c0 2 0 2-1 6L712 805c-1 1-2 3-4 5-3 2-5 3-15-1L504 664 390 768l24-153 309-288c13-12 8-14 8-14 1-15-19-5-19-5L322 550l-187-63 2-1 338-142 236-100c66-27 114-48 117-49 2-1 1-1 3-1z"/></svg>' },
  [PLATFORM.JUGGLECHAT]: { label: 'JuggleChat', color: '#07C160', order: 3, icon: '<svg t="1784176064469" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="28971" width="16" height="16"><path d="M864 64H608a32 32 0 0 0-32 32v480a64 64 0 0 1-128 0v-96a32 32 0 0 0-32-32H160a32 32 0 0 0-32 32v128a351.72 351.72 0 0 0 352 352h64a351.72 351.72 0 0 0 352-352V96a32 32 0 0 0-32-32z m-224 64h64v368a144.1 144.1 0 0 1-72.06 124.71A127.35 127.35 0 0 0 640 576zM512 704h48c114.69 0 208-93.31 208-208V128h64v384c0 141.16-114.84 256-256 256a128.17 128.17 0 0 1-116.66-75.34A127.3 127.3 0 0 0 512 704z m-320-96v-96h64v160a285.9 285.9 0 0 0 54.53 168.71C238.74 788.28 192 703.5 192 608z m352 288c-123.51 0-224-100.49-224-224V512h64v128c0 105.87 86.13 192 192 192a317.84 317.84 0 0 0 223.29-90.81C751.13 833.12 654.78 896 544 896z" fill="#0F172A" p-id="28972"></path></svg>' },
  [PLATFORM.WATCHAPP]:   { label: 'WhatsApp', color: '#0EA5E9', order: 4, icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/><circle cx="12" cy="12" r="2.5"/></svg>' }
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
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>'  },
  [VIEW.UNASSIGNED]: {
    label: '待分配',
    order: 1,
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>'  },
  [VIEW.ALL]: {
    label: '全部',
    order: 2,
    // 三个层叠的圆点 / 列表：左侧 3 个不同状态的小圆，右侧 2 条横线，传达"所有会话"
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6"  r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none"/><line x1="10" y1="6"  x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/></svg>'
  }
}
