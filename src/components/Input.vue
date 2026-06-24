<script setup>
import { ref } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: ''
  },
  type: {
    type: String,
    default: 'text'
  },
  placeholder: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  error: {
    type: Boolean,
    default: false
  },
  icon: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:modelValue', 'blur', 'focus'])

const showPassword = ref(false)

function getInputType() {
  if (props.type === 'password') {
    return showPassword.value ? 'text' : 'password'
  }
  return props.type
}

function togglePassword() {
  showPassword.value = !showPassword.value
}

function onInput(e) {
  emit('update:modelValue', e.target.value)
}
</script>

<template>
  <div class="tyn-input-wrapper" :class="{ 'tyn-input-wrapper--error': error }">
    <span v-if="icon" class="tyn-input-icon">{{ icon }}</span>
    <input
      class="tyn-input"
      :type="getInputType()"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="onInput"
      @blur="$emit('blur', $event)"
      @focus="$emit('focus', $event)"
    />
    <button
      v-if="type === 'password'"
      type="button"
      class="tyn-input-toggle"
      @click="togglePassword"
    >
      {{ showPassword ? '🙈' : '👁' }}
    </button>
  </div>
</template>