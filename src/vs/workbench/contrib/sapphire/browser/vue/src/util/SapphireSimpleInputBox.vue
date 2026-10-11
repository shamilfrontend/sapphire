<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onMounted, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import { asCssVariable } from '../../../../../../../platform/theme/common/colorUtils.js';
import {
  inputBackground,
  inputForeground,
} from '../../../../../../../platform/theme/common/colorRegistry.js';

const props = defineProps<{
  value: string;
  placeholder: string;
  disabled?: boolean;
  compact?: boolean;
  passwordBlur?: boolean;
  onChangeValue?: (value: string) => void;
}>();

const emit = defineEmits<{
  changeValue: [value: string];
}>();

// Один DOM input между рендерами (не remount при каждом value из родителя)
const inputRef = ref<HTMLInputElement | null>(null);

// Восстановление selection после programmatic setValue
const selectionRef = ref<{ start: number | null; end: number | null }>({
  start: null,
  end: null,
});

const writeValue = (value: string) => {
  const input = inputRef.value;
  if (!input || input.value === value) return;
  // Запоминаем selectionStart/End
  selectionRef.value.start = input.selectionStart;
  selectionRef.value.end = input.selectionEnd;
  // Новое значение в DOM
  input.value = value;
  // Возвращаем каретку
  if (selectionRef.value.start !== null && selectionRef.value.end !== null) {
    input.setSelectionRange(selectionRef.value.start, selectionRef.value.end);
  }
};

onMounted(() => {
  const input = inputRef.value;
  if (input) input.value = props.value;
});

// Обновление value без remount input
watch(
  () => props.value,
  (value) => {
    writeValue(value);
  },
);

const handleInput = (e: Event) => {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  props.onChangeValue?.(target.value);
  emit('changeValue', target.value);
};

const inputClass = computed(() => {
  // Полный литерал в return — иначе void-префиксер не видит классы (array.join не обрабатывается).
  // p-2 = 8px со всех сторон; дублируем padding в inputStyle на случай сбоя префикса.
  return props.disabled
    ? 'w-full min-h-[32px] appearance-none resize-none rounded-sm border border-void-border-2 bg-void-bg-1 text-void-fg-1 placeholder:text-void-fg-3 transition-colors focus:outline-none focus:border-void-border-1 p-2 opacity-50 cursor-not-allowed'
    : 'w-full min-h-[32px] appearance-none resize-none rounded-sm border border-void-border-2 bg-void-bg-1 text-void-fg-1 placeholder:text-void-fg-3 transition-colors focus:outline-none focus:border-void-border-1 p-2';
});

const inputStyle = computed((): CSSProperties & { WebkitTextSecurity?: 'disc' } => ({
  ...(props.passwordBlur ? { WebkitTextSecurity: 'disc' as const } : {}),
  width: '100%',
  maxWidth: 'none',
  minWidth: 0,
  display: 'block',
  boxSizing: 'border-box',
  padding: '8px',
  background: asCssVariable(inputBackground),
  color: asCssVariable(inputForeground),
}));
</script>

<template>
  <!-- type не задаём: явный type ломает paste в webview VS Code -->
  <input
    ref="inputRef"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="inputClass"
    :style="inputStyle"
    @input="handleInput"
  />
</template>
