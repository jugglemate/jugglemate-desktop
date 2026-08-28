<script setup>
// Lightweight toast notifier. Push a message via the global `toast` API
// and it shows for 2.4s, then fades. Used by ChatMain to surface SDK
// upload errors that would otherwise be swallowed by try/catch.

import { ref, onMounted, onBeforeUnmount } from 'vue'
import emitter from '../common/emitter'

const EVENT = 'jm:toast'
const messages = ref([])
let nextId = 1

function show({ text, type = 'info', duration = 2400 } = {}) {
  const id = nextId++
  messages.value.push({ id, text, type })
  setTimeout(() => {
    const i = messages.value.findIndex((m) => m.id === id)
    if (i >= 0) messages.value.splice(i, 1)
  }, duration)
}

function dismiss(id) {
  const i = messages.value.findIndex((m) => m.id === id)
  if (i >= 0) messages.value.splice(i, 1)
}

onMounted(() => emitter.on(EVENT, show))
onBeforeUnmount(() => emitter.off(EVENT))
</script>

<template>
  <Teleport to="body">
    <div class="jm-toast-stack" aria-live="polite">
      <div
        v-for="m in messages"
        :key="m.id"
        class="jm-toast"
        :class="[`jm-toast--${m.type}`]"
        @click="dismiss(m.id)"
      >
        <span class="jm-toast__text">{{ m.text }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.jm-toast-stack {
  position: fixed;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.jm-toast {
  pointer-events: auto;
  min-width: 240px;
  max-width: 480px;
  padding: 10px 16px;
  border-radius: var(--r);
  background: var(--bg);
  color: var(--text-1);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
  font-size: 13px;
  cursor: pointer;
  animation: jm-toastIn 180ms ease-out;
}

.jm-toast--error {
  color: var(--danger);
  border-color: oklch(0.35 0.12 20);
}

.jm-toast--success {
  color: var(--success);
}

.jm-toast--info {
  border-color: var(--border);
}

@keyframes jm-toastIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
