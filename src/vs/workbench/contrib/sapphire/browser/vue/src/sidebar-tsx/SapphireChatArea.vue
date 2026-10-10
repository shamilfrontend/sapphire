<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onMounted, onUnmounted, ref, watch, type VNodeChild } from 'vue';
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
import ProjectIndexControls from './ProjectIndexControls.vue';
import { accentOfChatMode } from './ChatComposer.js';
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
    /**
     * Статус индекса в футере композера.
     * В IDE (`layoutMode === 'ide'`) статус только в titlebar — здесь не показываем.
     */
    showProjectIndexStatus?: boolean;
  }>(),
  {
    isStreaming: false,
    isDisabled: false,
    className: '',
    showModelDropdown: true,
    showSelections: false,
    showProjectIndexStatus: true,
  },
);

const settingsState = useSettingsState();
const toolbarRef = ref<HTMLDivElement | null>(null);
const compactMode = ref(false);

const LoadingIconView = () => props.loadingIcon ?? null;
const setRootEl = (el: unknown) => {
  if (!props.divRef) return;
  props.divRef.current = el instanceof HTMLDivElement ? el : null;
};

let toolbarObserver: ResizeObserver | undefined;
const bindToolbar = () => {
  toolbarObserver?.disconnect();
  toolbarObserver = undefined;
  const toolbar = toolbarRef.value;
  if (!toolbar || props.featureName !== 'Chat') return;
  const update = () => {
    const width = toolbar.clientWidth;
    compactMode.value = width < 300 ? true : width >= 360 ? false : compactMode.value;
  };
  update();
  toolbarObserver = new ResizeObserver(update);
  toolbarObserver.observe(toolbar);
};
onMounted(bindToolbar);
watch(() => props.featureName, bindToolbar);
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

    <!-- Нижняя панель: модель, индекс, отправка -->
    <div ref="toolbarRef" class="flex flex-row flex-nowrap items-center gap-1 mt-1 min-w-0">
      <div v-if="showModelDropdown" class="flex flex-col gap-y-1 min-w-0 flex-1">
        <ReasoningOptionSlider :featureName="featureName" />

        <div class="flex items-center flex-nowrap gap-x-2 min-w-0">
          <ChatModeDropdown v-if="featureName === 'Chat'" :iconOnly="compactMode" />
          <div class="min-w-0 flex-1">
            <ModelDropdown
              :featureName="featureName"
              class="text-xs text-void-fg-3 rounded"
              fillWidth
            />
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <ContextUsageIndicator
          v-if="featureName === 'Chat' && contextUsage !== undefined"
          :usage="contextUsage ?? null"
        />
        <ProjectIndexControls
          v-if="featureName === 'Chat'"
          :showStatusButton="settingsState.globalSettings.layoutMode !== 'ide' && showProjectIndexStatus"
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
