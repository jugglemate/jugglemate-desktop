<script setup>
// Message input row. Three responsibilities:
//   1. Capture the draft text (so the parent can persist it as a draft)
//   2. Enter-to-send, Shift-Enter for newline
//   3. Expose attachment pickers (image / file / video) that emit
//      `attach` with the File object. The parent decides whether to call
//      juggle.sendImageMessage / sendFileMessage / sendVideoMessage based
//      on the file's mime type.
//
// In P1 we keep the picker simple — one button with a `accept` attribute
// that defaults to "image/*". The parent can re-emit `attach` from a more
// specific picker (e.g. a "file" button) in a later phase. The picker's
// value is reset after each emit so the same file can be re-selected.

import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: '输入消息...'
  },
  disabled: {
    type: Boolean,
    default: false
  },
  // Comma-separated `accept` value for the file input. Defaults to all
  // file types so the picker surfaces images, videos, PDFs, and any other
  // attachment. The parent can pass `image/*` (or a specific mime list)
  // to narrow the picker.
  accept: {
    type: String,
    default: '*/*'
  }
})

const emit = defineEmits(['update:modelValue', 'send', 'attach', 'focus', 'blur'])

const text = ref(props.modelValue)
const fileInput = ref(null)
const textareaRef = ref(null)

watch(
  () => props.modelValue,
  (val) => {
    if (val !== text.value) text.value = val
    autoResize()
  }
)
watch(text, (val) => emit('update:modelValue', val))

function autoResize() {
  nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  })
}

function onInput(e) {
  text.value = e.target.value
  autoResize()
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function onSendClick() {
  submit()
}

function submit() {
  const value = text.value.trim()
  if (!value) return
  emit('send', value)
  text.value = ''
  nextTick(() => {
    const el = textareaRef.value
    if (el) {
      el.style.height = 'auto'
    }
    const inputEl = document.querySelector('.jm-sender__input')
    inputEl?.focus()
  })
}

function onAttachClick() {
  fileInput.value?.click()
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  emit('attach', { file })
  // Reset so the same file can be picked again (e.g. after a send failure).
  e.target.value = ''
}
</script>

<template>
  <div class="jm-sender">
    <button
      class="jm-sender__icon-btn"
      type="button"
      :disabled="disabled"
      :title="'发送图片或文件'"
      @click="onAttachClick"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#909399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
      </svg>
    </button>
    <input
      ref="fileInput"
      class="jm-sender__file-input"
      type="file"
      :accept="accept"
      @change="onFileChange"
    />
    <textarea
      ref="textareaRef"
      class="jm-sender__input"
      :placeholder="placeholder"
      :value="text"
      :disabled="disabled"
      rows="1"
      @input="onInput"
      @keydown="onKeydown"
      @focus="emit('focus')"
      @blur="emit('blur')"
    ></textarea>
    <button
      class="jm-sender__btn"
      :disabled="disabled || !text.trim()"
      type="button"
      @click="onSendClick"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.jm-sender {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #F0F2F5;
  background: #FFFFFF;
  flex-shrink: 0;
  border-bottom-left-radius: var(--radius-lg);
  border-bottom-right-radius: var(--radius-lg);
}

.jm-sender__icon-btn {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid #E1E8F0;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.jm-sender__icon-btn:hover:not(:disabled) {
  background: #F8FAFC;
  border-color: #6B95D1;
}

.jm-sender__icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.jm-sender__file-input {
  display: none;
}

.jm-sender__input {
  flex: 1;
  min-height: 48px;
  max-height: 200px;
  background: #FFFFFF;
  border: 1px solid #E1E8F0;
  border-radius: 12px;
  padding: 12px 16px;
  color: #333333;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  outline: none;
  resize: none;
  overflow-y: auto;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.jm-sender__input:focus {
  border-color: #6B95D1;
  box-shadow: 0 0 0 2px rgba(107, 149, 209, 0.15);
}

.jm-sender__input::placeholder {
  color: #B0B7C3;
}

.jm-sender__input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.jm-sender__btn {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: #6B95D1;
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.jm-sender__btn:hover:not(:disabled) {
  background: #5A84BC;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.jm-sender__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
