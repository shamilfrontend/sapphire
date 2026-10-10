<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import type { ControlSize } from './SapphireControls.js';

const props = withDefaults(
  defineProps<{
    value: boolean;
    disabled?: boolean;
    size?: ControlSize;
    onChange?: (value: boolean) => void;
  }>(),
  {
    size: 'md',
    disabled: false,
  },
);

const emit = defineEmits<{
  change: [value: boolean];
}>();

const toggle = () => {
  if (props.disabled) return;
  const next = !props.value;
  props.onChange?.(next);
  emit('change', next);
};

const trackClass = computed(() => {
  const size = props.size;
  return `
			cursor-pointer
			relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out
			${props.value ? 'bg-zinc-900 dark:bg-white' : 'bg-white dark:bg-zinc-600'}
			${props.disabled ? 'opacity-25' : ''}
			${size === 'xxs' ? 'h-3 w-5' : ''}
			${size === 'xs' ? 'h-4 w-7' : ''}
			${size === 'sm' ? 'h-5 w-9' : ''}
			${size === 'sm+' ? 'h-5 w-10' : ''}
			${size === 'md' ? 'h-6 w-11' : ''}
		  `;
});

const thumbClass = computed(() => {
  const size = props.size;
  const value = props.value;
  return `
			  inline-block transform rounded-full bg-white dark:bg-zinc-900 shadow transition-transform duration-200 ease-in-out
			  ${size === 'xxs' ? 'h-2 w-2' : ''}
			  ${size === 'xs' ? 'h-2.5 w-2.5' : ''}
			  ${size === 'sm' ? 'h-3 w-3' : ''}
			  ${size === 'sm+' ? 'h-3.5 w-3.5' : ''}
			  ${size === 'md' ? 'h-4 w-4' : ''}
			  ${size === 'xxs' ? (value ? 'translate-x-2.5' : 'translate-x-0.5') : ''}
			  ${size === 'xs' ? (value ? 'translate-x-3.5' : 'translate-x-0.5') : ''}
			  ${size === 'sm' ? (value ? 'translate-x-5' : 'translate-x-1') : ''}
			  ${size === 'sm+' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			  ${size === 'md' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			`;
});
</script>

<template>
  <label class="inline-flex items-center">
    <div :class="trackClass" @click="toggle">
      <span :class="thumbClass" />
    </div>
  </label>
</template>
