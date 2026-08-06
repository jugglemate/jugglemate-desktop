import { CONFIG, getApiBaseUrl } from '../config'
import { STORAGE, RESPONSE } from './enum'
import Storage from './storage'

/**
 * HTTP request wrapper with authentication
 */
async function request(url, options = {}) {
  const user = Storage.get(STORAGE.USER_TOKEN) || {}
  const { authorization } = user

  const headers = {
    'Content-Type': 'application/json',
    'AppKey': CONFIG.APP_KEY,
    ...options.headers
  }

  if (authorization) {
    headers['Authorization'] = authorization
  }

  const finalOptions = {
    ...options,
    headers
  }

  console.log('[request]', options.method || 'GET', url)

  const res = await fetch(url, finalOptions)

  console.log('[request] response:', res.status, url)

  if (res.status === RESPONSE.UNAUTHORIZED) {
    Storage.remove(STORAGE.USER_TOKEN)
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  const json = await res.json()
  return json
}

/**
 * Upload file via multipart/form-data.
 * Does NOT set Content-Type header — browser auto-sets boundary.
 *
 * @param {string} url
 * @param {File} file
 * @param {object} extraFields - additional form fields
 * @param {string} fieldName - form field name for the file, default 'file'
 */
async function uploadFile(url, file, extraFields = {}, fieldName = 'file') {
  const user = Storage.get(STORAGE.USER_TOKEN) || {}
  const { authorization } = user

  const formData = new FormData()
  formData.append(fieldName, file)
  Object.keys(extraFields).forEach(key => {
    formData.append(key, extraFields[key])
  })

  const headers = {
    'AppKey': CONFIG.APP_KEY
  }
  if (authorization) {
    headers['Authorization'] = authorization
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData
  })

  if (res.status === RESPONSE.UNAUTHORIZED) {
    Storage.remove(STORAGE.USER_TOKEN)
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  const json = await res.json()
  return json
}

/**
 * Build full URL from path
 */
function buildUrl(path) {
  // 始终使用 https：Electron 生产模式下页面从 http://127.0.0.1:port 加载，
  // location.protocol 为 http:，会导致 API 请求走 HTTP → 服务器 301/302 重定向到
  // HTTPS → CORS 预检不允许跟随重定向 → 请求失败。
  return `https://${getApiBaseUrl()}${path}`
}

export { request, uploadFile, buildUrl }