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
  TICKET_ASSIGN: 'jgm:ticketassign'
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
  [PLATFORM.WEB]:        { label: 'Web',      color: '#000000',     order: 1 },
  [PLATFORM.TELEGRAM]:   { label: 'Telegram', color: '#FF2442',     order: 2 },
  [PLATFORM.JUGGLECHAT]: { label: 'JuggleChat', color: '#07C160',   order: 3 }
}

// "AI 托管中" = 会话被当前 agent 接管（im.js 的 TAKEOVER_TAG_ID）。
// 直接复用 im.isInTakeoverTag(c) — 不再单独定义 enum value，沿用 takeover 这条轴。
// 历史值 'takeover' / 'pending_reply' / 'ai_takeover' 保留为 alias，向后兼容旧代码。
export const VIEW = {
  MINE: 'mine',                 // 我的（tag = my_ticket）
  UNASSIGNED: 'unassigned',     // 待分配（tag != assigned）
  AI_TAKEOVER: 'ai_takeover',   // AI 托管中 = 接管中（im.isInTakeoverTag）
  ALL: 'all'                    // 全部
}

// 视图展示元信息。label 给 UI 看，icon 是 24x24 stroke 风格 SVG path 字符串。
// 视图 4 个：我的 / 待分配 / AI 托管中 / 全部。
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
  [VIEW.AI_TAKEOVER]: {
    label: 'AI 托管中',
    order: 2,
    // 机器人头 + 身体：圆角方脸 + 眼睛 + 天线 + 底盘——明确传达"AI 在自动应答"
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path></svg>'  },
  [VIEW.ALL]: {
    label: '全部',
    order: 3,
    // 三个层叠的圆点 / 列表：左侧 3 个不同状态的小圆，右侧 2 条横线，传达"所有会话"
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6"  r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none"/><line x1="10" y1="6"  x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/></svg>'
  }
}
