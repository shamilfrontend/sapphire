<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Check } from 'lucide-vue-next';
import { acceptAllBg, buttonFontSize, buttonTextColor } from '../../../../common/helpers/colors.js';

defineProps<{
  text: string;
}>();

const buttonStyle = {
  backgroundColor: acceptAllBg,
  color: buttonTextColor,
  border: 'none',
  fontSize: buttonFontSize,
};
</script>

<template>
  <button
    type="button"
    class="px-2 py-0.5 flex items-center gap-1 text-white text-[11px] text-nowrap h-full rounded-sm cursor-pointer hover:opacity-90"
    :style="buttonStyle"
  >
    <span v-if="text">{{ text }}</span>
    <Check v-else :size="16" />
  </button>
</template>
