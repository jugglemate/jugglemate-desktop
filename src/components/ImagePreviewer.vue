<script setup>
// Lightbox image preview. Renders the URL full-screen via the native <dialog>
// element so we get the backdrop, the Esc-to-close behavior, and the focus
// trap for free. The parent passes a single URL — we don't support multi-
// image galleries in P1.

import { ref, watch, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  url: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close'])

const dialog = ref(null)

watch(
  () => props.show,
  async (val) => {
    await nextTick()
    if (!dialog.value) return
    if (val) {
      if (!dialog.value.open) dialog.value.showModal()
    } else if (dialog.value.open) {
      dialog.value.close()
    }
  }
)

function onCancel() {
  emit('close')
}

function onBackdropClick(e) {
  if (e.target === dialog.value) emit('close')
}

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog ref="dialog" class="jm-image-preview" @cancel="onCancel" @click="onBackdropClick">
    <div class="jm-image-preview__inner" @click.stop>
      <button
        class="jm-image-preview__close"
        type="button"
        aria-label="关闭"
        @click="emit('close')"
      >
        ✕
      </button>
      <img v-if="url" :src="url" :alt="title || '预览'" class="jm-image-preview__img" />
    </div>
  </dialog>
</template>

<style scoped>
.jm-image-preview {
  background: transparent;
  border: none;
  padding: 0;
  max-width: 100vw;
  max-height: 100vh;
  width: 100vw;
  height: 100vh;
  color: white;
}

.jm-image-preview::backdrop {
  background: oklch(0.08 0.005 260 / 0.92);
  backdrop-filter: blur(4px);
}

.jm-image-preview__inner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  position: relative;
  padding: 24px;
}

.jm-image-preview__img {
  max-width: 90vw;
  max-height: 88vh;
  object-fit: contain;
  border-radius: var(--r);
  box-shadow: var(--shadow-lg);
}

.jm-image-preview__close {
  position: absolute;
  top: 20px;
  right: 24px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(0, 0, 0, 0.4);
  color: white;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--t-fast);
}

.jm-image-preview__close:hover {
  background: rgba(0, 0, 0, 0.7);
  border-color: rgba(255, 255, 255, 0.6);
}
</style>
