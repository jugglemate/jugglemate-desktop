import Storage from './common/storage'
import { STORAGE } from './common/enum'

// Default API base URL (used when no custom override is set)
const FALLBACK_API_BASE_URL = 'localhost:8050'
// const FALLBACK_API_BASE_URL = '47.94.96.179:8050'

// IM WebSocket server list. The JuggleIM SDK will try each entry in order
// when establishing a connection. Add more entries here for failover.
// const IM_SERVERS = ['wss://ws.snailchat.im']
const IM_SERVERS = ['wss://ws.juggleim.com']

export const CONFIG = {
  APP_KEY: 'nsw3sue72begyv7y',
  IM_SERVERS
}

/**
 * Get the current API base URL.
 * Priority: user override (localStorage) → default value.
 */
export function getApiBaseUrl() {
  const setting = Storage.get(STORAGE.SERVER_SETTING)
  if (setting?.apiBaseUrl) return setting.apiBaseUrl

  // build 时静态注入
  // eslint-disable-next-line no-undef
  const injected = typeof __VITE_API_BASE__ !== 'undefined' ? __VITE_API_BASE__ : ''
  if (injected) return injected

  return FALLBACK_API_BASE_URL
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