<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

const props = defineProps<{
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
}>();

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const onButtonClick = (event: MouseEvent) => {
  props.onClick?.(event);
  emit('click', event);
};
</script>

<template>
  <button
    :disabled="disabled"
    class="px-3 py-1 bg-black/10 dark:bg-white/10 rounded-sm overflow-hidden whitespace-nowrap flex items-center justify-center"
    @click="onButtonClick"
  >
    <slot />
  </button>
</template>
