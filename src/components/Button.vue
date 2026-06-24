<script setup>
const props = defineProps({
  variant: {
    type: String,
    default: 'primary' // primary, outline, danger-outline
  },
  size: {
    type: String,
    default: 'md' // sm, md
  },
  disabled: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  },
  fullWidth: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click'])

function handleClick(e) {
  if (!props.disabled && !props.loading) {
    emit('click', e)
  }
}
</script>

<template>
  <button
    class="tyn-btn"
    :class="[
      `tyn-btn--${variant}`,
      `tyn-btn--${size}`,
      { 'tyn-btn--disabled': disabled, 'tyn-btn--loading': loading, 'tyn-btn--full': fullWidth }
    ]"
    :disabled="disabled || loading"
    @click="handleClick"
  >
    <span v-if="loading" class="tyn-btn__spinner"></span>
    <slot></slot>
  </button>
</template>