<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { CSSProperties } from 'vue';
import IconArrowUp from './IconArrowUp.vue';

const DEFAULT_BUTTON_SIZE = 26;

const props = defineProps<{
  className?: string;
  disabled: boolean;
  accentColor?: string;
  style?: CSSProperties;
}>();

const mergedStyle = () => ({
  ...(props.style ?? {}),
  ...(!props.disabled && props.accentColor ? { backgroundColor: props.accentColor } : {}),
});
</script>

<template>
  <button
    type="button"
    :class="`rounded-full flex-shrink-0 flex-grow-0 flex items-center justify-center size-[26px]
			${disabled ? 'bg-vscode-disabled-fg cursor-default' : accentColor ? 'cursor-pointer hover:opacity-90' : 'bg-void-fg-1 cursor-pointer hover:opacity-90'}
			${className}
		`"
    :disabled="disabled"
    :style="mergedStyle()"
  >
    <!--
      data-tooltip-id='sapphire-tooltip'
      data-tooltip-content={'Отправить'}
      data-tooltip-place='left'
    -->
    <IconArrowUp
      :size="DEFAULT_BUTTON_SIZE"
      :class="`stroke-[2] p-[5px] ${disabled ? 'text-void-bg-2' : accentColor ? 'text-void-bg-2' : 'text-void-bg-3'}`"
    />
  </button>
</template>
