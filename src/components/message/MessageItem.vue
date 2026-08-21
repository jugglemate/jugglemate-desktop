<script setup>
// Message dispatcher. Sits between the chat scroll area and the per-type
// renderers. The parent component (ChatMain) just does `v-for="m in messages"
// <MessageItem :message="m" />` and this component picks the right inner
// renderer based on `message.name`.
//
// Adding a new message type = (1) add the name to `MSG_NAME` in
// common/enum.js, (2) create a new `Message*.vue`, (3) add a branch below.
// No other component needs to change.

import { computed } from 'vue'
import im from '../../common/im'
import { MSG_NAME } from '../../common/enum'

import MessageAvatar from './MessageAvatar.vue'
import MessageBubble from './MessageBubble.vue'
import MessageText from './MessageText.vue'
import MessageImage from './MessageImage.vue'
import MessageFile from './MessageFile.vue'
import MessageVideo from './MessageVideo.vue'
import MessageVoice from './MessageVoice.vue'
import MessageContactCard from './MessageContactCard.vue'
import MessageMerge from './MessageMerge.vue'
import MessageReaction from './MessageReaction.vue'
import MessageTimeline from './MessageTimeline.vue'
import MessageUnknown from './MessageUnknown.vue'
import MessageRecall from './MessageRecall.vue'
import MessageTicketAssign from './MessageTicketAssign.vue'
import MessageTicketReassign from './MessageTicketReassign.vue'
import MessageCSAT from './MessageCSAT.vue'
import MessageCSATReply from './MessageCSATReply.vue'
import MessageTranslation from './MessageTranslation.vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  prevMessage: {
    type: Object,
    default: null
  },
  // True when the current conversation is a group; we use it to decide
  // whether to render the sender's display name above the bubble.
  isGroup: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['resend', 'context', 'reaction', 'preview', 'translationRetry'])

const { MessageType, ConversationType } = im

// Render this message as one of:
//   'timeline' | 'recall' | 'text' | 'image' | 'file' | 'video' | 'voice'
//   | 'card' | 'merge' | 'sticker' | 'unknown'
// Anything not covered by an explicit branch falls through to 'unknown',
// which still renders a placeholder so the message list never breaks.
const kind = computed(() => {
  const m = props.message
  if (!m) return 'unknown'
  if (m.name === 'notify') return 'timeline'
  if (m.name === MessageType.RECALL_INFO) return 'recall'
  if (m.name === MessageType.TEXT) return 'text'
  if (m.name === MessageType.STREAM_TEXT) return 'text' // P4: stream text uses text renderer for now
  if (m.name === MessageType.IMAGE) return 'image'
  if (m.name === MessageType.FILE) return 'file'
  if (m.name === MessageType.VIDEO) return 'video'
  if (m.name === MessageType.VOICE) return 'voice'
  if (m.name === MessageType.MERGE) return 'merge'
  if (m.name === MSG_NAME.CONTACT_CARD) return 'card'
  if (m.name === MSG_NAME.ANIMATION_STICKER) return 'sticker'
  if (m.name === MSG_NAME.TICKET_ASSIGN) return 'ticketassign'
  if (m.name === MSG_NAME.TICKET_REASSIGN) return 'ticketreassign'
  if (m.name === MSG_NAME.CSAT_REPLY) return 'csatreply'
  if (m.name === MSG_NAME.CSAT || m.content?.kind === 'csat') return 'csat'
  return 'unknown'
})

// Resolved isGroup from the message itself. The `isGroup` prop takes
// precedence so the parent can pass the conversation's type without us
// having to know about the parent conversation object.
const isGroupEffective = computed(() => {
  if (props.isGroup) return true
  if (props.message?.conversationType === ConversationType.GROUP) return true
  return false
})

// Show the sender's name row only when the current message is from a
// different sender than the previous one (or the previous message is
// absent/typed differently).
const showSender = computed(() => {
  if (!isGroupEffective.value) return false
  if (props.message?.isSender) return false
  const a = props.prevMessage
  if (!a) return true
  return a?.sender?.id !== props.message?.sender?.id
})

// Hide the avatar when this message and the previous one share a sender
// AND are within a short time window. We keep the slot rendered (just
// visually collapsed) so bubbles stay vertically aligned. Skipped for
// outgoing so the bubble's right edge stays flush.
const hideAvatar = computed(() => {
  if (props.message?.isSender) return false
  const a = props.prevMessage
  if (!a) return false
  if (a?.sender?.id !== props.message?.sender?.id) return false
  // Don't hide across long gaps — would look like a missing avatar.
  const gap = (props.message?.sentTime || 0) - (a?.sentTime || 0)
  return gap < 5 * 60_000
})

const senderName = computed(() => {
  return props.message?.sender?.name || props.message?.sender?.id || ''
})

// Reactions map. When present, we render a small emoji row below the
// bubble (MessageReaction). Tap to remove your own reaction.
const hasReactions = computed(() => {
  const r = props.message?.reactions
  return r && typeof r === 'object' && Object.keys(r).length > 0
})

function onPreview(payload) {
  emit('preview', payload)
}
</script>

<template>
  <!-- Timeline / recall / ticketassign are full-width rows; no avatar or bubble. -->
  <MessageTimeline v-if="kind === 'timeline'" :message="message" />
  <MessageRecall v-else-if="kind === 'recall'" :message="message" />
  <MessageTicketAssign v-else-if="kind === 'ticketassign'" :message="message" />
  <MessageTicketReassign v-else-if="kind === 'ticketreassign'" :message="message" />

  <!-- Default: bubble with avatar. -->
  <MessageBubble
    v-else
    :message="message"
    :prev-message="prevMessage"
    :is-group="isGroupEffective"
    @resend="(m) => emit('resend', m)"
    @context="(p) => emit('context', p)"
    @reaction="(p) => emit('reaction', p)"
  >
    <template #avatar>
      <MessageAvatar :sender="message.sender" :hide="hideAvatar" />
    </template>

    <template #sender>
      <div v-if="showSender" class="jm-msg__sender">{{ senderName }}</div>
    </template>

    <MessageText v-if="kind === 'text'" :message="message" />
    <MessageImage v-else-if="kind === 'image'" :message="message" :incoming="!message?.isSender" @preview="onPreview" />
    <MessageFile v-else-if="kind === 'file'" :message="message" :incoming="!message?.isSender" />
    <MessageVideo v-else-if="kind === 'video'" :message="message" />
    <MessageVoice v-else-if="kind === 'voice'" :message="message" />
    <MessageContactCard v-else-if="kind === 'card'" :message="message" />
    <MessageMerge v-else-if="kind === 'merge'" :message="message" />
    <MessageCSAT v-else-if="kind === 'csat'" :message="message" />
    <MessageCSATReply v-else-if="kind === 'csatreply'" :message="message" />
    <MessageUnknown v-else :message="message" />
    <MessageTranslation
      v-if="kind === 'text'"
      :message="message"
      :visible="message.translationVisible !== false"
      @retry="(m) => emit('translationRetry', m)"
    />

    <template #footer>
      <MessageReaction
        v-if="hasReactions"
        :reactions="message.reactions"
        :message="message"
        @reaction="(p) => emit('reaction', p)"
      />
    </template>
  </MessageBubble>
</template>

<style scoped>
.jm-msg__sender {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  margin-bottom: 4px;
  padding-left: 4px;
}
</style>
