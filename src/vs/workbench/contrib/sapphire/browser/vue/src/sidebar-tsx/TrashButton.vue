<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ref } from 'vue';
import { Check, Trash2, X } from 'lucide-vue-next';
import IconShell1 from '../markdown/IconShell1.vue';
import { useAccessor } from '../util/services.js';

const props = defineProps<{ threadId: string }>();

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');

const isTrashPressed = ref(false);
</script>

<template>
  <div v-if="isTrashPressed" class="flex flex-nowrap text-nowrap gap-1">
    <IconShell1
      :Icon="X"
      class="size-[11px]"
      @click="isTrashPressed = false"
      data-tooltip-id="sapphire-tooltip"
      data-tooltip-place="top"
      data-tooltip-content="Отмена"
    />
    <IconShell1
      :Icon="Check"
      class="size-[11px]"
      @click="
        chatThreadsService.deleteThread(props.threadId);
        isTrashPressed = false;
      "
      data-tooltip-id="sapphire-tooltip"
      data-tooltip-place="top"
      data-tooltip-content="Подтвердить"
    />
  </div>
  <IconShell1
    v-else
    :Icon="Trash2"
    class="size-[11px]"
    @click="isTrashPressed = true"
    data-tooltip-id="sapphire-tooltip"
    data-tooltip-place="top"
    data-tooltip-content="Удалить чат"
  />
</template>
