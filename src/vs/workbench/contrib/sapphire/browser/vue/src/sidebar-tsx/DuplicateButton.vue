<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Copy } from 'lucide-vue-next';
import IconShell1 from '../markdown/IconShell1.vue';
import { useAccessor } from '../util/services.js';

const props = defineProps<{ threadId: string }>();

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');
</script>

<template>
  <IconShell1
    :Icon="Copy"
    class="size-[11px]"
    @click="chatThreadsService.duplicateThread(props.threadId)"
    data-tooltip-id="sapphire-tooltip"
    data-tooltip-place="top"
    data-tooltip-content="Дублировать чат"
  />
</template>
