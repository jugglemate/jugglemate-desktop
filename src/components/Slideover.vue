<script setup>
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  },
  width: {
    type: String,
    default: '420px'
  }
})

const emit = defineEmits(['close'])

function onClose() {
  emit('close')
}

function onBackdropClick(e) {
  if (e.target === e.currentTarget) {
    onClose()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="tyn-overlay" @click="onBackdropClick">
      <div class="tyn-slideover" :style="{ width }">
        <div class="tyn-slideover__header">
          <h3 class="tyn-slideover__title">{{ title }}</h3>
          <button class="tyn-slideover__close" @click="onClose">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="tyn-slideover__body">
          <slot></slot>
        </div>
        <div v-if="$slots.footer" class="tyn-slideover__footer">
          <slot name="footer"></slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>