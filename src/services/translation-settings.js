import Storage from '../common/storage'
import emitter from '../common/emitter'
import { EVENT_NAME, STORAGE } from '../common/enum'
import userService from './user'

export const DEFAULT_TARGET_LANGUAGE = 'zh-CN'

export const TRANSLATION_LANGUAGES = Object.freeze([
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁体）' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' }
])

const DEFAULTS = Object.freeze({
  enabled: false,
  targetLang: DEFAULT_TARGET_LANGUAGE
})

function currentUserId() {
  return String(userService.getCurrentUser()?.id || '')
}

function readAll() {
  const value = Storage.get(STORAGE.TRANSLATION_SETTINGS)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalize(value = {}) {
  const targetLang = TRANSLATION_LANGUAGES.some((item) => item.value === value.targetLang)
    ? value.targetLang
    : DEFAULTS.targetLang
  return {
    enabled: value.enabled === true,
    targetLang
  }
}

export function getTranslationSettings(userId = currentUserId()) {
  if (!userId) return { ...DEFAULTS }
  return normalize(readAll()[userId])
}

export function saveTranslationSettings(settings, userId = currentUserId()) {
  if (!userId) return null
  const normalized = normalize(settings)
  const all = readAll()
  all[userId] = normalized
  if (!Storage.set(STORAGE.TRANSLATION_SETTINGS, all)) return null
  emitter.emit(EVENT_NAME.TRANSLATION_SETTINGS_CHANGED, {
    userId,
    settings: { ...normalized }
  })
  return normalized
}

export default {
  get: getTranslationSettings,
  save: saveTranslationSettings,
  languages: TRANSLATION_LANGUAGES
}
