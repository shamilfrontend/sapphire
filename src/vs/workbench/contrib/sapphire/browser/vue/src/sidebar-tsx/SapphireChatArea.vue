<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { nextTick, onMounted, onUnmounted, ref, watch, type VNodeChild } from 'vue';
import { Paperclip } from 'lucide-vue-next';
import { useSettingsState } from '../util/services.js';
import ModelDropdown from '../void-settings-tsx/ModelDropdown.vue';
import {
  FeatureName,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import {
  ChatImageAttachment,
  StagingSelectionItem,
} from '../../../../common/chatThreadServiceTypes.js';
import type { ChatContextUsage } from '../../../convertToLLMMessageService.js';
import IconX from './IconX.vue';
import SelectedFiles from './SelectedFiles.vue';
import SelectedImages from './SelectedImages.vue';
import { accentOfChatMode, nameOfChatMode } from './ChatComposer.js';
import ReasoningOptionSlider from './ReasoningOptionSlider.vue';
import ChatModeDropdown from './ChatModeDropdown.vue';
import ContextUsageIndicator from './ContextUsageIndicator.vue';
import ButtonSubmit from './ButtonSubmit.vue';
import ButtonStop from './ButtonStop.vue';

const props = withDefaults(
  defineProps<{
    onSubmit: () => void;
    onAbort: () => void;
    isStreaming?: boolean;
    isDisabled?: boolean;
    divRef?: { current: HTMLDivElement | null };
    className?: string;
    showModelDropdown?: boolean;
    showSelections?: boolean;
    loadingIcon?: VNodeChild;
    selections?: StagingSelectionItem[];
    setSelections?: (s: StagingSelectionItem[]) => void;
    images?: ChatImageAttachment[];
    setImages?: (imgs: ChatImageAttachment[]) => void;
    onPickFiles?: () => void;
    onClickAnywhere?: () => void;
    onClose?: () => void;
    featureName: FeatureName;
    /** Индикатор заполнения контекстного окна (только Chat). */
    contextUsage?: ChatContextUsage | null;
  }>(),
  {
    isStreaming: false,
    isDisabled: false,
    className: '',
    showModelDropdown: true,
    showSelections: false,
  },
);

const settingsState = useSettingsState();
const toolbarRef = ref<HTMLDivElement | null>(null);
const actionsRef = ref<HTMLDivElement | null>(null);
const modeMeasureRef = ref<HTMLDivElement | null>(null);
const compactMode = ref(false);

const LoadingIconView = () => props.loadingIcon ?? null;
const setRootEl = (el: unknown) => {
  if (!props.divRef) return;
  props.divRef.current = el instanceof HTMLDivElement ? el : null;
};

/** Хвост названия модели, который остаётся видимым, прежде чем спрятать подпись режима. */
const MODEL_LABEL_MIN_PX = 72;
const MODE_MODEL_GAP_PX = 8;
const TOOLBAR_GAP_PX = 4;
const FIT_SLACK_PX = 2;

let toolbarObserver: ResizeObserver | undefined;
const updateCompact = () => {
  if (props.featureName !== 'Chat') {
    compactMode.value = false;
    return;
  }
  const toolbar = toolbarRef.value;
  const modeWidth = modeMeasureRef.value?.offsetWidth ?? 0;
  const actionsWidth = actionsRef.value?.offsetWidth ?? 0;
  if (!toolbar || modeWidth === 0) return;
  const needed =
    modeWidth + MODE_MODEL_GAP_PX + MODEL_LABEL_MIN_PX + TOOLBAR_GAP_PX + actionsWidth + FIT_SLACK_PX;
  compactMode.value = toolbar.clientWidth < needed;
};

const bindToolbar = () => {
  toolbarObserver?.disconnect();
  toolbarObserver = undefined;
  if (props.featureName !== 'Chat') {
    compactMode.value = false;
    return;
  }
  const nodes = [toolbarRef.value, actionsRef.value, modeMeasureRef.value].filter(
    (node): node is HTMLDivElement => node instanceof HTMLDivElement,
  );
  if (nodes.length === 0) return;
  updateCompact();
  toolbarObserver = new ResizeObserver(() => updateCompact());
  for (const node of nodes) toolbarObserver.observe(node);
};
onMounted(bindToolbar);
watch(
  () =>
    [props.featureName, settingsState.value.globalSettings.chatMode, props.isStreaming] as const,
  () => {
    void nextTick(() => bindToolbar());
  },
);
onUnmounted(() => toolbarObserver?.disconnect());
</script>

<template>
  <div
    :ref="setRootEl"
    :class="`
				gap-x-1
                flex flex-col p-3 relative input text-left shrink-0 min-w-0
                rounded-2xl
                ${featureName === 'Chat' ? 'bg-[var(--void-chat-field-bg)]' : 'bg-void-bg-1'}
				transition-all duration-200
				border border-void-border-3 focus-within:border-void-border-2 hover:border-void-border-2
				max-h-[80vh] overflow-y-auto
                ${className}
            `"
    @click="onClickAnywhere?.()"
  >
    <!-- Прикреплённые файлы -->
    <SelectedFiles
      v-if="showSelections && selections && setSelections"
      type="staging"
      :selections="selections"
    />

    <SelectedImages
      v-if="images && images.length > 0 && setImages"
      type="staging"
      :images="images"
      :setImages="setImages"
    />

    <!-- Поле ввода -->
    <div class="relative w-full">
      <slot />

      <!-- Кнопка закрытия (X) -->
      <div v-if="onClose" class="absolute -top-1 -right-1 cursor-pointer z-1">
        <IconX
          :size="12"
          class="stroke-[2] opacity-80 text-void-fg-3 hover:brightness-95"
          @click="onClose()"
        />
      </div>
    </div>

    <!-- Нижняя панель: модель, отправка -->
    <div ref="toolbarRef" class="relative flex flex-row flex-nowrap items-center gap-1 mt-1 min-w-0">
      <div
        v-if="featureName === 'Chat'"
        ref="modeMeasureRef"
        class="invisible absolute left-0 top-0 pointer-events-none flex items-center h-4 text-xs rounded-md py-0.5 px-2 border border-transparent whitespace-nowrap"
        aria-hidden="true"
      >
        <span class="size-3.5 shrink-0 mr-1" />
        <span class="mr-1">{{ nameOfChatMode[settingsState.globalSettings.chatMode] }}</span>
        <span class="size-3 shrink-0" />
      </div>

      <div v-if="showModelDropdown" class="flex flex-col gap-y-1 min-w-0 flex-1">
        <ReasoningOptionSlider :featureName="featureName" />

        <div class="flex items-center flex-nowrap gap-x-2 min-w-0">
          <ChatModeDropdown v-if="featureName === 'Chat'" :iconOnly="compactMode" />
          <div class="min-w-0 shrink">
            <ModelDropdown
              :featureName="featureName"
              class="text-xs text-void-fg-3 rounded"
            />
          </div>
          <div class="flex-1" />
        </div>
      </div>

      <div ref="actionsRef" class="flex items-center gap-2 shrink-0">
        <ContextUsageIndicator
          v-if="featureName === 'Chat' && contextUsage !== undefined"
          :usage="contextUsage ?? null"
        />
        <button
          v-if="onPickFiles"
          type="button"
          class="rounded-full flex-shrink-0 flex items-center justify-center size-[26px] text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2 cursor-pointer"
          title="Прикрепить файл"
          @click.stop="onPickFiles()"
        >
          <Paperclip :size="14" class="stroke-[2]" />
        </button>

        <slot v-if="isStreaming" name="loadingIcon">
          <LoadingIconView v-if="loadingIcon" />
        </slot>

        <template v-if="isStreaming">
          <ButtonSubmit
            v-if="!isDisabled"
            @click="onSubmit()"
            :disabled="isDisabled"
            :accentColor="featureName === 'Chat' ? accentOfChatMode[settingsState.globalSettings.chatMode].fg : undefined"
          />
          <ButtonStop
            @click="onAbort()"
            :accentColor="featureName === 'Chat' ? accentOfChatMode[settingsState.globalSettings.chatMode].fg : undefined"
          />
        </template>
        <ButtonSubmit
          v-else
          @click="onSubmit()"
          :disabled="isDisabled"
          :accentColor="featureName === 'Chat' ? accentOfChatMode[settingsState.globalSettings.chatMode].fg : undefined"
        />
      </div>
    </div>
  </div>
</template>
