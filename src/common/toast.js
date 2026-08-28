// Tiny global toast helper. Anywhere in the app:
//   import toast from '@/common/toast'
//   toast.error('发送失败：未配置对象存储')
// The Toast.vue component subscribes to the emitter and renders the queue.

import emitter from './emitter'

const EVENT = 'jm:toast'

function show(text, opts = {}) {
  // Emit a single object payload. Toast.vue's handler expects `(text, opts)`
  // as two args, but the emitter forwards only ONE payload, so passing an
  // array here would make `text` receive the array and `type` fall back to
  // its default (which also rendered the message with stray brackets).
  emitter.emit(EVENT, { text, ...opts })
}

export default {
  info: (text, opts) => show(text, { ...opts, type: 'info' }),
  success: (text, opts) => show(text, { ...opts, type: 'success' }),
  error: (text, opts) => show(text, { ...opts, type: 'error' }),
  warn: (text, opts) => show(text, { ...opts, type: 'error' })
}
