<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { CSSProperties } from 'vue';
import IconSquare from './IconSquare.vue';

const DEFAULT_BUTTON_SIZE = 26;

const props = defineProps<{
  className?: string;
  accentColor?: string;
  style?: CSSProperties;
}>();

const mergedStyle = () => ({
  ...(props.style ?? {}),
  ...(props.accentColor ? { backgroundColor: props.accentColor } : {}),
});
</script>

<template>
  <button
    :class="`rounded-full flex-shrink-0 flex-grow-0 cursor-pointer flex items-center justify-center size-[26px] hover:opacity-90
			${accentColor ? '' : 'bg-void-fg-1'}
			${className}
		`"
    type="button"
    :style="mergedStyle()"
  >
    <IconSquare
      :size="DEFAULT_BUTTON_SIZE"
      :class="`stroke-[3] p-[8px] ${accentColor ? 'text-void-bg-2' : 'text-void-bg-3'}`"
    />
  </button>
</template>
