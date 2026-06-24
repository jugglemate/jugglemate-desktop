import Storage from './common/storage'
import { STORAGE } from './common/enum'

// Default API base URL (used when no custom override is set)
const DEFAULT_API_BASE_URL = 'localhost:8050'

// IM WebSocket server list. The JuggleIM SDK will try each entry in order
// when establishing a connection. Add more entries here for failover.
const IM_SERVERS = ['wss://ws.snailchat.im']

export const CONFIG = {
  APP_KEY: 'nwm6fxqt2aeebhb7',
  IM_SERVERS
}

/**
 * Get the current API base URL.
 * Priority: user override (localStorage) → default value.
 */
export function getApiBaseUrl() {
  const setting = Storage.get(STORAGE.SERVER_SETTING)
  return setting?.apiBaseUrl || DEFAULT_API_BASE_URL
}

/**
 * Persist a new API base URL to localStorage.
 */
export function setApiBaseUrl(url) {
  if (!url || !url.trim()) {
    Storage.remove(STORAGE.SERVER_SETTING)
    return
  }
  Storage.set(STORAGE.SERVER_SETTING, { apiBaseUrl: url.trim() })
}