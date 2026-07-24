<script setup>
const props = defineProps({
  name: {
    type: String,
    default: ''
  },
  avatar: {
    type: String,
    default: ''
  },
  size: {
    type: String,
    default: 'md' // xs, sm, md, lg
  },
  platform: {
    type: String,
    default: '' // douyin, xhs, tg
  }
})

function formatName(name = '') {
  // First visible character, uppercased. We walk past whitespace so that
  // names like "  李四" still resolve to "李"; emoji and CJK both yield a
  // single grapheme. Returns "?" when the string is empty.
  const trimmed = name.trim()
  if (!trimmed) return "?"
  return Array.from(trimmed)[0].toUpperCase()
}

// Deterministic full-name djb2-style hash. We hash the entire trimmed
// string (not just the first char) so two peers whose names start with
// the same letter don't share a color slot. Modulo is applied only at
// the end to keep the distribution even.
function getColorIndex(name = "") {
  const trimmed = name.trim()
  if (!trimmed) return 0
  let hash = 5381
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 33) ^ trimmed.charCodeAt(i)
  }
  return Math.abs(hash) % 6
}
</script>

<template>
  <div class="tyn-avatar" :class="[`tyn-avatar--${size}`]" :style="avatar ? { backgroundImage: `url(${avatar})` } : {}">
    <div v-if="!avatar" class="tyn-avatar__inner" :class="[`tyn-peer-color-${getColorIndex(name)}`]">
      {{ formatName(name) }}
    </div>
    <slot></slot>
  </div>
</template>