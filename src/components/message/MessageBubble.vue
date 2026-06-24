<script setup>
// Wrapper around a single message's content. Handles:
//   - direction (incoming / outgoing)
//   - outgoing send status (sending / failed / success / uploading)
//   - outgoing read state:
//       * private: single tick (sent) → double tick (read)
//       * group:   a small percentage ring + "X/Y 已读" label
//   - failure resend click
//   - right-click → context menu
// Children render the actual content (text, image, file, ...) via the default
// slot — kept anonymous so MessageItem can use a single `<MessageBubble>` and
// pick the right inner renderer per message type.

import { computed } from 'vue'
import im from '../../common/im'
import messageUtils from './message-utils'
import { sentStateLabel } from './message-utils'
import utils from '../../common/utils'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  prevMessage: {
    type: Object,
    default: null
  },
  isGroup: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['resend', 'context', 'reaction'])

const { SentState, MessageType } = im

const direction = computed(() => (props.message?.isSender ? 'outgoing' : 'incoming'))

const status = computed(() => sentStateLabel(props.message?.sentState))

const isFailed = computed(() => props.message?.sentState === SentState.FAILED)
const isSending = computed(
  () =>
    props.message?.sentState === SentState.SENDING ||
    props.message?.sentState === SentState.UPLOADING
)
const isSuccess = computed(() => props.message?.sentState === SentState.SUCCESS)

// "Media" messages — image, file, video, voice, contact card, merge —
// are visual artifacts with their own backgrounds. Wrapping them in a
// padded bubble makes them look like they're floating in a card. We
// strip the bubble chrome (padding, background) so the artifact sits
// flush against the chat surface, like WeChat / Slack / Telegram.
const isMedia = computed(() => {
  const name = props.message?.name
  return (
    name === MessageType.IMAGE ||
    name === MessageType.FILE ||
    name === MessageType.VIDEO ||
    name === MessageType.VOICE ||
    name === MessageType.MERGE
  )
})

const isSameSender = computed(() => {
  const a = props.prevMessage
  const b = props.message
  if (!a || !b) return false
  const aid = a?.sender?.id
  const bid = b?.sender?.id
  if (!aid || !bid) return false
  return aid === bid
})

// Private chat: "已读" only matters after a successful send. We use the SDK's
// `isRead` field which is set when the remote side reads the message via
// juggle.readMessage.
const isRead = computed(() => {
  if (!isSuccess.value) return false
  if (props.isGroup) return false
  return !!props.message?.isRead
})

// Group chat: read percentage from the SDK's readCount/unreadCount.
const readPercent = computed(() => {
  if (!props.isGroup) return 0
  return messageUtils.getGroupReadPercent(props.message)
})

const readSummary = computed(() => {
  if (!props.isGroup) return ''
  const read = props.message?.readCount || 0
  const unread = props.message?.unreadCount || 0
  return `${read}/${read + unread} 已读`
})

// Progress for file/image/video upload (0-100).
const uploadPercent = computed(() => {
  const p = Number(props.message?.percent)
  if (!p || p < 0) return null
  return Math.min(100, Math.round(p))
})

// Time label below the bubble. Pulled from message.sentTime; falls back to
// "刚刚" for very recent (sub-minute) messages.
const timeLabel = computed(() => {
  const t = props.message?.sentTime
  if (!t) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  return utils.formatTimetoHM(t)
})

const showMeta = computed(() => {
  // Only show ticks/time/burn for outgoing OR group messages (where the
  // group read percentage is relevant). Incoming private messages stay clean.
  if (direction.value === 'outgoing') return true
  if (props.isGroup) return true
  return false
})

function onResend(e) {
  e?.stopPropagation()
  emit('resend', props.message)
}

function onContext(e) {
  emit('context', { event: e, message: props.message })
}
</script>

<template>
  <div
    class="jm-msg"
    :class="[`jm-msg--${direction}`, { 'jm-msg--compact': isSameSender }]"
    @contextmenu.prevent="onContext"
  >
    <slot name="avatar" />

    <div class="jm-msg__body">
      <slot name="sender" />

      <div class="jm-msg__row">
        <div
          class="jm-msg__bubble"
          :class="[
            `jm-msg__bubble--${direction}`,
            {
              'jm-msg__bubble--failed': isFailed,
              'jm-msg__bubble--media': isMedia
            }
          ]"
        >
          <slot />

          <!-- Upload progress overlay. Only renders for in-flight uploads. -->
          <div
            v-if="uploadPercent !== null && uploadPercent < 100"
            class="jm-msg__progress"
          >
            <div
              class="jm-msg__progress-bar"
              :style="{ width: `${uploadPercent}%` }"
            ></div>
            <span class="jm-msg__progress-label">{{ uploadPercent }}%</span>
          </div>

          <!-- Status / read ticks for outgoing messages. -->
          <span
            v-if="direction === 'outgoing'"
            class="jm-msg__status"
            :class="[`jm-msg__status--${status}`]"
            :title="status"
          ></span>
        </div>

        <!-- Group read ring. Sits next to outgoing bubbles in group chats. -->
        <div
          v-if="isGroup && direction === 'outgoing' && isSuccess"
          class="jm-msg__readring"
          :title="readSummary"
        >
          <svg viewBox="0 0 36 36" class="jm-msg__readring-svg">
            <circle
              class="jm-msg__readring-bg"
              cx="18"
              cy="18"
              r="15.9"
            />
            <circle
              class="jm-msg__readring-fg"
              cx="18"
              cy="18"
              r="15.9"
              :stroke-dasharray="`${(readPercent / 360) * 100} 100`"
            />
          </svg>
        </div>

        <button
          v-if="isFailed"
          class="jm-msg__resend"
          type="button"
          @click="onResend"
        >
          重发
        </button>
      </div>

      <!-- Time + ticks row, only when there's something to show. -->
      <div
        v-if="showMeta && (timeLabel || (direction === 'outgoing' && !isGroup))"
        class="jm-msg__meta"
      >
        <span v-if="timeLabel" class="jm-msg__time">{{ timeLabel }}</span>
        <span v-if="direction === 'outgoing' && !isGroup" class="jm-msg__ticks">
          <span
            v-if="isSuccess"
            class="jm-msg__tick"
            :class="{ 'is-read': isRead }"
            aria-hidden="true"
          >✓</span>
          <span
            v-if="isSuccess && isRead"
            class="jm-msg__tick jm-msg__tick--double"
            :class="{ 'is-read': isRead }"
            aria-hidden="true"
          >✓</span>
        </span>
      </div>

      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.jm-msg {
  display: flex;
  gap: 10px;
  max-width: 70%;
  animation: jm-msgIn 200ms ease-out;
  align-items: flex-start;
}

.jm-msg--outgoing {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.jm-msg--incoming {
  align-self: flex-start;
}

.jm-msg--compact {
  margin-top: 0;
}

.jm-msg__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.jm-msg--outgoing .jm-msg__body {
  align-items: flex-end;
}

.jm-msg__row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.jm-msg--outgoing .jm-msg__row {
  flex-direction: row-reverse;
}

.jm-msg__bubble {
  position: relative;
  padding: 12px 16px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.55;
  color: #333333;
  word-break: break-word;
  white-space: pre-wrap;
  max-width: 100%;
  min-width: 0;
}

.jm-msg__bubble--incoming {
  background: #FFFFFF;
  color: #333333;
  border-radius: 4px 16px 16px 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
}

.jm-msg__bubble--outgoing {
  /* background: #F0F5FF;
  color: #333333; */
  background: #2187fc;
  color: #fff;
  border-radius: 16px 4px 16px 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
}

.jm-msg__bubble--no-bg {
  background: transparent;
  padding: 0;
  border-radius: var(--radius-md);
  border: none;
}

/* Media bubbles: drop the padded background so the image / file / video
   renders flush. We keep the same border-radius (rounded-md) so the
   artifact has a tidy silhouette, and the artifact's own root supplies
   the rest of the visual chrome. The `--failed` outline still works on
   top because the box-shadow doesn't depend on background. */
.jm-msg__bubble--media {
  background: transparent;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  font-size: inherit;
  line-height: 0;
  word-break: normal;
  white-space: normal;
}

.jm-msg__bubble--failed {
  box-shadow: 0 0 0 1px var(--danger);
}

.jm-msg__progress {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  background: oklch(0.16 0.008 260 / 0.7);
  border-radius: inherit;
  gap: 4px;
}

.jm-msg__progress-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  background: var(--accent);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  transition: width var(--transition-fast);
}

.jm-msg__progress-label {
  position: relative;
  z-index: 1;
  font-size: 11px;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.jm-msg__status {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 6px;
  vertical-align: middle;
  background: transparent;
  flex-shrink: 0;
}

.jm-msg__status--sending,
.jm-msg__status--uploading {
  width: 10px;
  height: 10px;
  border: 1.5px solid oklch(0.7 0.04 260);
  border-top-color: var(--text-primary);
  animation: jm-spin 0.8s linear infinite;
  background: transparent;
}

.jm-msg__status--success {
  
}

.jm-msg__status--failed {
  background: var(--danger);
}

.jm-msg__readring {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.jm-msg__readring-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.jm-msg__readring-bg {
  fill: none;
  stroke: var(--border-subtle);
  stroke-width: 4;
}

.jm-msg__readring-fg {
  fill: none;
  stroke: var(--accent);
  stroke-width: 4;
  stroke-linecap: round;
  transition: stroke-dasharray var(--transition-smooth);
}

.jm-msg__resend {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.jm-msg__resend:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--text-tertiary);
}

.jm-msg__meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: #999999;
}

.jm-msg__time {
  font-variant-numeric: tabular-nums;
}

.jm-msg__ticks {
  display: inline-flex;
  align-items: center;
  gap: -2px;
  margin-left: 2px;
}

.jm-msg__tick {
  font-size: 11px;
  color: var(--text-tertiary);
}

.jm-msg__tick.is-read {
  color: var(--accent);
}

.jm-msg__tick--double {
  margin-left: -6px;
}

@keyframes jm-msgIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes jm-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
