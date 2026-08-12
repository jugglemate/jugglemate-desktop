<script setup>
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: '提示'
  },
  message: {
    type: String,
    default: ''
  },
  confirmText: {
    type: String,
    default: '确认'
  },
  cancelText: {
    type: String,
    default: '取消'
  },
  danger: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['confirm', 'cancel'])

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}

function onBackdropClick(e) {
  if (e.target === e.currentTarget) {
    onCancel()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="tyn-modal-overlay" data-modal-root @click="onBackdropClick">
      <div class="tyn-modal" role="dialog" aria-modal="true" :aria-label="title">
        <div class="tyn-modal__header">
          <h3 class="tyn-modal__title">{{ title }}</h3>
        </div>
        <div class="tyn-modal__body">
          <p>{{ message }}</p>
        </div>
        <div class="tyn-modal__footer">
          <button class="tyn-btn tyn-btn--outline" @click="onCancel">
            {{ cancelText }}
          </button>
          <button
            class="tyn-btn"
            :class="danger ? 'tyn-btn--danger-outline' : 'tyn-btn--primary'"
            @click="onConfirm"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
