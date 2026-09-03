<script setup>
import { computed, ref } from 'vue'
import { composerEmojis, getStickerAssetUrl, stickerPacks } from '../common/stickers'

defineProps({ disabled: { type: Boolean, default: false } })
const emit = defineEmits(['emoji', 'sticker'])
const activeTab = ref('emoji')
const activePack = computed(() => stickerPacks.find((pack) => pack.id === activeTab.value))
</script>

<template>
  <div class="jm-composer-picker" role="dialog" aria-label="选择表情" @mousedown.prevent>
    <div class="jm-composer-picker__tabs" role="tablist">
      <button type="button" :class="{ 'is-active': activeTab === 'emoji' }" @click="activeTab = 'emoji'">😄</button>
      <button
        v-for="pack in stickerPacks"
        :key="pack.id"
        type="button"
        :class="{ 'is-active': activeTab === pack.id }"
        :title="`动画表情 ${pack.id}`"
        @click="activeTab = pack.id"
      >
        <tgs-player mode="normal" autoplay loop :src="getStickerAssetUrl(pack.items[0])" />
      </button>
    </div>

    <div v-if="activeTab === 'emoji'" class="jm-composer-picker__emoji-grid">
      <button v-for="emoji in composerEmojis" :key="emoji" type="button" :disabled="disabled" @click="emit('emoji', emoji)">{{ emoji }}</button>
    </div>
    <div v-else class="jm-composer-picker__sticker-grid">
      <button v-for="item in activePack?.items || []" :key="`${item.path}-${item.name}`" type="button" :disabled="disabled" @click="emit('sticker', item)">
        <tgs-player mode="normal" autoplay loop :src="getStickerAssetUrl(item)" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.jm-composer-picker { position: absolute; left: 0; bottom: calc(100% + 8px); z-index: 40; width: 360px; max-width: calc(100vw - 48px); height: 330px; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); box-shadow: var(--shadow-lg); }
.jm-composer-picker__tabs { display: flex; align-items: center; gap: 3px; padding: 7px 8px; border-bottom: 1px solid var(--border-soft); background: var(--bg-soft); }
.jm-composer-picker__tabs button { width: 36px; height: 34px; display: grid; place-items: center; padding: 3px; border: 0; border-radius: 7px; background: transparent; font-size: 20px; cursor: pointer; }
.jm-composer-picker__tabs button.is-active { background: var(--primary-soft); box-shadow: inset 0 -2px var(--primary); }
.jm-composer-picker__tabs tgs-player { width: 28px; height: 28px; }
.jm-composer-picker__emoji-grid, .jm-composer-picker__sticker-grid { flex: 1; overflow-y: auto; display: grid; align-content: start; padding: 10px; }
.jm-composer-picker__emoji-grid { grid-template-columns: repeat(9, 1fr); gap: 3px; }
.jm-composer-picker__sticker-grid { grid-template-columns: repeat(4, 1fr); gap: 5px; }
.jm-composer-picker__emoji-grid button, .jm-composer-picker__sticker-grid button { display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
.jm-composer-picker__emoji-grid button { height: 34px; font-size: 22px; }
.jm-composer-picker__sticker-grid button { min-height: 72px; }
.jm-composer-picker__emoji-grid button:hover, .jm-composer-picker__sticker-grid button:hover { background: var(--bg-mute); }
.jm-composer-picker__sticker-grid tgs-player { width: 68px; height: 68px; }
</style>
