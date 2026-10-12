<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import type { IndicatorColor } from './ApplyBlockHoverButtons.js';

const props = defineProps<{
  indicatorColor: IndicatorColor;
  title?: string;
}>();

const dotClass = computed(() => {
  const indicatorColor = props.indicatorColor;
  return ` size-1.5 rounded-full border
					${
            indicatorColor === 'dark'
              ? 'bg-[rgba(0,0,0,0)] border-void-border-1'
              : indicatorColor === 'orange'
                ? 'bg-orange-500 border-orange-500 shadow-[0_0_4px_0px_rgba(234,88,12,0.6)]'
                : indicatorColor === 'green'
                  ? 'bg-green-500 border-green-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]'
                  : indicatorColor === 'yellow'
                    ? 'bg-yellow-500 border-yellow-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]'
                    : 'bg-void-border-1 border-void-border-1'
          }
				`;
});
</script>

<template>
  <div class="flex flex-row text-void-fg-3 text-xs items-center gap-1.5">
    <span v-if="title" class="opacity-80">{{ title }}</span>
    <div :class="dotClass" />
  </div>
</template>
