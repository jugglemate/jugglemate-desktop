<script setup>
// Single-message avatar cell. Delegates to the shared `Avatar` component
// so message-side and chat-header-side avatars share a single source of
// truth for color hashing, sizing, and portrait fallback.
//
// `sender` is the IM message's `sender` field — typically { id, name, portrait }.
// We pass `name` for the initial + color seed, and `portrait` (if any)
// for the background image. The `size` prop mirrors `Avatar`'s scale:
//   sm = 32px, md = 40px, lg = 48px.

import Avatar from '../Avatar.vue'

const props = defineProps({
  sender: {
    type: Object,
    default: () => ({})
  },
  size: {
    type: String,
    default: 'sm' // sm (32) | md (40) | lg (48)
  }
})
</script>

<template>
  <Avatar
    :name="sender?.name || sender?.id || '?'"
    :avatar="sender?.portrait || ''"
    :size="size"
  />
</template>
