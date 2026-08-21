<script setup>
import { computed } from 'vue'
import { isElectron } from '../../common/platform'
import { TRANSLATION_STATUS } from '../../services/message-translation'

const props = defineProps({
  message: { type: Object, required: true },
  visible: { type: Boolean, default: true }
})

const emit = defineEmits(['retry'])
const translation = computed(() => props.message?.translation || null)
const shouldShow = computed(() => isElectron() && props.visible && !!translation.value)
const isPending = computed(() => translation.value?.status === TRANSLATION_STATUS.PENDING)
const isCompleted = computed(() => translation.value?.status === TRANSLATION_STATUS.COMPLETED)
const isError = computed(() => [TRANSLATION_STATUS.FAILED, TRANSLATION_STATUS.TIMEOUT].includes(translation.value?.status))
const errorLabel = computed(() => translation.value?.status === TRANSLATION_STATUS.TIMEOUT ? '翻译超时' : '翻译失败')
</script>

<template>
  <div v-if="shouldShow" class="jm-translation">
    <div class="jm-translation__divider"></div>
    <div v-if="isPending" class="jm-translation__state">
      <span class="jm-translation__spinner"></span>翻译中...
    </div>
    <div v-else-if="isCompleted" class="jm-translation__result">
      <span class="jm-translation__badge">译</span>
      <span>{{ translation.translatedText }}</span>
      <button type="button" class="jm-translation__hide" @click.stop="message.translationVisible = false">隐藏译文</button>
    </div>
    <button v-else-if="isError" type="button" class="jm-translation__retry" @click.stop="emit('retry', message)">
      {{ errorLabel }}，点击重试
    </button>
  </div>
</template>

<style scoped>
.jm-translation { margin-top: 8px; font-size: 13px; line-height: 1.55; }
.jm-translation__divider { margin-bottom: 8px; border-top: 1px dashed currentColor; opacity: .22; }
.jm-translation__state { display: flex; align-items: center; gap: 7px; opacity: .68; }
.jm-translation__spinner { width: 12px; height: 12px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: translation-spin .7s linear infinite; }
.jm-translation__result { position: relative; display: flex; align-items: flex-start; gap: 7px; padding-right: 4px; white-space: pre-wrap; word-break: break-word; }
.jm-translation__badge { flex: 0 0 auto; min-width: 18px; height: 18px; padding: 0 3px; border-radius: 4px; background: #EAF2FF; color: #2563EB; font-size: 10px; font-weight: 600; line-height: 18px; text-align: center; }
.jm-translation__retry { padding: 0; border: 0; background: transparent; color: #DC2626; font: inherit; cursor: pointer; }
.jm-translation__hide { display: none; flex: 0 0 auto; margin-left: auto; padding: 0; border: 0; background: transparent; color: currentColor; font: inherit; font-size: 10px; opacity: .55; cursor: pointer; }
.jm-translation__result:hover .jm-translation__hide { display: inline; }
@keyframes translation-spin { to { transform: rotate(360deg); } }
</style>
