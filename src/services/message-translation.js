import im from '../common/im'
import { isElectron } from '../common/platform'
import { SERVER_PATH, post } from './api'

export const TRANSLATION_STATUS = Object.freeze({
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout'
})

const ATTRIBUTE_LIMIT = 1000
const DEFAULT_TIMEOUT = 15000
const inflight = new Map()

const API_LANGUAGE_NAMES = Object.freeze({
  'zh-CN': '中文',
  'zh-TW': '繁体中文',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  ko: '한국어',
  pt: 'Português',
  ru: 'Русский'
})

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

function messageIdentity(message) {
  return {
    messageId: message?.messageId,
    tid: message?.tid,
    conversationType: message?.conversationType,
    conversationId: message?.conversationId
  }
}

function attributeSummary(raw) {
  return {
    present: raw !== undefined && raw !== null && raw !== '',
    type: Array.isArray(raw) ? 'array' : typeof raw,
    length: typeof raw === 'string' ? raw.length : undefined
  }
}

function parseAttribute(raw, context = {}) {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw }
  if (typeof raw !== 'string') {
    console.warn('[translation][attribute] unsupported value', {
      ...context,
      ...attributeSummary(raw)
    })
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    console.warn('[translation][attribute] invalid JSON', {
      ...context,
      ...attributeSummary(raw),
      error: error?.message
    })
    return {}
  }
}

export function readStoredTranslation(message, targetLang) {
  if (!isElectron()) return null
  const text = getMessageText(message)
  const identity = messageIdentity(message)
  const rawAttribute = message?.attribute
  const attribute = parseAttribute(rawAttribute, identity)
  const translation = attribute.translation
  const summary = {
    ...identity,
    ...attributeSummary(rawAttribute),
    keys: Object.keys(attribute),
    targetLang
  }
  if (!translation) {
    console.debug('[translation][attribute] no stored translation', summary)
    return null
  }
  if (translation.version !== 1) {
    console.warn('[translation][attribute] unsupported translation version', {
      ...summary,
      version: translation.version
    })
    return null
  }
  if (translation.targetLang !== targetLang) {
    console.debug('[translation][attribute] target language mismatch', {
      ...summary,
      storedTargetLang: translation.targetLang
    })
    return null
  }
  if (translation.sourceHash !== sourceHash(text)) {
    console.warn('[translation][attribute] source hash mismatch', summary)
    return null
  }
  if (typeof translation.translatedText !== 'string' || !translation.translatedText) {
    console.warn('[translation][attribute] stored translated text is empty', summary)
    return null
  }
  console.info('[translation][attribute] restored', {
    ...summary,
    translatedAt: translation.translatedAt
  })
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
  // Electron only identifies the product shell; it does not mean the IM SDK
  // selected its PC provider. The Web provider also exposes
  // updateMessageAttr(), but calling that stub rejects with SDK error 25010.
  // Persist only when JGChatPCClient was actually injected and selected.
  const diagnostics = {
    ...messageIdentity(message),
    isElectron: isElectron(),
    hasTid: !!message?.tid,
    hasUpdateMessageAttr: typeof client?.updateMessageAttr === 'function',
    hasIsDesktop: typeof client?.isDesktop === 'function',
    sdkDesktop: typeof client?.isDesktop === 'function' ? client.isDesktop() : false
  }
  if (!diagnostics.isElectron || !diagnostics.hasTid ||
      !diagnostics.hasUpdateMessageAttr || !diagnostics.sdkDesktop) {
    console.warn('[translation][attribute] persistence skipped', diagnostics)
    return false
  }
  const attribute = parseAttribute(message.attribute, messageIdentity(message))
  attribute.translation = {
    version: 1,
    sourceHash: sourceHash(getMessageText(message)),
    targetLang,
    translatedText,
    translatedAt: Date.now()
  }
  const serialized = JSON.stringify(attribute)
  if (serialized.length > ATTRIBUTE_LIMIT) {
    console.warn('[translation][attribute] persistence skipped: size limit', {
      ...diagnostics,
      attributeLength: serialized.length,
      attributeLimit: ATTRIBUTE_LIMIT
    })
    return false
  }
  console.info('[translation][attribute] updateMessageAttr request', {
    ...diagnostics,
    attributeLength: serialized.length,
    attributeKeys: Object.keys(attribute)
  })
  const result = await client.updateMessageAttr({ tid: message.tid, attribute: serialized })
  message.attribute = serialized
  console.info('[translation][attribute] updateMessageAttr success', {
    ...diagnostics,
    result,
    localAttributeLength: message.attribute.length
  })
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

async function translateViaApi(source, targetLang, timeoutMs = DEFAULT_TIMEOUT) {
  const result = await withTimeout(post(SERVER_PATH.LLM_TRANSLATE, {
    source,
    target_language: API_LANGUAGE_NAMES[targetLang] || targetLang
  }), timeoutMs)
  if (Number(result?.code) !== 0) {
    const error = new Error(result?.msg || '翻译接口调用失败')
    error.code = result?.code
    throw error
  }
  const content = result?.data?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('翻译结果为空')
  }
  return content
}

export async function translateText(text, targetLang, options = {}) {
  if (!isElectron()) return ''
  const value = String(text || '').trim()
  if (!value) return ''
  const startedAt = Date.now()
  console.info('[translation] request', {
    kind: 'composer',
    transport: 'HTTP /jmate/agentapi/llm/translate',
    targetLang,
    contentLength: value.length
  })
  const translated = await translateViaApi(value, targetLang, options.timeoutMs || DEFAULT_TIMEOUT)
  console.info('[translation] response', {
    kind: 'composer',
    targetLang,
    elapsedMs: Date.now() - startedAt
  })
  return translated
}

export async function translateMessage(message, targetLang, options = {}) {
  if (!isElectron()) return null
  if (!isTranslatableMessage(message)) throw new Error('该消息不支持翻译')
  const client = options.client || im.getCurrent()

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
    const startedAt = Date.now()
    try {
      console.info('[translation] request', {
        kind: 'message',
        transport: 'HTTP /jmate/agentapi/llm/translate',
        messageId: message?.messageId,
        tid: message?.tid,
        targetLang,
        contentLength: text.length
      })
      const translatedText = await translateViaApi(text, targetLang, options.timeoutMs || DEFAULT_TIMEOUT)
      console.info('[translation] response', {
        kind: 'message',
        messageId: message?.messageId,
        tid: message?.tid,
        targetLang,
        elapsedMs: Date.now() - startedAt
      })
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
      console.warn('[translation] failed', {
        messageId: message?.messageId,
        tid: message?.tid,
        targetLang,
        elapsedMs: Date.now() - startedAt,
        code: error?.code,
        message: error?.msg || error?.message
      })
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
