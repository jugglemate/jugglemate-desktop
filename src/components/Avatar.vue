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
    default: 'md' // sm, md, lg
  },
  platform: {
    type: String,
    default: '' // douyin, xhs, tg
  }
})

function formatName(name = '') {
  return name.charAt(0).toUpperCase()
}

function getColorIndex(name = '') {
  return name.charCodeAt(0) % 6
}
</script>

<template>
  <div class="tyn-avatar" :class="[`tyn-avatar--${size}`]" :style="avatar ? { backgroundImage: `url(${avatar})` } : {}">
    <div v-if="!avatar" class="tyn-avatar__inner" :class="[`tyn-peer-color-${getColorIndex(name)}`]">
      {{ formatName(name) }}
    </div>
    <span v-if="platform" class="tyn-avatar__platform" :class="[`tyn-avatar__platform--${platform}`]"></span>
    <slot></slot>
  </div>
</template>