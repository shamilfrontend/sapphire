<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, nextTick, ref, watch } from 'vue';
import { Pencil, X } from 'lucide-vue-next';
import { useAccessor, useChatThreadsState } from '../util/services.js';
import {
  ChatImageAttachment,
  ChatMessage,
  StagingSelectionItem,
} from '../../../../common/chatThreadServiceTypes.js';
import { filesToChatImageAttachments, imageFilesFromDataTransfer } from '../util/chatImages.js';
import { chatAttachFileAccept, partitionPickedChatFiles, useChatDropZone } from '../util/chatDrop.js';
import type { TextAreaFns } from '../util/SapphireInputBox.js';
import SapphireInputBox2 from '../util/SapphireInputBox2.vue';
import ChatDropOverlay from '../util/ChatDropOverlay.vue';
import { toValue } from 'vue';
import SelectedFiles from './SelectedFiles.vue';
import SelectedImages from './SelectedImages.vue';
import SapphireChatArea from './SapphireChatArea.vue';
import { useChatSupportsVision } from './sidebarChatShared.js';

const props = defineProps<{
  chatMessage: ChatMessage & { role: 'user' };
  messageIdx: number;
  currCheckpointIdx: number | undefined;
  isCheckpointGhost: boolean;
  _scrollToBottom: (() => void) | null;
}>();

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');
const fileService = accessor.get('IFileService');
const languageService = accessor.get('ILanguageService');
const threadsState = useChatThreadsState();

// состояние редактирования из сервиса треда
const messageState = computed(() => {
  void threadsState.value;
  return chatThreadsService.getCurrentMessageState(props.messageIdx);
});
const isBeingEdited = computed(() => messageState.value.isBeingEdited);
const stagingSelections = computed(() => messageState.value.stagingSelections);
const setIsBeingEdited = (v: boolean) => {
  chatThreadsService.setCurrentMessageState(props.messageIdx, { isBeingEdited: v });
};
const setStagingSelections = (s: StagingSelectionItem[]) => {
  chatThreadsService.setCurrentMessageState(props.messageIdx, { stagingSelections: s });
};

// локальный UI (hover, focus, disabled)
const mode = computed(() => (isBeingEdited.value ? 'edit' : 'display'));
const isFocused = ref(false);
const isHovered = ref(false);
const isDisabled = ref(false);
const textAreaRefState = ref<HTMLTextAreaElement | null>(null);
const textAreaFnsRef: { current: TextAreaFns | null } = { current: null };
const textAreaRef: { current: HTMLTextAreaElement | null } = { current: null };
const editImages = ref<ChatImageAttachment[]>(props.chatMessage.images ?? []);
const editFileInputRef = ref<HTMLInputElement | null>(null);
const supportsVision = useChatSupportsVision();
// синхронизация поля при входе в режим edit
const _mustInitialize = { current: true };
const _justEnabledEdit = { current: false };

watch(
  () =>
    [
      props.chatMessage,
      mode.value,
      textAreaRefState.value,
      textAreaFnsRef.current,
      _justEnabledEdit.current,
      _mustInitialize.current,
    ] as const,
  () => {
    const canInitialize = mode.value === 'edit' && textAreaRefState.value;
    const shouldInitialize = _justEnabledEdit.current || _mustInitialize.current;
    if (canInitialize && shouldInitialize) {
      setStagingSelections(props.chatMessage.selections || []);
      editImages.value = props.chatMessage.images ?? [];

      if (textAreaFnsRef.current)
        textAreaFnsRef.current.setValue(props.chatMessage.displayContent || '');

      textAreaRefState.value?.focus();

      _justEnabledEdit.current = false;
      _mustInitialize.current = false;
    }
  },
  { immediate: true },
);

watch(supportsVision, (vision) => {
  if (!vision) {
    editImages.value = [];
  }
});

const onOpenEdit = () => {
  setIsBeingEdited(true);
  chatThreadsService.setCurrentlyFocusedMessageIdx(props.messageIdx);
  _justEnabledEdit.current = true;
};
const onCloseEdit = () => {
  isFocused.value = false;
  isHovered.value = false;
  setIsBeingEdited(false);
  chatThreadsService.setCurrentlyFocusedMessageIdx(undefined);
};

const appendEditImages = async (files: File[]) => {
  if (!files.length) return;
  const next = await filesToChatImageAttachments(files, editImages.value);
  editImages.value = next;
  isDisabled.value = !textAreaRefState.value?.value && next.length === 0;
};

const onPickEditFiles = async () => {
  editFileInputRef.value?.click();
};

const onEditFilesPicked = async (files: File[]) => {
  if (!files.length) return;
  const { imageFiles, selections: picked } = await partitionPickedChatFiles(files, {
    fileService,
    languageService,
    includeImages: supportsVision.value,
  });
  if (imageFiles.length) {
    await appendEditImages(imageFiles);
  }
  for (const item of picked) {
    chatThreadsService.addNewStagingSelection(item);
  }
  if (picked.length) {
    isDisabled.value = false;
  }
};

const editDropZone = useChatDropZone({
  includeImages: supportsVision.value,
  onImages: appendEditImages,
  onSelections: (items) => {
    for (const item of items) {
      chatThreadsService.addNewStagingSelection(item);
    }
  },
});
const editDragOver = computed(() => Boolean(toValue(editDropZone.isDragOver)));

const onSubmit = async () => {
  if (isDisabled.value) return;
  if (!textAreaRefState.value) return;

  // прерываем стрим перед редактированием
  const threadId = chatThreadsService.state.currentThreadId;

  await chatThreadsService.abortRunning(threadId);

  // выходим из режима редактирования
  setIsBeingEdited(false);
  chatThreadsService.setCurrentlyFocusedMessageIdx(undefined);

  // отправляем отредактированное сообщение
  const userMessage = textAreaRefState.value.value;
  try {
    await chatThreadsService.editUserMessageAndStreamResponse({
      userMessage,
      messageIdx: props.messageIdx,
      threadId,
      images: editImages.value,
    });
  } catch (e) {
    console.error('Error while editing message:', e);
  }
  await chatThreadsService.focusCurrentChat();
  requestAnimationFrame(() => props._scrollToBottom?.());
};

const onAbort = async () => {
  const threadId = chatThreadsService.state.currentThreadId;
  await chatThreadsService.abortRunning(threadId);
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    onCloseEdit();
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    void onSubmit();
  }
};

const readExposedTextArea = (el: unknown): HTMLTextAreaElement | null => {
  if (el instanceof HTMLTextAreaElement) return el;
  if (el && typeof el === 'object' && 'textarea' in el) {
    const node = (el as { textarea: unknown }).textarea;
    if (node instanceof HTMLTextAreaElement) return node;
  }
  return textAreaRef.current;
};

const setTextAreaEl = (el: unknown) => {
  const apply = () => {
    const node = el == null ? null : readExposedTextArea(el);
    textAreaRefState.value = node;
    if (node) textAreaRef.current = node;
    else if (el == null) textAreaRef.current = null;
  };
  apply();
  void nextTick(apply);
};

const isMsgAfterCheckpoint = computed(
  () => props.currCheckpointIdx !== undefined && props.currCheckpointIdx === props.messageIdx - 1,
);

const hideEmpty = computed(
  () =>
    mode.value === 'edit' && !props.chatMessage.content && !(props.chatMessage.images?.length ?? 0),
);

const setEditImages = (imgs: ChatImageAttachment[]) => {
  editImages.value = imgs;
  isDisabled.value = !textAreaRefState.value?.value && imgs.length === 0;
};

const onEditChangeText = (text: string) => {
  isDisabled.value = !text && editImages.value.length === 0;
};

const onEditFocus = () => {
  isFocused.value = true;
  chatThreadsService.setCurrentlyFocusedMessageIdx(props.messageIdx);
};

const onEditBlur = () => {
  isFocused.value = false;
};

const onEditPaste = async (e: ClipboardEvent) => {
  if (!supportsVision.value) return;
  const files = imageFilesFromDataTransfer(e.clipboardData);
  if (!files.length) return;
  e.preventDefault();
  await appendEditImages(files);
};

const onEditFileInput = async (e: Event) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;
  const files = Array.from(input.files ?? []);
  input.value = '';
  await onEditFilesPicked(files);
};
const onEditSymbolClick = () => {
  if (mode.value === 'display') {
    onOpenEdit();
  } else if (mode.value === 'edit') {
    onCloseEdit();
  }
};
</script>

<template>
  <div
    v-if="!hideEmpty"
    :class="`
        relative ml-auto
        ${
          mode === 'edit'
            ? 'w-full max-w-full'
            : mode === 'display'
              ? `self-end w-fit max-w-full whitespace-pre-wrap`
              : ''
        }

        ${isCheckpointGhost && !isMsgAfterCheckpoint ? 'opacity-50 pointer-events-none' : ''}
    `"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <div
      :class="`
            text-left rounded-xl max-w-full
            ${
              mode === 'edit'
                ? ''
                : mode === 'display'
                  ? 'p-2.5 flex flex-col bg-void-bg-1-alt text-void-fg-1 overflow-x-auto cursor-pointer'
                  : ''
            }
        `"
      @click="mode === 'display' ? onOpenEdit() : undefined"
    >
      <template v-if="mode === 'display'">
        <SelectedFiles type="past" :messageIdx="messageIdx" :selections="chatMessage.selections || []" />
        <SelectedImages
          v-if="(chatMessage.images?.length ?? 0) > 0"
          type="past"
          :images="chatMessage.images!"
        />
        <span class="px-0.5 select-text cursor-text">{{ chatMessage.displayContent }}</span>
      </template>
      <div
        v-else-if="mode === 'edit'"
        class="relative w-full"
        @dragenter="editDropZone.onDragEnter"
        @dragover="editDropZone.onDragOver"
        @dragleave="editDropZone.onDragLeave"
        @drop="editDropZone.onDrop"
      >
        <ChatDropOverlay :visible="editDragOver" />
        <SapphireChatArea
          featureName="Chat"
          :onSubmit="onSubmit"
          :onAbort="onAbort"
          :isStreaming="false"
          :isDisabled="isDisabled"
          showSelections
          :selections="stagingSelections"
          :setSelections="setStagingSelections"
          :images="editImages"
          :setImages="setEditImages"
          :onPickFiles="onPickEditFiles"
          :showProjectIndexStatus="false"
        >
          <input
            ref="editFileInputRef"
            type="file"
            :accept="chatAttachFileAccept(supportsVision)"
            multiple
            class="hidden"
            @change="onEditFileInput"
          />
          <SapphireInputBox2
            enableAtToMention
            :ref="setTextAreaEl"
            :textAreaRef="textAreaRef"
            class="min-h-[81px] max-h-[500px] px-0.5"
            placeholder="Редактировать сообщение..."
            :onChangeText="onEditChangeText"
            :onFocus="onEditFocus"
            :onBlur="onEditBlur"
            :onKeyDown="onKeyDown"
            :onPaste="onEditPaste"
            :fnsRef="textAreaFnsRef"
            multiline
          />
        </SapphireChatArea>
      </div>
    </div>

    <div class="absolute -top-1 -right-1 translate-x-0 -translate-y-0 z-1">
      <!--
        data-tooltip-id='sapphire-tooltip'
        data-tooltip-content='Редактировать сообщение'
        data-tooltip-place='left'
      -->
      <component
        :is="mode === 'display' ? Pencil : X"
        :size="18"
        :class="`
                    cursor-pointer
                    p-[2px]
                    bg-void-bg-1 border border-void-border-1 rounded-md
                    transition-opacity duration-200 ease-in-out
                    ${isHovered || (isFocused && mode === 'edit') ? 'opacity-100' : 'opacity-0'}
                `"
        @click.stop="onEditSymbolClick"
      />
    </div>
  </div>
</template>
