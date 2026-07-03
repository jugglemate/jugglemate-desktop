<script setup>
// Single-message avatar cell. Delegates to the shared `Avatar` component
// so message-side and chat-header-side avatars share a single source of
// truth for color hashing, sizing, and portrait fallback.
//
// `sender` is the IM message's `sender` field — typically { id, name, portrait }.
// We pass `name` for the initial + color seed, and `portrait` (if any)
// for the background image. The `size` prop mirrors `Avatar`'s scale:
//   xs = 28px, sm = 32px, md = 36px, lg = 42px.
//
// `hide` is used by MessageItem to keep alignment tidy when consecutive
// messages share a sender — we still occupy the avatar slot so the
// bubbles line up, but we collapse the visible footprint. Defaults to
// false so the avatar always shows by default.

import Avatar from '../Avatar.vue'

const props = defineProps({
  sender: {
    type: Object,
    default: () => ({})
  },
  size: {
    type: String,
    default: 'sm' // xs (28) | sm (32) | md (36) | lg (42)
  },
  hide: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <div class="jm-msg-avatar" :class="{ 'jm-msg-avatar--hidden': hide }">
    <Avatar
      :name="sender?.name || sender?.id || '?'"
      :avatar="sender?.portrait || ''"
      :size="size"
    />
  </div>
</template>

<style scoped>
.jm-msg-avatar {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  margin-top: 2px;
  transition: opacity 160ms ease;
}

.jm-msg-avatar--hidden {
  visibility: hidden;
  pointer-events: none;
}
</style>
