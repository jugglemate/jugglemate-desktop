import {
  PLATFORM,
  PLATFORM_META,
  PLATFORM_TAG_ID,
  TICKET_GLOBAL_TAG
} from './enum'

// TICKET_GLOBAL_TAG.CHANNEL_* → PLATFORM.*
const CHANNEL_TAG_TO_PLATFORM = {
  [TICKET_GLOBAL_TAG.CHANNEL_WIDGET]:   PLATFORM.WEB,
  [TICKET_GLOBAL_TAG.CHANNEL_TELEGRAM]: PLATFORM.TELEGRAM,
  [TICKET_GLOBAL_TAG.CHANNEL_JUGGLEIM]: PLATFORM.JUGGLECHAT,
  [TICKET_GLOBAL_TAG.CHANNEL_WATCHAPP]: PLATFORM.WATCHAPP
}

// PLATFORM_TAG_ID.* → PLATFORM.*
const PLATFORM_ID_TO_PLATFORM = {
  [PLATFORM_TAG_ID.WEB]:        PLATFORM.WEB,
  [PLATFORM_TAG_ID.TELEGRAM]:   PLATFORM.TELEGRAM,
  [PLATFORM_TAG_ID.JUGGLECHAT]: PLATFORM.JUGGLECHAT,
  [PLATFORM_TAG_ID.WATCHAPP]:   PLATFORM.WATCHAPP
}

/**
 * Pick the first channel-shaped tag out of a tags array. Tolerates both
 * `{id, name, type}` and raw `{tag, tagName, tagType}` shapes.
 */
function findChannelTag(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return null
  return tags.find((item) => {
    const tagId = item?.id ?? item?.tag
    return tagId === TICKET_GLOBAL_TAG.CHANNEL_WIDGET
      || tagId === TICKET_GLOBAL_TAG.CHANNEL_TELEGRAM
      || tagId === TICKET_GLOBAL_TAG.CHANNEL_JUGGLEIM
      || tagId === TICKET_GLOBAL_TAG.CHANNEL_WATCHAPP
  }) || null
}

/**
 * Resolve the platform metadata for a conversation, list row, or any object
 * that exposes `tags` / `platform` / `platformKey`. Returns `null` for
 * groups, empty inputs, and unknown platforms.
 *
 * Priority: tags (channel_*) > platform / platformKey.
 *
 * @param {Object|Array|string|null} input - one of:
 *   - a conversation-like object (reads `.tags`, `.platform`, `.platformKey`)
 *   - a bare `tags` array
 *   - a bare `platform` / `platformKey` string
 *   - `null` / `undefined`
 * @param {Object} [opts]
 * @param {boolean} [opts.isGroup=false] - when true, always return null
 * @returns {Object|null} platform meta or null
 */
function resolvePlatformMeta(input, opts) {
  // if (opts && opts.isGroup) return null

  let tags = null
  let platformRaw = null

  if (Array.isArray(input)) {
    tags = input
  } else if (input && typeof input === 'object') {
    tags = Array.isArray(input.tags) ? input.tags : null
    platformRaw = input.platform ?? input.platformKey ?? null
  } else if (typeof input === 'string') {
    platformRaw = input
  } else {
    return null
  }

  // 1) tags path
  const channelTag = findChannelTag(tags)
  if (channelTag) {
    const tagId = channelTag.id ?? channelTag.tag
    const key = CHANNEL_TAG_TO_PLATFORM[tagId]
    if (key && PLATFORM_META[key]) {
      return { key, source: 'tags', ...PLATFORM_META[key] }
    }
  }

  // 2) platform / platformKey path
  if (platformRaw != null && platformRaw !== '') {
    const normalized = String(platformRaw).toLowerCase()
    const key = PLATFORM_ID_TO_PLATFORM[normalized]
    if (key && PLATFORM_META[key]) {
      return { key, source: 'platform', ...PLATFORM_META[key] }
    }
  }

  return null
}

/**
 * Inverse of `resolvePlatformMeta`: PLATFORM.* → TICKET_GLOBAL_TAG.CHANNEL_*.
 * Returns `undefined` for PLATFORM.ALL (no tag) and unknown keys, matching
 * the buildTagParamForPlatform helper in Conversations.vue.
 */
function platformKeyToChannelTag(platformKey) {
  if (!platformKey || platformKey === PLATFORM.ALL) return undefined
  const entry = Object.entries(CHANNEL_TAG_TO_PLATFORM).find(([, key]) => key === platformKey)
  return entry ? entry[0] : undefined
}

export {
  resolvePlatformMeta,
  platformKeyToChannelTag,
  findChannelTag,
  CHANNEL_TAG_TO_PLATFORM,
  PLATFORM_ID_TO_PLATFORM
}

export default {
  resolvePlatformMeta,
  platformKeyToChannelTag,
  findChannelTag,
  CHANNEL_TAG_TO_PLATFORM,
  PLATFORM_ID_TO_PLATFORM
}
