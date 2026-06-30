import { request } from '../common/request'
import SERVER_PATH from './api'
import Storage from '../common/storage'
import im from '../common/im'
import { STORAGE, ERROR_CODE } from '../common/enum'

/**
 * Map the login API response to the user record shape used throughout
 * the app. Mirrors the snailchat convention:
 *   user_id  → id
 *   im_token → token
 *   nick_name → name
 *   avatar   → portrait
 *   role     → role (1 = admin, others = regular agent; server-defined)
 * Plus a `isUsed` flag for the account-switcher list.
 */
function buildUser(data, { isUsed = false } = {}) {
  return {
    id: data.user_id,
    token: data.im_token,
    authorization: data.authorization,
    name: data.nick_name,
    portrait: data.avatar,
    role: data.role,
    isUsed
  }
}

/**
 * Maintain the cached account list (STORAGE.USERS).
 * - Adds a new entry if the id is unknown.
 * - Updates the existing entry's token/authorization/name/portrait in case
 *   they rotated on the server.
 * - Sets the matching entry's `isUsed` flag and clears it on the others so
 *   the list always reflects a single active account.
 */
function upsertInUserList(user) {
  const list = Storage.get(STORAGE.USERS) || []
  const idx = list.findIndex((u) => u.id === user.id)

  const normalized = { ...user, isUsed: true }
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...normalized }
  } else {
    list.push(normalized)
  }
  list.forEach((u) => {
    u.isUsed = u.id === user.id
  })
  Storage.set(STORAGE.USERS, list)
}

function clearActiveUser() {
  const list = Storage.get(STORAGE.USERS) || []
  list.forEach((u) => {
    u.isUsed = false
  })
  Storage.set(STORAGE.USERS, list)
}

/**
 * Login user
 * @param {string} account - Username
 * @param {string} password - Password
 */
async function login(account, password) {
  const res = await request(SERVER_PATH.USER_LOGIN, {
    method: 'POST',
    body: JSON.stringify({ account, password })
  })

  if (res.code === ERROR_CODE.SUCCESS) {
    const user = buildUser(res.data, { isUsed: true })
    // Save token on success
    Storage.set(STORAGE.USER_TOKEN, user)
    upsertInUserList(user)
    console.log('[userService] login success — stored user:', { 
      hasId: !!user.id, 
      hasToken: !!user.token, 
      hasAuth: !!user.authorization 
    })
    // Kick off the IM connection in the background using the returned im_token.
    // Errors are logged but do not fail the login — HTTP auth is what matters.
    im.connect(user, {
      success: () => console.log('[userService] im connected after login'),
      error: (jg, err) => console.warn('[userService] im connect after login failed:', err?.message || err)
    })
  }

  return res
}

/**
 * Logout - clear stored token and active-user marker
 */
function logout() {
  im.disconnect()
  Storage.remove(STORAGE.USER_TOKEN)
  clearActiveUser()
}

/**
 * Get current logged in user
 */
function getCurrentUser() {
  return Storage.get(STORAGE.USER_TOKEN)
}

/**
 * Check if user is logged in
 */
function isLoggedIn() {
  const user = Storage.get(STORAGE.USER_TOKEN)
  return !!user?.authorization
}

/**
 * Get the cached account list (for future account-switcher UI).
 * Returns an empty array if nothing is cached.
 */
function getStoredUsers() {
  return Storage.get(STORAGE.USERS) || []
}

export default {
  login,
  logout,
  getCurrentUser,
  isLoggedIn,
  getStoredUsers
}
