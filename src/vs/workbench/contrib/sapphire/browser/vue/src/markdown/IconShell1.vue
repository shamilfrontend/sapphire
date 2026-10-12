<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, useAttrs } from 'vue';
import type { LucideIcon } from 'lucide-vue-next';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  Icon: LucideIcon;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const attrs = useAttrs();

const passthrough = computed(() => {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class' || key === 'onClick') continue;
    rest[key] = value;
  }
  return rest;
});

const onButtonClick = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  emit('click', event);
};
</script>

<template>
  <button
    v-bind="passthrough"
    :disabled="disabled"
    :class="[
      `size-[18px]
		p-[2px]
		flex items-center justify-center
		text-sm text-void-fg-3
		hover:brightness-110
		disabled:opacity-50 disabled:cursor-not-allowed`,
      attrs.class,
    ]"
    @click="onButtonClick"
  >
    <component :is="props.Icon" />
  </button>
</template>
