import im from '../common/im'
import { isElectron } from '../common/platform'

export const TRANSLATION_STATUS = Object.freeze({
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout'
})

const ATTRIBUTE_LIMIT = 1000
const DEFAULT_TIMEOUT = 15000
const inflight = new Map()

export function getMessageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (typeof content?.content === 'string') return content.content.trim()
  return ''
}

export function isTranslatableMessage(message) {
  if (!message) return false
  const { MessageType } = im
  return message.name === MessageType.TEXT && !!getMessageText(message)
}

// Small deterministic hash used only to invalidate stale local translations.
// It is not a security primitive.
export function sourceHash(text = '') {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function parseAttribute(raw) {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function readStoredTranslation(message, targetLang) {
  if (!isElectron()) return null
  const text = getMessageText(message)
  const translation = parseAttribute(message?.attribute)?.translation
  if (!translation || translation.version !== 1) return null
  if (translation.targetLang !== targetLang) return null
  if (translation.sourceHash !== sourceHash(text)) return null
  if (typeof translation.translatedText !== 'string' || !translation.translatedText) return null
  return {
    status: TRANSLATION_STATUS.COMPLETED,
    targetLang,
    translatedText: translation.translatedText,
    translatedAt: translation.translatedAt || 0,
    persisted: true
  }
}

export function hydrateMessageTranslation(message, targetLang) {
  const stored = readStoredTranslation(message, targetLang)
  if (stored) message.translation = stored
  else if (message?.translation && (
    message.translation.targetLang !== targetLang ||
    message.translation.sourceHash !== sourceHash(getMessageText(message))
  )) delete message.translation
  return stored
}

async function persistTranslation(client, message, targetLang, translatedText) {
  if (!isElectron() || !message?.tid || typeof client?.updateMessageAttr !== 'function') {
    return false
  }
  const attribute = parseAttribute(message.attribute)
  attribute.translation = {
    version: 1,
    sourceHash: sourceHash(getMessageText(message)),
    targetLang,
    translatedText,
    translatedAt: Date.now()
  }
  const serialized = JSON.stringify(attribute)
  if (serialized.length > ATTRIBUTE_LIMIT) return false
  await client.updateMessageAttr({ tid: message.tid, attribute: serialized })
  message.attribute = serialized
  return true
}

function requestKey(message, targetLang) {
  return `${message?.conversationType || ''}:${message?.conversationId || ''}:${message?.messageId || message?.tid || sourceHash(getMessageText(message))}:${targetLang}`
}

function withTimeout(promise, timeoutMs) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('翻译超时')
      error.code = 'TRANSLATION_TIMEOUT'
      reject(error)
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function translateText(text, targetLang, options = {}) {
  if (!isElectron()) return ''
  const value = String(text || '').trim()
  if (!value) return ''
  const client = options.client || im.getCurrent()
  if (!client?.translate) throw new Error('翻译服务不可用')
  const result = await withTimeout(client.translate({
    sourceLang: 'auto',
    targetLang,
    content: { text: value }
  }), options.timeoutMs || DEFAULT_TIMEOUT)
  const translated = result?.text
  if (typeof translated !== 'string' || !translated.trim()) throw new Error('翻译结果为空')
  return translated
}

export async function translateMessage(message, targetLang, options = {}) {
  if (!isElectron()) return null
  if (!isTranslatableMessage(message)) throw new Error('该消息不支持翻译')
  const client = options.client || im.getCurrent()
  if (!client?.translate) throw new Error('翻译服务不可用')

  const cached = options.force ? null : readStoredTranslation(message, targetLang)
  if (cached) {
    message.translation = cached
    return cached
  }

  const key = requestKey(message, targetLang)
  if (inflight.has(key)) return inflight.get(key)
  const text = getMessageText(message)
  message.translation = { status: TRANSLATION_STATUS.PENDING, targetLang }

  const task = (async () => {
    try {
      const result = await withTimeout(client.translate({
        sourceLang: 'auto',
        targetLang,
        content: { message: text }
      }), options.timeoutMs || DEFAULT_TIMEOUT)
      const translatedText = result?.message
      if (typeof translatedText !== 'string' || !translatedText.trim()) {
        throw new Error('翻译结果为空')
      }
      let persisted = false
      try {
        persisted = await persistTranslation(client, message, targetLang, translatedText)
      } catch (error) {
        // Persistence is best-effort. The translated result remains usable.
        console.warn('[translation] updateMessageAttr failed', error)
      }
      const translation = {
        status: TRANSLATION_STATUS.COMPLETED,
        targetLang,
        sourceHash: sourceHash(text),
        translatedText,
        translatedAt: Date.now(),
        persisted
      }
      message.translation = translation
      return translation
    } catch (error) {
      message.translation = {
        status: error?.code === 'TRANSLATION_TIMEOUT'
          ? TRANSLATION_STATUS.TIMEOUT
          : TRANSLATION_STATUS.FAILED,
        targetLang,
        error: error?.msg || error?.message || '翻译失败'
      }
      throw error
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, task)
  return task
}

export default {
  getMessageText,
  isTranslatableMessage,
  readStoredTranslation,
  hydrateMessageTranslation,
  translateMessage,
  translateText
}
