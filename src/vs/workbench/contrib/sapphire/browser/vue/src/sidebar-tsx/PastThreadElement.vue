<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { LoaderCircle, MessageCircleQuestion } from 'lucide-vue-next';
import { useAccessor, useFullChatThreadsStreamState } from '../util/services.js';
import { IsRunningType, ThreadType } from '../../../chatThreadService.js';
import DuplicateButton from './DuplicateButton.vue';
import TrashButton from './TrashButton.vue';

const props = withDefaults(
  defineProps<{
    pastThread: ThreadType;
    idx: number;
    hoveredIdx: number | null;
    setHoveredIdx: (idx: number | null) => void;
    isRunning: IsRunningType | undefined;
    isCurrent?: boolean;
    onThreadClick?: () => void;
  }>(),
  { isCurrent: false },
);

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');
const streamState = useFullChatThreadsStreamState();

// «Сегодня» / «Вчера» или дата
const formatDate = (date: Date) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date >= today) {
    return 'Сегодня';
  }
  if (date >= yesterday) {
    return 'Вчера';
  }
  return `${date.toLocaleString('ru-RU', { month: 'short' })} ${date.getDate()}`;
};

const firstMsg = computed(() => {
  let message = '';
  const messages = props.pastThread.messages ?? [];
  const firstUserMsgIdx = messages.findIndex((msg) => msg.role === 'user');
  if (firstUserMsgIdx !== -1) {
    const firsUsertMsgObj = messages[firstUserMsgIdx];
    message = (firsUsertMsgObj.role === 'user' && firsUsertMsgObj.displayContent) || '';
  } else {
    message = '""';
  }
  return message;
});

const numMessages = computed(
  () =>
    (props.pastThread.messages ?? []).filter(
      (msg) => msg.role === 'assistant' || msg.role === 'user',
    ).length,
);

const showSpinner = computed(() => {
  void streamState.value;
  return (
    props.isRunning === 'LLM' ||
    props.isRunning === 'tool' ||
    props.isRunning === 'preparing' ||
    (props.isRunning === 'idle' &&
      chatThreadsService.streamState[props.pastThread.id]?.interrupt !== 'not_needed')
  );
});
</script>

<template>
  <div
    :class="`
			py-1 px-2 rounded text-sm cursor-pointer
			${
        isCurrent
          ? 'bg-void-bg-2-alt opacity-100'
          : 'bg-void-bg-2-hover hover:bg-void-bg-2-alt opacity-80 hover:opacity-100'
      }
		`"
    @click="
      chatThreadsService.openTab(pastThread.id);
      onThreadClick?.();
    "
    @mouseenter="setHoveredIdx(idx)"
    @mouseleave="setHoveredIdx(null)"
  >
    <div class="flex items-center justify-between gap-1">
      <span class="flex items-center gap-2 min-w-0 overflow-hidden">
        <!-- Спиннер: preparing / LLM / tool / idle с interrupt -->
        <LoaderCircle
          v-if="showSpinner"
          class="animate-spin bg-void-stroke-1 flex-shrink-0 flex-grow-0"
          :size="14"
        />
        <MessageCircleQuestion
          v-else-if="isRunning === 'awaiting_user'"
          class="bg-void-stroke-1 flex-shrink-0 flex-grow-0"
          :size="14"
        />
        <!-- Превью первого сообщения -->
        <span class="truncate overflow-hidden text-ellipsis">
          {{ firstMsg }}
        </span>

        <!-- <span class='opacity-60'>{`(${numMessages})`}</span> -->
      </span>

      <div class="flex items-center gap-x-1 opacity-60">
        <template v-if="idx === hoveredIdx">
          <!-- Дублировать -->
          <DuplicateButton :threadId="pastThread.id" />

          <!-- Действия при hover -->
          <TrashButton :threadId="pastThread.id" />
        </template>
        <span v-else>
          <!--
            data-tooltip-id='sapphire-tooltip'
            data-tooltip-content={`Изменён ${formatTime(new Date(pastThread.lastModified))}`}
            data-tooltip-place='top'
          -->
          <span class="opacity-60">{{ numMessages }}</span>
          {{ ' ' }}
          {{ formatDate(new Date(pastThread.lastModified)) }}
          <!-- число сообщений -->
        </span>
      </div>
    </div>
  </div>
</template>
