<script setup>
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

function toggle() {
  if (!props.disabled) {
    emit('update:modelValue', !props.modelValue)
  }
}
</script>

<template>
  <button
    class="tyn-toggle"
    :class="{ 'tyn-toggle--on': modelValue, 'tyn-toggle--disabled': disabled }"
    type="button"
    role="switch"
    :aria-checked="modelValue"
    @click="toggle"
  ></button>
</template>