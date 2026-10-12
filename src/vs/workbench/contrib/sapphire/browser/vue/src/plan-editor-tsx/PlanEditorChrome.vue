<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import '../styles.css';
import { computed } from 'vue';
import { Hammer } from 'lucide-vue-next';
import ChatMarkdownRender from '../markdown/ChatMarkdownRender.vue';
import ProseWrapper from '../sidebar-tsx/ProseWrapper.vue';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.vue';
import PlanMarkdownBody from '../agents-window-tsx/PlanMarkdownBody.vue';
import {
  useAccessor,
  useChatThreadsState,
  useChatThreadsStreamState,
  useIsDark,
} from '../util/services.js';
import type { PlanTodoItem } from '../../../../common/toolsServiceTypes.js';
import { findPlanThreadId, type PlanEditorMode } from './planEditor.js';
import PlanTodoList from './PlanTodoList.vue';

const props = defineProps<{
  mode: PlanEditorMode;
  name: string;
  overview: string;
  plan: string;
  todos: PlanTodoItem[];
  planUriFsPath: string;
  onModeChange: (mode: PlanEditorMode) => void;
  /** Режим Markdown в Agents (без Monaco под chrome). */
  markdownValue?: string;
  onMarkdownInput?: (value: string) => void;
  onMarkdownKeydown?: (event: KeyboardEvent) => void;
}>();

const isDark = useIsDark();
const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');
const chatThreadsState = useChatThreadsState();

const planThreadId = computed(() =>
  findPlanThreadId(
    chatThreadsState.value.allThreads,
    chatThreadsState.value.currentThreadId,
    props.planUriFsPath,
  ),
);
const streamState = useChatThreadsStreamState(() => planThreadId.value ?? '');

const planStatus = computed(() =>
  planThreadId.value
    ? chatThreadsState.value.allThreads[planThreadId.value]?.state.activePlan?.status
    : undefined,
);
const progressLabel = computed(() =>
  planThreadId.value
    ? chatThreadsState.value.allThreads[planThreadId.value]?.state.activePlan?.progressLabel
    : undefined,
);
const isRunning = computed(() => !!streamState.value?.isRunning);
const canBuild = computed(
  () =>
    !!planThreadId.value &&
    (planStatus.value === 'ready' ||
      planStatus.value === 'built' ||
      (planStatus.value === 'building' && !isRunning.value)) &&
    !isRunning.value,
);
const buildLabel = computed(() => {
  if (planStatus.value === 'building' && isRunning.value) return 'Выполняется…';
  if (planStatus.value === 'building' && !isRunning.value) return 'Продолжить';
  if (planStatus.value === 'built') return 'Выполнить снова';
  return 'Сделать по плану';
});

const trimmedName = computed(() => props.name.trim());
const trimmedOverview = computed(() => props.overview.trim());
const trimmedPlan = computed(() => props.plan.trim());

const onBuild = () => {
  const threadId = planThreadId.value;
  if (!threadId || !canBuild.value) return;
  if (threadId !== chatThreadsState.value.currentThreadId) {
    chatThreadsService.switchToThread(threadId);
  }
  void chatThreadsService.buildActivePlan(threadId);
};

const showMarkdownEditor = computed(
  () => props.mode === 'markdown' && props.markdownValue !== undefined,
);

const rootStyle = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column' as const,
};
const toolbarStyle = { height: '36px', pointerEvents: 'auto' as const };
const previewStyle = { pointerEvents: 'auto' as const, userSelect: 'text' as const, WebkitUserSelect: 'text' };
const markdownStyle = { pointerEvents: 'auto' as const };
</script>

<template>
  <div class="@@void-scope" :class="{ dark: isDark }" :style="rootStyle">
    <div
      class="flex items-center gap-1 shrink-0 px-3 border-b border-void-border-1 bg-void-bg-2"
      :style="toolbarStyle"
    >
      <span class="text-[11px] text-void-fg-3 mr-1">Вид</span>
      <div class="inline-flex rounded-sm border border-void-border-2 overflow-hidden">
        <button
          type="button"
          class="px-2 py-0.5 text-[12px]"
          :class="
            mode === 'preview'
              ? 'bg-void-bg-1 text-void-fg-1'
              : 'bg-void-bg-3 text-void-fg-3 hover:text-void-fg-1'
          "
          @click="onModeChange('preview')"
        >
          Просмотр
        </button>
        <button
          type="button"
          class="px-2 py-0.5 text-[12px] border-l border-void-border-2"
          :class="
            mode === 'markdown'
              ? 'bg-void-bg-1 text-void-fg-1'
              : 'bg-void-bg-3 text-void-fg-3 hover:text-void-fg-1'
          "
          @click="onModeChange('markdown')"
        >
          Markdown
        </button>
      </div>
      <button
        type="button"
        class="ml-auto inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-sm text-[12px] font-medium"
        :class="
          canBuild
            ? 'bg-void-success text-white hover:opacity-90'
            : 'opacity-50 cursor-not-allowed bg-void-bg-3 text-void-fg-3'
        "
        :disabled="!canBuild"
        @click="onBuild"
      >
        <Hammer class="w-3.5 h-3.5" />
        {{ buildLabel }}
      </button>
      <span
        v-if="progressLabel && planStatus === 'building'"
        class="ml-2 text-[11px] text-void-fg-3 truncate max-w-[220px]"
        :title="progressLabel"
      >
        {{ progressLabel }}
      </span>
    </div>
    <div
      v-if="mode === 'preview'"
      class="flex-1 min-h-0 overflow-auto bg-void-bg-1 cursor-text"
      :style="previewStyle"
    >
      <div class="px-8 py-6 max-w-[800px]">
        <ErrorBoundary>
          <ProseWrapper>
            <h1 v-if="trimmedName">{{ trimmedName }}</h1>
            <ChatMarkdownRender
              v-if="trimmedOverview"
              :string="trimmedOverview"
              :chatMessageLocation="undefined"
              :isApplyEnabled="false"
              :isLinkDetectionEnabled="true"
            />
          </ProseWrapper>
          <PlanTodoList :todos="todos" />
          <ProseWrapper v-if="trimmedPlan">
            <ChatMarkdownRender
              :string="trimmedPlan"
              :chatMessageLocation="undefined"
              :isApplyEnabled="false"
              :isLinkDetectionEnabled="true"
            />
          </ProseWrapper>
        </ErrorBoundary>
      </div>
    </div>
    <div v-else-if="showMarkdownEditor" class="flex-1 min-h-0 overflow-hidden" :style="markdownStyle">
      <PlanMarkdownBody
        :value="markdownValue ?? ''"
        @input="onMarkdownInput?.($event)"
        @keydown="onMarkdownKeydown?.($event)"
      />
    </div>
  </div>
</template>
