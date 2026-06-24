// Minimal mitt-style event bus. Used to coordinate cross-component actions
// (drafting, clearing, group member add/remove, app language change) without
// having to thread props through every layer. Replaces snailchat-web's
// common/emmit.js.

const handlers = new Map()

function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event).add(fn)
  return () => off(event, fn)
}

function off(event, fn) {
  const set = handlers.get(event)
  if (!set) return
  if (fn) set.delete(fn)
  else set.clear()
}

function emit(event, payload) {
  const set = handlers.get(event)
  if (!set) return
  // Snapshot to allow handlers to call off() during dispatch.
  for (const fn of Array.from(set)) {
    try {
      fn(payload)
    } catch (e) {
      // Don't let one bad subscriber break the rest of the chain.
      console.error('[emitter] handler for', event, 'threw', e)
    }
  }
}

function clear() {
  handlers.clear()
}

export default { on, off, emit, clear }

export { on, off, emit, clear }
