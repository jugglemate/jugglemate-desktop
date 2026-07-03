<script setup>
// Reaction row shown under a message. The reactions object shape (from the
// JuggleIM SDK) is:
//   { [reactionId]: [{ key, value, user }] }
//
// We render one pill per reactionId with the count. The user can click a pill
// to toggle their own reaction (handled by the parent via the `reaction`
// event). Each pill shows up to N avatars; we cap with a "+N" if there are
// many users.

import { computed } from 'vue'

const props = defineProps({
  reactions: {
    type: Object,
    required: true
  },
  message: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['reaction'])

// `entries` is an array of [reactionId, userList] for v-for.
const entries = computed(() => {
  const out = []
  for (const key of Object.keys(props.reactions || {})) {
    const list = props.reactions[key] || []
    if (!list.length) continue
    out.push({ key, list })
  }
  return out
})

function onClick(reaction) {
  emit('reaction', { emoji: { name: reaction.key }, message: props.message })
}
</script>

<template>
  <div v-if="entries.length" class="jm-msg-reaction">
    <button
      v-for="r in entries"
      :key="r.key"
      class="jm-msg-reaction__pill"
      type="button"
      :title="`${r.key} (${r.list.length})`"
      @click="onClick(r)"
    >
      <span class="jm-msg-reaction__emoji">{{ r.key }}</span>
      <span class="jm-msg-reaction__count">{{ r.list.length }}</span>
    </button>
  </div>
</template>

<style scoped>
.jm-msg-reaction {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  align-self: flex-start;
  max-width: 100%;
}

.jm-msg-reaction__pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--bg);
  border: 1px solid var(--border-soft);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: all var(--t-fast);
}

.jm-msg-reaction__pill:hover {
  background: var(--primary-hover);
  border-color: var(--primary-active);
  color: var(--text-1);
}

.jm-msg-reaction__emoji {
  font-size: 12px;
}

.jm-msg-reaction__count {
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}
</style>
