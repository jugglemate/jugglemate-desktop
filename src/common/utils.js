// Lightweight utility belt used across IM migration. Modeled after snailchat-web's
// common/utils.js, trimmed to what we actually consume: type checks, collection
// helpers, extend/find/filter/map, a UUID generator, simple string templates, and
// a time labeler that matches the conversation list's existing format.

const noop = () => {}

const isObject = (obj) =>
  Object.prototype.toString.call(obj) === '[object Object]'
const isArray = (arr) =>
  Object.prototype.toString.call(arr) === '[object Array]'
const isString = (str) =>
  Object.prototype.toString.call(str) === '[object String]'
const isNumber = (str) =>
  Object.prototype.toString.call(str) === '[object Number]'
const isUndefined = (str) =>
  Object.prototype.toString.call(str) === '[object Undefined]'
const isNull = (str) =>
  Object.prototype.toString.call(str) === '[object Null]'

const stringify = (obj) => JSON.stringify(obj)
const parse = (str) => {
  try {
    return JSON.parse(str)
  } catch (e) {
    return null
  }
}

const forEach = (obj, callback) => {
  callback = callback || noop
  if (isObject(obj)) {
    for (const key in obj) callback(obj[key], key, obj)
  }
  if (isArray(obj)) {
    for (let i = 0; i < obj.length; i++) callback(obj[i], i, obj)
  }
}

const isEmpty = (obj) => {
  if (obj == null) return true
  if (isObject(obj)) {
    for (const k in obj) return false
    return true
  }
  if (isString(obj) || isArray(obj)) return obj.length === 0
  if (isNumber(obj)) return obj === 0
  return false
}

const isEqual = (a, b) => {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false
  if (isObject(a) && isObject(b)) {
    const ak = Object.keys(a)
    const bk = Object.keys(b)
    if (ak.length !== bk.length) return false
    for (const k of ak) {
      if (!isEqual(a[k], b[k])) return false
    }
    return true
  }
  if (isArray(a) && isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) return false
    }
    return true
  }
  return false
}

const isInclude = (str, match) => {
  if (str == null) return false
  return String(str).indexOf(match) !== -1
}

const extend = (destination, sources) => {
  sources = isArray(sources) ? sources : [sources]
  forEach(sources, (source) => {
    if (!source) return
    for (const key in source) {
      const value = source[key]
      if (!isUndefined(value)) destination[key] = value
    }
  })
  return destination
}

const find = (arr, callback) => {
  if (!isArray(arr)) return -1
  for (let i = 0; i < arr.length; i++) {
    if (callback(arr[i], i, arr)) return i
  }
  return -1
}

const filter = (arr, callback) => {
  if (!isArray(arr)) return []
  const out = []
  for (let i = 0; i < arr.length; i++) {
    if (callback(arr[i], i, arr)) out.push(arr[i])
  }
  return out
}

const map = (arr, callback) => {
  if (!isArray(arr)) return []
  const out = []
  for (let i = 0; i < arr.length; i++) {
    out.push(callback(arr[i], i, arr))
  }
  return out
}

const some = (arr, callback) => {
  if (!isArray(arr)) return false
  for (let i = 0; i < arr.length; i++) {
    if (callback(arr[i], i, arr)) return true
  }
  return false
}

const clone = (source) => {
  if (source == null) return source
  return parse(stringify(source))
}

// Simple UUID v4. We use this for the temporary client-side message id (`tid`)
// that gets swapped for the real `messageId` after the server acks. crypto.randomUUID
// is available in modern browsers/Vite, fall back to a Math.random variant for old runtimes.
const getUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// `${name}: ${content}` style template. We don't support complex expressions —
// just dotted-path lookup. Examples:
//   templateFormat("hi {name}", { name: "tom" })
//   templateFormat("hi {user.name}", { user: { name: "tom" } })
const templateFormat = (tpl, data) => {
  if (!isString(tpl) || !isObject(data)) return tpl
  return tpl.replace(/\{([\w.]+)\}/g, (_, path) => {
    const parts = path.split('.')
    let val = data
    for (const p of parts) {
      if (val == null) return ''
      val = val[p]
    }
    return val == null ? '' : String(val)
  })
}

// Short HH:MM label used by the conversation list and the message bubbles.
const pad2 = (n) => String(n).padStart(2, '0')
const formatTimetoHM = (timestamp) => {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return `${d.getHours()}:${pad2(d.getMinutes())}`
}

// Dater labels used by the conversation list:
//   same day -> HH:mm
//   within 7 days -> 星期X
//   older -> M/D
const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return formatTimetoHM(timestamp)
  const dayDiff = (now - d) / 86400000
  if (dayDiff < 7) return WEEK_LABELS[d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default {
  noop,
  isObject,
  isArray,
  isString,
  isNumber,
  isUndefined,
  isNull,
  isEmpty,
  isEqual,
  isInclude,
  forEach,
  extend,
  find,
  filter,
  map,
  some,
  clone,
  stringify,
  parse,
  getUUID,
  templateFormat,
  formatTimetoHM,
  formatTime
}

export {
  noop,
  isObject,
  isArray,
  isString,
  isNumber,
  isUndefined,
  isNull,
  isEmpty,
  isEqual,
  isInclude,
  forEach,
  extend,
  find,
  filter,
  map,
  some,
  clone,
  stringify,
  parse,
  getUUID,
  templateFormat,
  formatTimetoHM,
  formatTime
}
