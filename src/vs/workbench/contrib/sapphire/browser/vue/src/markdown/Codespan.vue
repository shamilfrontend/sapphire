<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

defineProps<{
  text: string;
  extraClass?: string;
  tooltip?: string;
  onClick?: () => void;
}>();
</script>

<template>
  <code
    :class="`font-mono font-medium rounded-sm bg-void-bg-1 px-1 ${extraClass ?? ''}`"
    :data-tooltip-id="tooltip ? 'sapphire-tooltip' : undefined"
    :data-tooltip-content="tooltip || undefined"
    :data-tooltip-place="tooltip ? 'top' : undefined"
    @click="onClick?.()"
  >
    {{ text }}
  </code>
</template>
