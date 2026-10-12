<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import type { PlanTodoItem } from '../../../../common/toolsServiceTypes.js';

const props = defineProps<{
  status: PlanTodoItem['status'];
}>();

const checked = computed(() => props.status === 'completed' || props.status === 'cancelled');

const markClass = computed(() => {
  if (checked.value) return 'border-void-fg-3 bg-void-bg-3 text-void-fg-1';
  if (props.status === 'in_progress') return 'border-void-fg-2 bg-void-bg-2 text-void-fg-2';
  return 'border-void-fg-3 bg-transparent';
});

const glyph = computed(() => {
  if (props.status === 'completed') return '✓';
  if (props.status === 'cancelled') return '×';
  if (props.status === 'in_progress') return '●';
  return '';
});
</script>

<template>
  <span
    class="mt-[3px] shrink-0 w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center text-[9px] leading-none"
    :class="markClass"
    aria-hidden="true"
  >
    {{ glyph }}
  </span>
</template>
