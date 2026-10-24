<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { useAccessor, useChatThreadsStreamState, useFullChatThreadsStreamState } from '../util/services.js';
import { CheckpointEntry } from '../../../../common/chatThreadServiceTypes.js';

const props = defineProps<{
  message: CheckpointEntry;
  threadId: string;
  messageIdx: number;
  isCheckpointGhost: boolean;
  threadIsRunning: boolean;
}>();

const accessor = useAccessor();
const chatThreadService = accessor.get('IChatThreadService');
const streamState = useFullChatThreadsStreamState();
const threadStream = useChatThreadsStreamState(() => props.threadId);

const isRunning = computed(() => threadStream.value?.isRunning);
const isDisabled = computed(() => {
  if (isRunning.value) return true;
  return !!Object.keys(streamState.value).find((threadId2) => streamState.value[threadId2]?.isRunning);
});

const onClick = () => {
  if (props.threadIsRunning) return;
  if (isDisabled.value) return;
  chatThreadService.jumpToCheckpointBeforeMessageIdx({
    threadId: props.threadId,
    messageIdx: props.messageIdx,
    jumpToUserModified:
      props.messageIdx ===
        (chatThreadService.state.allThreads[props.threadId]?.messages?.length ?? 0) - 1,
  });
};
</script>

<template>
  <div
    class="group flex items-center justify-center px-2 h-3"
    :class="isDisabled ? 'cursor-default' : 'cursor-pointer'"
    :data-tooltip-id="isDisabled ? 'sapphire-tooltip' : undefined"
    :data-tooltip-content="
      isDisabled
        ? `Недоступно ${isRunning ? 'во время выполнения' : 'пока выполняется другой чат'}`
        : undefined
    "
    :data-tooltip-place="isDisabled ? 'top' : undefined"
    @click="onClick"
  >
    <span
      class="text-xs text-void-fg-4 select-none opacity-0"
      :class="isCheckpointGhost ? 'group-hover:opacity-50' : 'group-hover:opacity-100'"
    >
      Восстановить
    </span>
  </div>
</template>
