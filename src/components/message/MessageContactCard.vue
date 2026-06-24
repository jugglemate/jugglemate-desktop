<script setup>
// Contact-card message. Renders a small profile card with avatar, name, and
// a one-line account label. The actual content shape is whatever the sender
// embedded in `message.content` — we look for a few common keys and fall
// back to a generic display.

import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const card = computed(() => {
  // Support a couple of common shapes:
  //   { user_id, nickname, avatar }            — direct user info
  //   { user: { id, name, portrait } }         — wrapped
  //   { name, portrait, account }              — flat
  const c = props.message?.content || {}
  if (c.user && typeof c.user === 'object') {
    return {
      name: c.user.name || c.user.nickname || c.user.id || '未知联系人',
      portrait: c.user.portrait || c.user.avatar || '',
      account: c.user.account || c.user.id || ''
    }
  }
  return {
    name: c.nickname || c.name || c.user_id || '未知联系人',
    portrait: c.avatar || c.portrait || '',
    account: c.account || c.user_id || ''
  }
})

function initial(name) {
  if (!name) return '?'
  return Array.from(name).find((c) => /\S/.test(c)) || '?'
}
</script>

<template>
  <div class="jm-msg-card">
    <div class="jm-msg-card__avatar">
      <img v-if="card.portrait" :src="card.portrait" :alt="card.name" />
      <span v-else>{{ initial(card.name) }}</span>
    </div>
    <div class="jm-msg-card__info">
      <div class="jm-msg-card__name">{{ card.name }}</div>
      <div v-if="card.account" class="jm-msg-card__account">{{ card.account }}</div>
    </div>
    <div class="jm-msg-card__hint" aria-hidden="true">名片</div>
  </div>
</template>

<style scoped>
.jm-msg-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: 280px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.jm-msg-card__avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  flex-shrink: 0;
}

.jm-msg-card__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.jm-msg-card__info {
  flex: 1;
  min-width: 0;
}

.jm-msg-card__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.jm-msg-card__account {
  font-size: 11px;
  color: var(--text-tertiary);
}

.jm-msg-card__hint {
  font-size: 10px;
  color: var(--text-tertiary);
  background: var(--bg-root);
  border: 1px solid var(--border-subtle);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
</style>
