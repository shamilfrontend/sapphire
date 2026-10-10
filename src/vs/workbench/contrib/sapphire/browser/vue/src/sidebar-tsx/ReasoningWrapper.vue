<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ref } from 'vue';
import IconLoading from './IconLoading.vue';
import ToolChildrenWrapper from './ToolChildrenWrapper.vue';
import ToolHeaderWrapper from './ToolHeaderWrapper.vue';

defineProps<{
  isDoneReasoning: boolean;
  isStreaming: boolean;
}>();

// по умолчанию свёрнуто — пользователь раскрывает цепочку рассуждений
const isOpen = ref(false);
</script>

<template>
  <ToolHeaderWrapper title="Рассуждение" :desc1="isStreaming && !isDoneReasoning ? undefined : ''" :isOpen="isOpen" :onClick="() => { isOpen = !isOpen; }">
    <template v-if="isStreaming && !isDoneReasoning" #desc1>
      <IconLoading />
    </template>
    <ToolChildrenWrapper>
      <div class="!select-text cursor-auto">
        <slot />
      </div>
    </ToolChildrenWrapper>
  </ToolHeaderWrapper>
</template>
