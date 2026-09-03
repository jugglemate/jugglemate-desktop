<script setup>
import { computed, ref, watch } from 'vue'
import { getStickerAssetUrl, normalizeStickerContent } from '../../common/stickers'

const props = defineProps({ message: { type: Object, required: true } })
const failed = ref(false)
const content = computed(() => normalizeStickerContent(props.message?.content))
const url = computed(() => getStickerAssetUrl(content.value))
watch(url, () => { failed.value = false })
</script>

<template>
  <div class="jm-msg-sticker" :title="content ? '动画表情' : '无效的动画表情'">
    <tgs-player v-if="url && !failed" mode="normal" autoplay loop :src="url" @error="failed = true" />
    <div v-else class="jm-msg-sticker__fallback">表情加载失败</div>
  </div>
</template>

<style scoped>
.jm-msg-sticker { width: 132px; height: 132px; display: grid; place-items: center; overflow: hidden; }
.jm-msg-sticker tgs-player { width: 120px; height: 120px; }
.jm-msg-sticker__fallback { width: 120px; height: 90px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 10px; background: var(--bg-soft); color: var(--text-3); font-size: 12px; }
</style>
