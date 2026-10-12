<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { PlanTodoItem } from '../../../../common/toolsServiceTypes.js';
import TodoMark from './TodoMark.vue';

defineProps<{
  todos: PlanTodoItem[];
}>();

const contentClass = (status: PlanTodoItem['status']) => {
  if (status === 'cancelled') return 'line-through text-void-fg-3';
  if (status === 'completed') return 'text-void-fg-2';
  return 'text-void-fg-1';
};
</script>

<template>
  <div v-if="todos.length" class="my-4">
    <div class="text-[13px] font-bold text-void-fg-1 mb-2">Todos</div>
    <ul class="flex flex-col gap-1.5 m-0 p-0 list-none">
      <li v-for="t in todos" :key="t.id" class="flex items-start gap-2 text-[13px] leading-snug">
        <TodoMark :status="t.status" />
        <span :class="contentClass(t.status)">
          {{ t.content }}
          <span v-if="t.status === 'in_progress'" class="text-void-fg-3"> · в работе</span>
        </span>
      </li>
    </ul>
  </div>
</template>
