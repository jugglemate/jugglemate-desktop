<script setup>
// Message input row. Three responsibilities:
//   1. Capture the draft text (so the parent can persist it as a draft)
//   2. Enter-to-send, Shift-Enter for newline
//   3. Expose attachment pickers and clipboard image paste that emit
//      `attach` with the File object. The parent decides whether to call
//      juggle.sendImageMessage / sendFileMessage / sendVideoMessage based
//      on the file's mime type.
//
// In P1 we keep the picker simple — one button with a `accept` attribute
// that defaults to "image/*". The parent can re-emit `attach` from a more
// specific picker (e.g. a "file" button) in a later phase. The picker's
// value is reset after each emit so the same file can be re-selected.

import { ref, watch, nextTick } from 'vue'
import im from '../common/im'
import { TRANSLATION_LANGUAGES } from '../services/translation-settings'
import { translateText } from '../services/message-translation'

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
  // 只挡"发送"动作（发送按钮 + 回车），不影响 textarea 输入。
  // 用于未认领工单场景：让用户能继续敲字触发认领提示，但不许真的发出去。
  sendDisabled: {
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
  },
  translationEnabled: { type: Boolean, default: false },
  defaultTargetLang: { type: String, default: 'zh-CN' }
})

const emit = defineEmits(['update:modelValue', 'send', 'attach', 'focus', 'blur'])

const text = ref(props.modelValue)
const fileInput = ref(null)
const textareaRef = ref(null)
const targetLang = ref(props.defaultTargetLang)
const translationPreview = ref('')
const translationLoading = ref(false)
const translationError = ref('')
let translationRequestId = 0

watch(
  () => props.modelValue,
  (val) => {
    if (val !== text.value) text.value = val
    if (!val) clearTranslationState()
    autoResize()
  }
)
watch(text, (val) => emit('update:modelValue', val))
watch(() => props.defaultTargetLang, (value) => {
  targetLang.value = value || 'zh-CN'
  clearTranslationState()
})

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
  clearTranslationState()
  autoResize()
}

async function onTranslateClick() {
  const source = text.value.trim()
  if (!source || translationLoading.value) return
  const requestId = ++translationRequestId
  const requestedLang = targetLang.value
  translationLoading.value = true
  translationPreview.value = ''
  translationError.value = ''
  try {
    const translated = await translateText(source, requestedLang, {
      client: im.getCurrent()
    })
    if (requestId !== translationRequestId || text.value.trim() !== source || targetLang.value !== requestedLang) return
    translationPreview.value = translated
  } catch (error) {
    if (requestId !== translationRequestId) return
    translationError.value = error?.msg || error?.message || '翻译失败'
  } finally {
    if (requestId === translationRequestId) translationLoading.value = false
  }
}

function useTranslation() {
  if (!translationPreview.value) return
  text.value = translationPreview.value
  translationPreview.value = ''
  translationError.value = ''
  autoResize()
  nextTick(() => textareaRef.value?.focus())
}

function cancelTranslation() {
  clearTranslationState()
}

function clearTranslationState() {
  translationRequestId += 1
  translationPreview.value = ''
  translationError.value = ''
  translationLoading.value = false
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
  if (props.sendDisabled) {
    // 仅阻断"发送"，textarea 仍然可输入；调用方根据 state 决定后续行为。
    return
  }
  const value = text.value.trim()
  if (!value) return
  emit('send', value)
  text.value = ''
  clearTranslationState()
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
// 工具栏占位 —— 仅 attach 真正触发文件选择，其他先打 noop 等待后续接入
function onEmojiClick() { /* TODO: emoji picker */ }
function onImageClick() { onAttachClick() }
function onVoiceClick() { /* TODO: voice input */ }
function onQuickReplyClick() { /* TODO: quick replies */ }

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  emit('attach', { file })
  // Reset so the same file can be picked again (e.g. after a send failure).
  e.target.value = ''
}

function onPaste(e) {
  if (props.disabled) return
  const imageFiles = Array.from(e.clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && item.type.toLowerCase().startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)

  // Keep ordinary text paste untouched. Clipboard screenshots/images are
  // consumed here and immediately reuse ChatMain's normal image upload path.
  if (imageFiles.length === 0) return
  e.preventDefault()
  for (const file of imageFiles) emit('attach', { file })
}
</script>

<template>
  <div class="jm-sender">
    <div class="jm-sender__input-wrap">
      <div v-if="translationEnabled && (translationLoading || translationPreview || translationError)" class="jm-sender__translation-preview">
        <div v-if="translationLoading" class="jm-sender__translation-loading">翻译中...</div>
        <template v-else-if="translationPreview">
          <div class="jm-sender__translation-text"><span>译</span>{{ translationPreview }}</div>
          <div class="jm-sender__translation-actions">
            <button type="button" @click="useTranslation">使用译文</button>
            <button type="button" class="is-secondary" @click="cancelTranslation">取消</button>
          </div>
        </template>
        <div v-else class="jm-sender__translation-error">
          {{ translationError }}
          <button type="button" @click="onTranslateClick">重试</button>
        </div>
      </div>
      <textarea
        ref="textareaRef"
        class="jm-sender__input"
        :placeholder="placeholder"
        :value="text"
        :disabled="disabled"
        rows="1"
        @input="onInput"
        @keydown="onKeydown"
        @paste="onPaste"
        @focus="emit('focus')"
        @blur="emit('blur')"
      ></textarea>
      <div class="jm-sender__bar">
        <div class="jm-sender__tools">
          <!-- <button
            class="jm-sender__tool-btn"
            type="button"
            :disabled="disabled"
            title="表情"
            @click="onEmojiClick"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </button> -->
          <button
            class="jm-sender__tool-btn"
            type="button"
            :disabled="disabled"
            title="发送图片或文件"
            @click="onAttachClick"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.4 11-9.2 9.2a5 5 0 1 1-7-7L13.5 4.5a3.5 3.5 0 0 1 5 5L9.7 18.3a2 2 0 1 1-2.8-2.8l8.5-8.5"/></svg>
          </button>
          <button
            class="jm-sender__tool-btn"
            type="button"
            :disabled="disabled"
            title="图片"
            @click="onImageClick"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
          </button>
        </div>
        <input
          ref="fileInput"
          class="jm-sender__file-input"
          type="file"
          :accept="accept"
          @change="onFileChange"
        />
        <div class="jm-sender__actions">
          <select v-if="translationEnabled" v-model="targetLang" class="jm-sender__language" title="翻译目标语言">
            <option v-for="language in TRANSLATION_LANGUAGES" :key="language.value" :value="language.value">{{ language.label }}</option>
          </select>
          <button
            v-if="translationEnabled"
            class="jm-sender__translate"
            :disabled="disabled || !text.trim() || translationLoading"
            type="button"
            @click="onTranslateClick"
          >{{ translationLoading ? '翻译中' : '翻译' }}</button>
          <button
            class="jm-sender__send"
            :disabled="disabled || sendDisabled || !text.trim()"
            type="button"
            @click="onSendClick"
          >发送</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 对齐 aichat-agent-console.html 中 .composer 设计稿
   容器 10/20/14 上下内边距 + 白底 + 无圆角无顶边（容器）*/
.jm-sender {
  padding: 10px 20px 14px;
  background: var(--bg);
  flex-shrink: 0;
}

/* 输入框外层 —— 边框、圆角、聚焦态主色边框、bg-soft 底 */
.jm-sender__input-wrap {
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-soft);
  transition: var(--t-fast);
}

.jm-sender__input-wrap:focus-within {
  border-color: var(--primary);
  background: #fff;
}

/* textarea 自身 —— 透明，撑开父容器宽度 */
.jm-sender__input {
  width: 100%;
  border: 0;
  background: transparent;
  font-size: 14px;
  line-height: 1.5;
  min-height: 24px;
  max-height: 120px;
  resize: none;
  color: var(--text-1);
  padding: 4px 6px;
  font-family: inherit;
  outline: none;
}

.jm-sender__input::placeholder {
  color: var(--text-3);
}

.jm-sender__input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 工具栏 + 发送 所在行 */
.jm-sender__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2px;
}

.jm-sender__tools {
  display: flex;
  gap: 2px;
}
.jm-sender__actions { display: flex; align-items: center; gap: 6px; }
.jm-sender__language { max-width: 120px; height: 30px; padding: 0 7px; border: 1px solid var(--border); border-radius: 7px; background: #fff; color: var(--text-2); font: inherit; font-size: 12px; outline: none; }
.jm-sender__translate { height: 30px; padding: 0 12px; border: 1px solid #BFDBFE; border-radius: 7px; background: #EFF6FF; color: #2563EB; font: inherit; font-size: 12px; cursor: pointer; }
.jm-sender__translate:disabled { opacity: .45; cursor: not-allowed; }
.jm-sender__translation-preview { margin: 0 2px 4px; padding: 9px 10px; border: 1px solid #DBEAFE; border-radius: 8px; background: #F8FBFF; font-size: 13px; }
.jm-sender__translation-loading { color: var(--text-3); }
.jm-sender__translation-text { display: flex; gap: 7px; white-space: pre-wrap; word-break: break-word; color: var(--text-1); }
.jm-sender__translation-text span { flex: 0 0 auto; width: 18px; height: 18px; border-radius: 4px; background: #EAF2FF; color: #2563EB; font-size: 10px; font-weight: 600; line-height: 18px; text-align: center; }
.jm-sender__translation-actions { display: flex; gap: 8px; margin-top: 8px; }
.jm-sender__translation-actions button, .jm-sender__translation-error button { padding: 3px 8px; border: 0; border-radius: 5px; background: #2563EB; color: #fff; font: inherit; font-size: 11px; cursor: pointer; }
.jm-sender__translation-actions .is-secondary { background: transparent; color: var(--text-3); }
.jm-sender__translation-error { display: flex; align-items: center; gap: 8px; color: #DC2626; }

.jm-sender__tool-btn {
  width: 28px;
  height: 28px;
  color: var(--text-3);
  border-radius: 6px;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: var(--t-fast);
}

.jm-sender__tool-btn:hover:not(:disabled) {
  background: var(--bg-mute);
  color: var(--text-1);
}

.jm-sender__tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.jm-sender__tool-btn svg {
  width: 15px;
  height: 15px;
}

.jm-sender__file-input {
  display: none;
}

/* 发送按钮 —— 文字胶囊，对齐设计稿 */
.jm-sender__send {
  padding: 6px 18px;
  background: var(--primary);
  color: #fff;
  border: 0;
  border-radius: var(--r);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: var(--t-fast);
}

.jm-sender__send:hover:not(:disabled) {
  background: var(--primary-hover);
}

.jm-sender__send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
