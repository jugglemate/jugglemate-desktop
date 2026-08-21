/**
 * Runtime platform helpers.
 *
 * Translation is an Electron-only product capability. Keep this check separate
 * from the IM SDK's `client.isDesktop()`: Electron is the UI/product platform,
 * while `isDesktop()` confirms that the injected JGChatPCClient provider is
 * available for local message attributes.
 */
export function isElectron() {
  return typeof window !== 'undefined' && window.electronAPI?.isElectron === true
}

export function isWeb() {
  return !isElectron()
}

export default {
  isElectron,
  isWeb
}
