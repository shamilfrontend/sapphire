<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useAccessor, useCtrlKZoneStreamingState, useSettingsState } from '../util/services.js';
import type { TextAreaFns } from '../util/inputs.js';
import SapphireInputBox2 from '../util/SapphireInputBox2.vue';
import SapphireChatArea from '../sidebar-tsx/SapphireChatArea.vue';
import { useRefState } from '../util/helpers.js';
import { isFeatureNameDisabled } from '../../../../common/sapphireSettingsTypes.js';
import type { QuickEditPropsType } from '../../../quickEditActions.js';

type InputBoxExpose = {
  textarea?: HTMLTextAreaElement | null;
  textAreaRef?: HTMLTextAreaElement | null;
  $el?: Element | null;
};

const props = defineProps<QuickEditPropsType>();

const accessor = useAccessor();
const editCodeService = accessor.get('IEditCodeService');
const sizerRef = ref<HTMLDivElement | null>(null);
const textAreaEl = reactive<{ current: HTMLTextAreaElement | null }>({ current: null });
const textAreaFnsRef = reactive<{ current: TextAreaFns | null }>({ current: null });
const chatAreaRef = reactive<{ current: HTMLDivElement | null }>({ current: null });
const inputBoxRef = ref<InputBoxExpose | null>(null);

let disconnectSizer: (() => void) | undefined;
let boundTextArea: HTMLTextAreaElement | null = null;

onMounted(() => {
  const inputContainer = sizerRef.value;
  if (!inputContainer) return;
  // ResizeObserver на контейнер — высота Quick Edit для позиционирования виджета
  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const box = entry.borderBoxSize[0];
    if (!box) return;
    props.onChangeHeight(box.blockSize);
  });
  resizeObserver.observe(inputContainer);
  disconnectSizer = () => {
    resizeObserver.disconnect();
  };
});

const settingsState = useSettingsState();

// Пустая инструкция блокирует отправку
const instructionsAreEmpty = ref(!(props.initText ?? ''));
const isDisabled = computed(
  () => instructionsAreEmpty.value || !!isFeatureNameDisabled('Ctrl+K', settingsState.value),
);

const [isStreamingRef, setIsStreamingRef] = useRefState(
  editCodeService.isCtrlKZoneStreaming({ diffareaid: props.diffareaid }),
);
useCtrlKZoneStreamingState((diffareaid2, isStreaming) => {
  if (props.diffareaid !== diffareaid2) return;
  setIsStreamingRef(isStreaming);
});

const onChangeText = (newStr: string) => {
  instructionsAreEmpty.value = !newStr;
  props.onChangeText(newStr);
};

const onSubmit = async () => {
  if (isDisabled.value) return;
  if (isStreamingRef.current) return;
  textAreaFnsRef.current?.disable();

  const opts = {
    from: 'QuickEdit',
    diffareaid: props.diffareaid,
    startBehavior: 'keep-conflicts',
  } as const;

  await editCodeService.callBeforeApplyOrEdit(opts);
  const [newApplyingUri, applyDonePromise] = editCodeService.startApplying(opts) ?? [];
  // Ошибка apply — прерываем стрим Ctrl+K
  applyDonePromise?.catch((_e) => {
    if (newApplyingUri) editCodeService.interruptCtrlKStreaming({ diffareaid: props.diffareaid });
  });
};

const onInterrupt = () => {
  if (!isStreamingRef.current) return;
  editCodeService.interruptCtrlKStreaming({ diffareaid: props.diffareaid });
  textAreaFnsRef.current?.enable();
};

const onX = () => {
  onInterrupt();
  editCodeService.removeCtrlKZone({ diffareaid: props.diffareaid });
};

const onEnterKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    void onSubmit();
  }
};

const onTextAreaKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    onX();
  }
};

const asTextArea = (candidate: unknown): HTMLTextAreaElement | null => {
  if (candidate instanceof HTMLTextAreaElement) return candidate;
  if (candidate && typeof candidate === 'object' && 'value' in candidate) {
    const inner = (candidate as { value: unknown }).value;
    if (inner instanceof HTMLTextAreaElement) return inner;
  }
  return null;
};

const resolveTextArea = (box: InputBoxExpose | null): HTMLTextAreaElement | null => {
  if (!box) return null;
  return asTextArea(box.textarea) ?? asTextArea(box.textAreaRef) ?? asTextArea(box.$el);
};

const focusTextArea = () => {
  textAreaEl.current?.focus();
};

watch(
  () => resolveTextArea(inputBoxRef.value),
  (el) => {
    if (el === boundTextArea) return;
    boundTextArea = el;
    textAreaEl.current = el;
    props.textAreaRef(el);
    if (el) {
      el.addEventListener('keydown', onTextAreaKeyDown);
    }
  },
  { flush: 'post' },
);

onUnmounted(() => {
  disconnectSizer?.();
  if (boundTextArea) {
    boundTextArea.removeEventListener('keydown', onTextAreaKeyDown);
  }
  props.textAreaRef(null);
});

const sizerStyle = { maxWidth: '450px' };
</script>

<template>
  <div ref="sizerRef" class="py-2 w-full" :style="sizerStyle">
    <SapphireChatArea
      featureName="Ctrl+K"
      :divRef="chatAreaRef"
      :isStreaming="isStreamingRef.current"
      :isDisabled="isDisabled"
      :onSubmit="onSubmit"
      :onAbort="onInterrupt"
      :onClose="onX"
      :onClickAnywhere="focusTextArea"
    >
      <template #loadingIcon>
        <div
          class="@@codicon @@codicon-loading @@codicon-modifier-spin @@codicon-no-default-spin text-void-fg-3"
        />
      </template>
      <SapphireInputBox2
        ref="inputBoxRef"
        class="px-1"
        :initValue="initText"
        :fnsRef="textAreaFnsRef"
        placeholder="Введите инструкцию..."
        :multiline="true"
        :onChangeText="onChangeText"
        :onKeyDown="onEnterKeyDown"
      />
    </SapphireChatArea>
  </div>
</template>
