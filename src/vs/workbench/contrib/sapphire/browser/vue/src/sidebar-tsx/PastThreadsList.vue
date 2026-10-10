<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref } from 'vue';
import { useChatThreadsState, useFullChatThreadsStreamState } from '../util/services.js';
import { IsRunningType } from '../../../chatThreadService.js';
import PastThreadElement from './PastThreadElement.vue';

const numInitialThreads = 3;

const props = withDefaults(
  defineProps<{
    className?: string;
    onThreadClick?: () => void;
    /** Фильтр: без учёта регистра по первому user-сообщению. */
    filterText?: string;
    showAllByDefault?: boolean;
    highlightCurrent?: boolean;
  }>(),
  {
    className: '',
    filterText: '',
    showAllByDefault: false,
    highlightCurrent: false,
  },
);

const showAll = ref(props.showAllByDefault);
const hoveredIdx = ref<number | null>(null);

const threadsState = useChatThreadsState();
const streamState = useFullChatThreadsStreamState();

const runningThreadIds = computed(() => {
  const map: { [threadId: string]: IsRunningType | undefined } = {};
  const state = streamState.value;
  for (const threadId in state) {
    const isRunning = state[threadId]?.isRunning;
    if (isRunning) {
      map[threadId] = isRunning;
    }
  }
  return map;
});

const allThreads = computed(() => threadsState.value.allThreads);

const query = computed(() => props.filterText.trim().toLowerCase());

// сначала недавно изменённые треды
const sortedThreadIds = computed(() => {
  const threads = allThreads.value;
  if (!threads) return [];
  return Object.keys(threads ?? {})
    .sort((threadId1, threadId2) =>
      (threads[threadId1]?.lastModified ?? 0) > (threads[threadId2]?.lastModified ?? 0) ? -1 : 1,
    )
    .filter((threadId) => (threads[threadId]?.messages.length ?? 0) !== 0)
    .filter((threadId) => {
      if (!query.value) return true;
      const thread = threads[threadId];
      const firstUser = thread?.messages.find((msg) => msg.role === 'user');
      const text = firstUser && firstUser.role === 'user' ? (firstUser.displayContent ?? '') : '';
      return text.toLowerCase().includes(query.value);
    });
});

// по умолчанию показываем только первые N тредов
const hasMoreThreads = computed(() => sortedThreadIds.value.length > numInitialThreads);
const displayThreads = computed(() =>
  showAll.value ? sortedThreadIds.value : sortedThreadIds.value.slice(0, numInitialThreads),
);

const setHoveredIdx = (idx: number | null) => {
  hoveredIdx.value = idx;
};
</script>

<template>
  <div v-if="!allThreads" key="error" class="p-1">Ошибка доступа к истории чатов.</div>
  <div
    v-else
    :class="`flex flex-col mb-2 gap-2 w-full text-nowrap text-void-fg-3 select-none relative ${className}`"
  >
    <div v-if="displayThreads.length === 0" class="p-1 text-xs opacity-70">
      {{ query ? 'Ничего не найдено' : 'Нет сохранённых чатов' }}
    </div>
    <template v-else>
      <template v-for="(threadId, i) in displayThreads" :key="allThreads[threadId]?.id ?? i">
        <div v-if="!allThreads[threadId]" class="p-1">Ошибка доступа к истории чатов.</div>
        <PastThreadElement
          v-else
          :pastThread="allThreads[threadId]"
          :idx="i"
          :hoveredIdx="hoveredIdx"
          :setHoveredIdx="setHoveredIdx"
          :isRunning="runningThreadIds[allThreads[threadId].id]"
          :isCurrent="highlightCurrent && allThreads[threadId].id === threadsState.currentThreadId"
          :onThreadClick="onThreadClick"
        />
      </template>
    </template>

    <div
      v-if="hasMoreThreads && !showAll"
      class="text-void-fg-3 opacity-80 hover:opacity-100 hover:brightness-115 cursor-pointer p-1 text-xs"
      @click="showAll = true"
    >
      Показать ещё {{ sortedThreadIds.length - numInitialThreads }}...
    </div>
    <div
      v-if="hasMoreThreads && showAll"
      class="text-void-fg-3 opacity-80 hover:opacity-100 hover:brightness-115 cursor-pointer p-1 text-xs"
      @click="showAll = false"
    >
      Свернуть
    </div>
  </div>
</template>
