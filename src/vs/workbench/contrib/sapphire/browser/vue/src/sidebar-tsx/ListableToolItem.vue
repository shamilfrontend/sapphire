<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { VNodeChild } from 'vue';

defineProps<{
  name: VNodeChild;
  onClick?: () => void;
  isSmall?: boolean;
  showDot?: boolean;
}>();
</script>

<template>
  <div
    :class="`
			${onClick ? 'hover:brightness-125 hover:cursor-pointer transition-all duration-200 ' : ''}
			flex items-center flex-nowrap whitespace-nowrap
			`"
    @click="onClick?.()"
  >
    <div v-if="showDot !== false" class="flex-shrink-0">
      <svg class="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40">
        <rect x="0" y="15" width="100" height="10" />
      </svg>
    </div>
    <div :class="`${isSmall ? 'italic text-void-fg-4 flex items-center' : ''}`">
      {{ name }}
    </div>
  </div>
</template>
