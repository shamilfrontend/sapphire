<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onMounted, onUnmounted, onWatcherCleanup, ref, watch } from 'vue';
import {
  History,
  LoaderCircle,
  MessageCircle,
  MessageCircleQuestion,
  Plus,
  Settings,
  X,
} from 'lucide-vue-next';
import {
  useAccessor,
  useChatThreadsState,
  useFullChatThreadsStreamState,
} from '../util/services.js';
import { threadActivity, threadTitle } from '../util/threadDisplay.js';
import PastThreadsList from './PastThreadsList.vue';
import AgentsHistoryTree from './AgentsHistoryTree.vue';

const props = withDefaults(
  defineProps<{
    variant?: 'sidebar' | 'agents';
    /** Если не задано: история в сайдбаре IDE, в режиме Агент скрыта. */
    showHistoryButton?: boolean;
    settingsTab?: { open: boolean; active: boolean };
    onActivateSettings?: () => void;
    onCloseSettings?: () => void;
    onSelectThread?: () => void;
  }>(),
  { variant: 'sidebar' },
);

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');
const threadsState = useChatThreadsState();
const streamState = useFullChatThreadsStreamState();

const openThreadIds = computed(() => threadsState.value.openThreadIds ?? []);
const currentThreadId = computed(() => threadsState.value.currentThreadId);
const allThreads = computed(() => threadsState.value.allThreads);

const showHistory = ref(false);
const historyRef = ref<HTMLDivElement | null>(null);
const tabRefs = ref<Record<string, HTMLDivElement | null>>({});
const historyVisible = computed(() => props.showHistoryButton ?? props.variant !== 'agents');
const settingsActive = computed(() => !!props.settingsTab?.active);

const setTabRef = (id: string, el: unknown) => {
  tabRefs.value[id] = el instanceof HTMLDivElement ? el : null;
};

const activityOf = (threadId: string) => threadActivity(streamState.value[threadId]);
const titleOf = (threadId: string) => threadTitle(allThreads.value[threadId]);

const scrollActiveTab = () => {
  const id = settingsActive.value ? '__settings' : currentThreadId.value;
  tabRefs.value[id]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};

onMounted(scrollActiveTab);
watch(
  [currentThreadId, settingsActive, openThreadIds, () => props.settingsTab?.open],
  scrollActiveTab,
  { flush: 'post' },
);

let historyRequestDisposable: { dispose: () => void } | undefined;
onMounted(() => {
  historyRequestDisposable = chatThreadsService.onDidRequestShowHistory(() => {
    showHistory.value = true;
  });
});
onUnmounted(() => {
  historyRequestDisposable?.dispose();
});

watch(
  historyVisible,
  (visible) => {
    if (!visible) showHistory.value = false;
  },
  { immediate: true },
);

watch(
  showHistory,
  (open) => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (historyRef.value && !historyRef.value.contains(e.target as Node)) {
        showHistory.value = false;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') showHistory.value = false;
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    onWatcherCleanup(() => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    });
  },
  { immediate: true },
);

const onTabMouseDown = (e: MouseEvent, threadId: string) => {
  if (e.button !== 1) return;
  e.preventDefault();
  chatThreadsService.closeTab(threadId);
};

const selectThread = (threadId: string) => {
  props.onSelectThread?.();
  chatThreadsService.switchToThread(threadId);
};

const onTabKeyDown = (e: KeyboardEvent, threadId: string) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectThread(threadId);
  }
};

const onSettingsMouseDown = (e: MouseEvent) => {
  if (e.button !== 1) return;
  e.preventDefault();
  props.onCloseSettings?.();
};

const onSettingsKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    props.onActivateSettings?.();
  }
};
</script>

<template>
  <div
    :class="`relative flex items-stretch gap-1 w-full h-8 px-1.5 select-none border-b ${
      variant === 'agents' ? 'bg-[var(--void-header-bg)] border-void-border-2' : 'bg-void-bg-2 border-void-border-4'
    }`"
  >
    <div class="relative z-10 flex items-stretch gap-0.5 min-w-0 flex-1 overflow-x-auto">
      <div
        v-for="threadId in openThreadIds"
        :key="threadId"
        :ref="(el) => setTabRef(threadId, el)"
        role="tab"
        tabindex="0"
        :aria-selected="threadId === currentThreadId && !settingsActive"
        :class="`
								group flex items-center gap-1.5 max-w-[160px] h-full pl-2 pr-1 text-xs shrink-0 cursor-pointer
								transition-colors border-b-2
								${
                  threadId === currentThreadId && !settingsActive
                    ? variant === 'agents'
                      ? 'border-transparent text-void-fg-0 font-medium bg-[var(--void-content-bg)]'
                      : 'border-void-ring-color text-void-fg-0 font-medium bg-void-bg-1'
                    : 'border-transparent text-void-fg-3 hover:bg-void-bg-2-hover hover:text-void-fg-2'
                }
							`"
        @mousedown="onTabMouseDown($event, threadId)"
        @click="selectThread(threadId)"
        @keydown="onTabKeyDown($event, threadId)"
        :title="titleOf(threadId)"
      >
        <LoaderCircle
          v-if="activityOf(threadId) === 'running'"
          class="animate-spin size-3.5 shrink-0"
        />
        <MessageCircleQuestion
          v-else-if="activityOf(threadId) === 'awaiting'"
          class="size-3.5 shrink-0"
        />
        <MessageCircle v-else class="size-3.5 shrink-0 opacity-70" />
        <span class="truncate">{{ titleOf(threadId) }}</span>
        <button
          type="button"
          :class="`
									flex items-center justify-center size-4 rounded shrink-0
									hover:bg-void-bg-2-alt
									${threadId === currentThreadId && !settingsActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'}
								`"
          @mousedown.stop
          @click.stop="chatThreadsService.closeTab(threadId)"
          title="Закрыть вкладку"
        >
          <X class="size-3" />
        </button>
      </div>
      <div
        v-if="settingsTab?.open"
        :ref="(el) => setTabRef('__settings', el)"
        role="tab"
        tabindex="0"
        :aria-selected="settingsActive"
        :class="`
							group flex items-center gap-1.5 max-w-[160px] h-full pl-2 pr-1 text-xs shrink-0 cursor-pointer
							transition-colors border-b-2
							${
                settingsActive
                  ? variant === 'agents'
                    ? 'border-transparent text-void-fg-0 font-medium bg-[var(--void-content-bg)]'
                    : 'border-void-ring-color text-void-fg-0 font-medium bg-void-bg-1'
                  : 'border-transparent text-void-fg-3 hover:bg-void-bg-2-hover hover:text-void-fg-2'
              }
						`"
        @mousedown="onSettingsMouseDown"
        @click="onActivateSettings?.()"
        @keydown="onSettingsKeyDown"
        title="Настройки"
      >
        <Settings :class="`size-3.5 shrink-0 ${settingsActive ? 'opacity-100' : 'opacity-70'}`" />
        <span class="truncate">Настройки</span>
        <button
          type="button"
          :class="`
								flex items-center justify-center size-4 rounded shrink-0
								hover:bg-void-bg-2-alt
								${settingsActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'}
							`"
          @mousedown.stop
          @click.stop="onCloseSettings?.()"
          title="Закрыть вкладку"
        >
          <X class="size-3" />
        </button>
      </div>
    </div>

    <div class="relative z-10 flex items-center gap-0.5 shrink-0 pr-0.5">
      <button
        v-if="historyVisible"
        type="button"
        :class="`
							flex items-center justify-center size-7 rounded text-void-fg-4
							hover:bg-void-bg-2-hover hover:text-void-fg-2
							${showHistory ? 'bg-void-bg-1/60 text-void-fg-1' : ''}
						`"
        @click="showHistory = !showHistory"
        title="История чатов"
        data-tooltip-id="sapphire-tooltip"
        data-tooltip-content="История чатов"
      >
        <History class="size-4 stroke-[1.5]" />
      </button>
      <button
        type="button"
        class="flex items-center justify-center size-7 rounded text-void-fg-4 hover:bg-void-bg-2-hover hover:text-void-fg-2"
        @click="
          onSelectThread?.();
          chatThreadsService.openNewThread();
        "
        title="Новый чат"
        data-tooltip-id="sapphire-tooltip"
        data-tooltip-content="Новый чат"
      >
        <Plus class="size-4 stroke-[1.5]" />
      </button>
    </div>

    <div
      v-if="showHistory && historyVisible"
      ref="historyRef"
      class="absolute right-1 top-full z-50 mt-1 w-[min(100%-8px,320px)] max-h-[50vh] overflow-y-auto rounded-lg border border-void-border-2 bg-void-bg-1 shadow-lg p-2"
    >
      <AgentsHistoryTree
        v-if="variant === 'agents'"
        :onThreadOpen="
          () => {
            showHistory = false;
            onSelectThread?.();
          }
        "
      />
      <template v-else>
        <div class="text-xs text-void-fg-3 px-1 pb-2">История чатов</div>
        <PastThreadsList
          :onThreadClick="
            () => {
              showHistory = false;
              onSelectThread?.();
            }
          "
        />
      </template>
    </div>
  </div>
</template>
