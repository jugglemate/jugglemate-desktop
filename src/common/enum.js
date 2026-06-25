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
