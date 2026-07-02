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
  // TAKEOVER: 'takeover',         // alias，等价 AI_TAKEOVER
  ALL: 'all'                    // 全部
}

// 视图展示元信息。label 给 UI 看，key 跟 SESSION_FILTER / VIEW 取值对齐。
// 视图 4 个：我的 / 待分配 / AI 托管中 / 全部。
export const VIEW_META = {
  [VIEW.MINE]:        { label: '我的',       order: 0 },
  [VIEW.UNASSIGNED]:  { label: '待分配',     order: 1 },
  [VIEW.AI_TAKEOVER]: { label: 'AI 托管中',  order: 2 },
  [VIEW.ALL]:         { label: '全部',       order: 4 }
}
