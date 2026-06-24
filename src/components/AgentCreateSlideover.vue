<script setup>
import { ref, reactive } from 'vue'
import Slideover from './Slideover.vue'
import Toggle from './Toggle.vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'create'])

const form = reactive({
  name: '',
  desc: '',
  style: '亲切活泼',
  platforms: ['douyin', 'xhs'],
  takeoverEnabled: true,
  temperature: 0.7,
  maxLength: 200
})

const styles = ['亲切活泼', '专业正式', '简洁直接', '自定义 Prompt']
const platformOptions = [
  { key: 'douyin', label: '🎵 抖音' },
  { key: 'xhs', label: '📕 小红书' },
  { key: 'tg', label: '✈️ Telegram' }
]

function togglePlatform(key) {
  const idx = form.platforms.indexOf(key)
  if (idx > -1) {
    form.platforms.splice(idx, 1)
  } else {
    form.platforms.push(key)
  }
}

function isPlatformChecked(key) {
  return form.platforms.includes(key)
}

function handleCreate() {
  emit('create', { ...form })
  resetForm()
  emit('close')
}

function handleClose() {
  resetForm()
  emit('close')
}

function resetForm() {
  form.name = ''
  form.desc = ''
  form.style = '亲切活泼'
  form.platforms = ['douyin', 'xhs']
  form.takeoverEnabled = true
  form.temperature = 0.7
  form.maxLength = 200
}
</script>

<template>
  <Slideover :show="show" title="创建新 Agent" @close="handleClose">
    <div class="tyn-form-group">
      <label class="tyn-form-label">Agent 名称</label>
      <input
        v-model="form.name"
        class="tyn-input"
        type="text"
        placeholder="例如：客服助手、商务谈判官"
        style="padding-left: 12px;"
      />
    </div>

    <div class="tyn-form-group">
      <label class="tyn-form-label">角色描述</label>
      <textarea
        v-model="form.desc"
        class="tyn-textarea"
        placeholder="一句话描述 Agent 的身份和职责..."
        style="padding-left: 12px;"
      ></textarea>
      <div class="tyn-form-hint">例如：你是美妆品牌的小红书客服，语气亲切活泼，熟悉产品手册和促销信息</div>
    </div>

    <div class="tyn-form-group">
      <label class="tyn-form-label">回复风格</label>
      <select v-model="form.style" class="tyn-select">
        <option v-for="s in styles" :key="s" :value="s">{{ s }}</option>
      </select>
    </div>

    <div class="tyn-form-group">
      <label class="tyn-form-label">知识库</label>
      <div class="tyn-upload-zone" @click="$emit('upload')">
        📎 拖拽文件至此或点击上传
        <div style="font-size: 11px; margin-top: 4px;">支持 PDF、Word、TXT、网页链接</div>
      </div>
    </div>

    <div class="tyn-form-group">
      <label class="tyn-form-label">适用平台</label>
      <div class="tyn-platform-checks">
        <div
          v-for="p in platformOptions"
          :key="p.key"
          class="tyn-platform-check"
          :class="{ checked: isPlatformChecked(p.key) }"
          @click="togglePlatform(p.key)"
        >
          {{ p.label }}
        </div>
      </div>
    </div>

    <div class="tyn-form-group">
      <div class="tyn-toggle-row">
        <div>
          <div class="tyn-toggle-label">接管权限</div>
          <div class="tyn-toggle-desc">允许此 Agent 自动接管会话回复</div>
        </div>
        <Toggle v-model="form.takeoverEnabled" />
      </div>
    </div>

    <div class="tyn-form-group">
      <label class="tyn-form-label">温度参数: {{ form.temperature }}</label>
      <div class="tyn-range-group">
        <input
          v-model="form.temperature"
          type="range"
          class="tyn-range-slider"
          min="0"
          max="1"
          step="0.1"
        />
      </div>
      <div class="tyn-form-hint">越高回复越有创造性，越低越保守确定</div>
    </div>

    <div class="tyn-form-group">
      <label class="tyn-form-label">最大回复长度</label>
      <input
        v-model="form.maxLength"
        class="tyn-input"
        type="number"
        placeholder="字数上限"
        style="padding-left: 12px;"
      />
    </div>

    <template #footer>
      <button class="tyn-btn tyn-btn--outline" @click="handleClose">取消</button>
      <button class="tyn-btn tyn-btn--primary" @click="handleCreate">创建 Agent</button>
    </template>
  </Slideover>
</template>