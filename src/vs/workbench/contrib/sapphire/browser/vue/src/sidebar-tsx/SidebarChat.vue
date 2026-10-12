<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref, toValue, watch } from 'vue';
import {
  useAccessor,
  useChatThreadsState,
  useChatThreadsStreamState,
  useSettingsState,
} from '../util/services.js';
import { isFeatureNameDisabled } from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import {
  ChatImageAttachment,
  StagingSelectionItem,
} from '../../../../common/chatThreadServiceTypes.js';
import { filesToChatImageAttachments, imageFilesFromDataTransfer } from '../util/chatImages.js';
import {
  chatAttachFileAccept,
  partitionPickedChatFiles,
  useChatDropZone,
} from '../util/chatDrop.js';
import { canEnqueueFollowUp } from '../../../chatThreadService.js';
import { chatTrace } from '../../../../common/chatSendTrace.js';
import { SAPPHIRE_OPEN_SETTINGS_ACTION_ID } from '../../../sapphireSettingsPane.js';
import type { TextAreaFns } from '../util/SapphireInputBox.js';
import SapphireInputBox2 from '../util/SapphireInputBox2.vue';
import ChatDropOverlay from '../util/ChatDropOverlay.vue';
import WarningBox from '../void-settings-tsx/WarningBox.vue';
import { useAgentsPlan } from '../agents-window-tsx/AgentsPlanContext.js';
import { useAgentsReview } from '../agents-window-tsx/AgentsReviewContext.js';
import {
  findPinnedPlanToolMessage,
  planUriFsPathToCollapseInThread,
} from '../../../../common/planToolPin.js';
import ErrorBoundary from './ErrorBoundary.vue';
import ErrorDisplay from './ErrorDisplay.vue';
import PastThreadsList from './PastThreadsList.vue';
import QueuedMessagesPanel from './QueuedMessagesPanel.vue';
import SapphireChatArea from './SapphireChatArea.vue';
import ScrollToBottomContainer from './ScrollToBottomContainer.vue';
import ChatBubble from './ChatBubble.vue';
import CommandBarInChat from './CommandBarInChat.vue';
import CopyChatLogButton from './CopyChatLogButton.vue';
import ProjectIndexControls from './ProjectIndexControls.vue';
import IconLoading from './IconLoading.vue';
import ProseWrapper from './ProseWrapper.vue';
import { PlanToolCard, EditToolSoFar } from './ChatToolCards.js';
import { useChatContextUsage } from './ChatComposer.js';
import {
  EMPTY_CHAT_MESSAGES,
  SUGGESTED_PROMPTS,
  scrollToBottom,
  useChatSupportsVision,
  useLiveOutputTokensPerSecond,
} from './sidebarChatShared.js';

const props = withDefaults(defineProps<{ variant?: 'sidebar' | 'agents' }>(), {
  variant: 'sidebar',
});

const reviewApi = useAgentsReview();
const planApi = useAgentsPlan();
const sidePaneOpen = computed(() => (reviewApi?.reviewOpen ?? false) || (planApi?.planOpen ?? false));

const textAreaRef: { current: HTMLTextAreaElement | null } = { current: null };
const textAreaFnsRef: { current: TextAreaFns | null } = { current: null };

const accessor = useAccessor();
const commandService = accessor.get('ICommandService');
const chatThreadsService = accessor.get('IChatThreadService');
const fileService = accessor.get('IFileService');
const languageService = accessor.get('ILanguageService');

const settingsState = useSettingsState();
const chatThreadsState = useChatThreadsState();

const currentThread = computed(() => {
  void chatThreadsState.value;
  return chatThreadsService.getCurrentThread();
});
const previousMessages = computed(() => currentThread.value?.messages ?? EMPTY_CHAT_MESSAGES);
const selections = computed(() => currentThread.value?.state?.stagingSelections ?? []);
const setSelections = (s: StagingSelectionItem[]) => {
  chatThreadsService.setCurrentThreadState({ stagingSelections: s });
};

const currThreadStreamState = useChatThreadsStreamState(
  () => chatThreadsState.value.currentThreadId,
);
const isRunning = computed(() => currThreadStreamState.value?.isRunning);
const latestError = computed(() => currThreadStreamState.value?.error);
const statusHint = computed(() => {
  const state = currThreadStreamState.value;
  return state?.isRunning === 'LLM' || state?.isRunning === 'idle' || state?.isRunning === 'preparing'
    ? state.statusHint
    : undefined;
});
const displayContentSoFar = computed(() => currThreadStreamState.value?.llmInfo?.displayContentSoFar);
const toolCallsSoFar = computed(() => currThreadStreamState.value?.llmInfo?.toolCallsSoFar);
const reasoningSoFar = computed(() => currThreadStreamState.value?.llmInfo?.reasoningSoFar);
const firstTokenAt = computed(() => currThreadStreamState.value?.llmInfo?.firstTokenAt);
const liveTokensPerSecond = useLiveOutputTokensPerSecond(
  () => displayContentSoFar.value,
  () => reasoningSoFar.value,
  () => firstTokenAt.value,
  () => isRunning.value === 'LLM',
);

const toolIsGenerating = computed(() => !!toolCallsSoFar.value?.some((tc) => !tc.isDone));

const threadIdForDraft = computed(() => currentThread.value.id);
const instructionsAreEmpty = ref(!(currentThread.value.state.draftText ?? ''));
const draftText = ref(currentThread.value.state.draftText ?? '');
const stagingImages = ref<ChatImageAttachment[]>(currentThread.value.state.stagingImages ?? []);
/** initValue для SapphireInputBox2 — только при смене треда, не на каждый символ. */
const composerInitValue = ref<string | null>(currentThread.value.state.draftText || null);
const imageFileInputRef = ref<HTMLInputElement | null>(null);
const supportsVision = useChatSupportsVision();

// сохранить черновик уходящего треда, затем восстановить черновик нового
watch(
  threadIdForDraft,
  (threadId, prevThreadId) => {
    if (prevThreadId) {
      const leavingText = textAreaRef.current?.value ?? draftText.value;
      chatThreadsService.setComposerDraft(prevThreadId, {
        draftText: leavingText,
        stagingImages: stagingImages.value,
      });
    }
    const state = chatThreadsService.state.allThreads[threadId]?.state;
    const text = state?.draftText ?? '';
    const images = state?.stagingImages ?? [];
    draftText.value = text;
    stagingImages.value = images;
    instructionsAreEmpty.value = !text;
    composerInitValue.value = text || null;
  },
  { immediate: true },
);

watch(supportsVision, (vision) => {
  if (!vision) {
    if (!stagingImages.value.length) return;
    const text = chatThreadsService.state.allThreads[threadIdForDraft.value]?.state.draftText ?? '';
    chatThreadsService.setComposerDraft(threadIdForDraft.value, {
      draftText: text,
      stagingImages: [],
    });
    stagingImages.value = [];
  }
});

const persistComposerDraft = (text: string, images: ChatImageAttachment[]) => {
  chatThreadsService.setComposerDraft(threadIdForDraft.value, {
    draftText: text,
    stagingImages: images,
  });
};

const setStagingImagesAndPersist = (images: ChatImageAttachment[]) => {
  stagingImages.value = images;
  const text = chatThreadsService.state.allThreads[threadIdForDraft.value]?.state.draftText ?? '';
  chatThreadsService.setComposerDraft(threadIdForDraft.value, {
    draftText: text,
    stagingImages: images,
  });
};

const modelSelection = computed(() => settingsState.value.modelSelectionOfFeature.Chat);
const chatMode = computed(() => settingsState.value.globalSettings.chatMode);
const contextUsage = useChatContextUsage(
  () => previousMessages.value,
  () => chatMode.value,
  () => modelSelection.value,
  () => draftText.value,
  () => stagingImages.value,
  () => currentThread.value?.state.activePlan?.status === 'building',
  () => currentThread.value?.state.enabledMcpServers,
);

const isDisabled = computed(
  () =>
    (instructionsAreEmpty.value && stagingImages.value.length === 0) ||
    !!isFeatureNameDisabled('Chat', settingsState.value),
);

const sidebarRef = ref<HTMLDivElement | null>(null);
const scrollContainerRef: { current: HTMLDivElement | null } = { current: null };

const appendStagingImages = async (files: File[]) => {
  if (!files.length) return;
  const next = await filesToChatImageAttachments(files, stagingImages.value);
  setStagingImagesAndPersist(next);
};

const onPickComposerFiles = () => {
  imageFileInputRef.value?.click();
};

const onComposerFilesPicked = async (files: File[]) => {
  if (!files.length) return;
  const { imageFiles, selections: picked } = await partitionPickedChatFiles(files, {
    fileService,
    languageService,
    includeImages: supportsVision.value,
  });
  if (imageFiles.length) {
    await appendStagingImages(imageFiles);
  }
  for (const item of picked) {
    chatThreadsService.addNewStagingSelection(item);
  }
};

const chatDropZone = useChatDropZone({
  includeImages: supportsVision.value,
  onImages: appendStagingImages,
  onSelections: (items) => {
    for (const item of items) {
      chatThreadsService.addNewStagingSelection(item);
    }
  },
});
const dragOver = computed(() => Boolean(toValue(chatDropZone.isDragOver)));

const onSubmit = async (_forceSubmit?: string) => {
  if (isDisabled.value && !_forceSubmit) return;

  const threadId = chatThreadsService.state.currentThreadId;
  const userMessage = _forceSubmit ?? textAreaRef.current?.value ?? draftText.value ?? '';
  const images = stagingImages.value.length ? stagingImages.value : undefined;
  const currentSelections = selections.value.length ? [...selections.value] : undefined;

  if (!userMessage.trim() && !images?.length) return;

  const clearComposerForThread = () => {
    setSelections([]);
    stagingImages.value = [];
    draftText.value = '';
    instructionsAreEmpty.value = true;
    composerInitValue.value = null;
    chatThreadsService.setComposerDraft(threadId, {
      draftText: '',
      stagingImages: [],
    });
    textAreaFnsRef.current?.setValue('');
  };

  if (isRunning.value) {
    // Follow-up в очередь только при живом агенте (LLM/tool/idle).
    // preparing / stale React — обычный send, иначе мёртвая очередь без bubble.
    const stream = chatThreadsService.streamState[threadId];
    const serviceRunning = stream?.isRunning;
    const serviceInterrupt = stream && 'interrupt' in stream ? stream.interrupt : undefined;
    chatTrace(
      threadId,
      'submit',
      `react=${isRunning.value} service=${serviceRunning ?? 'none'} chars=${userMessage.length}`,
    );
    if (canEnqueueFollowUp(serviceRunning, serviceInterrupt)) {
      chatTrace(threadId, 'submit.enqueue', `service=${serviceRunning}`);
      chatThreadsService.enqueueUserMessage({
        threadId,
        text: userMessage,
        images,
        selections: currentSelections,
      });
      clearComposerForThread();
      textAreaRef.current?.focus();
      return;
    }
  }

  chatTrace(
    threadId,
    'submit.send',
    `react=${isRunning.value ?? 'none'} chars=${userMessage.length}`,
  );

  // Сразу очищаем поле — сообщение появится в ленте до окончания Jira/моста.
  // selections/images уже сняты в локальные константы и уходят в addUserMessage.
  clearComposerForThread();

  try {
    await chatThreadsService.addUserMessageAndStreamResponse({
      userMessage,
      threadId,
      images,
      _chatSelections: currentSelections,
    });
  } catch (e) {
    console.error('Error while sending message in chat:', e);
  }

  // Не трогаем композер другого чата: хвост await после Stop+новый чат
  if (chatThreadsService.state.currentThreadId !== threadId) {
    return;
  }
  textAreaRef.current?.focus();
};

const onAbort = async () => {
  const threadId = currentThread.value.id;
  await chatThreadsService.abortRunning(threadId);
};

const threadId = computed(() => currentThread.value.id);
const currCheckpointIdx = computed(
  () => chatThreadsState.value.allThreads[threadId.value]?.state?.currCheckpointIdx ?? undefined,
);

// привязка textAreaRef к whenMounted (sidebar ↔ agents)
watch(
  () => {
    void chatThreadsState.value;
    const id = threadId.value;
    const mountInfo = chatThreadsState.value.allThreads[id]?.state.mountedInfo;
    return { id, mountInfo, resolved: mountInfo?.mountedIsResolvedRef.current };
  },
  ({ mountInfo }) => {
    if (!mountInfo) return;
    const scrollToBottomFn = () => scrollToBottom(scrollContainerRef);
    if (!mountInfo.mountedIsResolvedRef.current) {
      mountInfo._whenMountedResolver?.({
        textAreaRef,
        scrollToBottom: scrollToBottomFn,
      });
      return;
    }
    // другая поверхность могла уже зарегистрировать mount
    // перепривязываем ref к видимому композеру
    void mountInfo.whenMounted.then((mounted) => {
      mounted.textAreaRef = textAreaRef;
      mounted.scrollToBottom = scrollToBottomFn;
    });
  },
  { immediate: true },
);

const pinnedPlanMessage = computed(() =>
  findPinnedPlanToolMessage(previousMessages.value, currentThread.value?.state.activePlan),
);
const collapsePlanUriFsPath = computed(() =>
  planUriFsPathToCollapseInThread(currentThread.value?.state.activePlan),
);

const lastPauseIdx = computed(() => {
  let idx = -1;
  previousMessages.value.forEach((m, i) => {
    if (m.role === 'assistant' && m.pauseReason) idx = i;
  });
  return idx;
});
const resumedAfterPause = computed(
  () =>
    lastPauseIdx.value >= 0 &&
    previousMessages.value.slice(lastPauseIdx.value + 1).some((m) => m.role === 'user'),
);

const streamingChatIdx = computed(() => previousMessages.value.length);
const showStreamingBubble = computed(
  () => !!(reasoningSoFar.value || displayContentSoFar.value || isRunning.value),
);
const generatingTools = computed(() =>
  toolIsGenerating.value
    ? (toolCallsSoFar.value ?? []).filter((tc) => tc.name === 'edit_file' || tc.name === 'rewrite_file')
    : [],
);

const showThinking = computed(
  () =>
    isRunning.value === 'LLM' ||
    isRunning.value === 'preparing' ||
    (isRunning.value === 'idle' && !toolIsGenerating.value),
);

const onChangeText = (newStr: string) => {
  instructionsAreEmpty.value = !newStr;
  draftText.value = newStr;
  persistComposerDraft(newStr, stagingImages.value);
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    if ((e.metaKey || e.ctrlKey) && isRunning.value) {
      const queue = chatThreadsService.getMessageQueue(threadId.value);
      if (queue.length) {
        e.preventDefault();
        void chatThreadsService.steerQueuedMessage(threadId.value, queue[0].id);
        return;
      }
    }
    e.preventDefault();
    void onSubmit();
  } else if (e.key === 'Escape' && isRunning.value) {
    void onAbort();
  }
};

const onEditQueued = (item: {
  text: string;
  images?: ChatImageAttachment[];
  selections?: StagingSelectionItem[];
}) => {
  const images = item.images ?? [];
  textAreaFnsRef.current?.setValue(item.text);
  instructionsAreEmpty.value = !item.text;
  draftText.value = item.text;
  stagingImages.value = images;
  persistComposerDraft(item.text, images);
  if (item.selections) setSelections(item.selections);
  textAreaRef.current?.focus();
};

const isLandingPage = computed(() => previousMessages.value.length === 0);
const projectName = computed(
  () => accessor.get('IWorkspaceContextService').getWorkspace().folders[0]?.name,
);
const placeholder = computed(() =>
  props.variant === 'agents'
    ? 'Сообщение, / для скиллов, @ для контекста, файлы xlsx, docx, pptx, pdf'
    : supportsVision.value
      ? 'Продолжить… (изображение, xlsx, docx, pptx, pdf)'
      : 'Продолжить… (xlsx, docx, pptx, pdf)',
);

const onComposerPaste = async (e: ClipboardEvent) => {
  if (!supportsVision.value) return;
  const files = imageFilesFromDataTransfer(e.clipboardData);
  if (!files.length) return;
  e.preventDefault();
  await appendStagingImages(files);
};

const onComposerFileInput = async (e: Event) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;
  const files = Array.from(input.files ?? []);
  input.value = '';
  await onComposerFilesPicked(files);
};
</script>

<template>
  <!-- remount при смене треда -->
  <div :key="threadId" class="relative flex h-full min-h-0 w-full flex-col">
    <div
      v-if="isLandingPage && variant === 'agents'"
      ref="sidebarRef"
      class="relative flex min-h-0 w-full flex-1 items-center justify-center px-6"
      @dragenter="chatDropZone.onDragEnter"
      @dragover="chatDropZone.onDragOver"
      @dragleave="chatDropZone.onDragLeave"
      @drop="chatDropZone.onDrop"
    >
      <ChatDropOverlay :visible="dragOver" />
      <div :class="sidePaneOpen ? 'w-full' : 'w-full max-w-[800px]'">
        <div class="mb-4">
          <div class="text-2xl text-void-fg-1">Новый чат</div>
          <div class="text-sm text-void-fg-3 mt-1">
            {{
              projectName
                ? `Проект ${projectName}. Спросите про код, план или правку.`
                : 'Папка проекта не открыта. Спросите про код, план или правку.'
            }}
          </div>
        </div>
        <ErrorBoundary>
          <div>
            <div class="pt-3">
              <div class="flex flex-col">
                <QueuedMessagesPanel :threadId="threadId" :onEditQueued="onEditQueued" />
                <SapphireChatArea
                  featureName="Chat"
                  :onSubmit="() => onSubmit()"
                  :onAbort="onAbort"
                  :isStreaming="!!isRunning"
                  :isDisabled="isDisabled"
                  showSelections
                  :selections="selections"
                  :setSelections="setSelections"
                  :images="stagingImages"
                  :setImages="setStagingImagesAndPersist"
                  :onPickFiles="onPickComposerFiles"
                  :onClickAnywhere="() => textAreaRef.current?.focus()"
                >
                  <input
                    ref="imageFileInputRef"
                    type="file"
                    :accept="chatAttachFileAccept(supportsVision)"
                    multiple
                    class="hidden"
                    @change="onComposerFileInput"
                  />
                  <SapphireInputBox2
                    enableAtToMention
                    class="min-h-[81px] px-0.5 py-0.5"
                    :placeholder="placeholder"
                    :initValue="composerInitValue"
                    :onChangeText="onChangeText"
                    :onKeyDown="onKeyDown"
                    :onPaste="onComposerPaste"
                    :onFocus="() => chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)"
                    :textAreaRef="textAreaRef"
                    :fnsRef="textAreaFnsRef"
                    multiline
                  />
                </SapphireChatArea>
              </div>
            </div>
          </div>
        </ErrorBoundary>
        <div class="pt-4">
          <div class="mb-2 text-sm text-void-fg-3 select-none">Примеры запросов</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="text in SUGGESTED_PROMPTS"
              :key="text"
              type="button"
              class="py-1 px-3 rounded-full text-sm text-void-fg-3 border border-void-border-2 bg-void-bg-2 hover:bg-void-bg-2-alt hover:text-void-fg-1 cursor-pointer"
              @click="onSubmit(text)"
            >
              {{ text }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="isLandingPage"
      ref="sidebarRef"
      class="relative flex min-h-0 w-full flex-1 flex-col px-4"
      @dragenter="chatDropZone.onDragEnter"
      @dragover="chatDropZone.onDragOver"
      @dragleave="chatDropZone.onDragLeave"
      @drop="chatDropZone.onDrop"
    >
      <ChatDropOverlay :visible="dragOver" />
      <div class="min-h-0 flex-1 overflow-auto">
      <ErrorBoundary>
        <div>
          <div class="pt-3">
            <div class="flex flex-col">
              <QueuedMessagesPanel :threadId="threadId" :onEditQueued="onEditQueued" />
              <SapphireChatArea
                featureName="Chat"
                :onSubmit="() => onSubmit()"
                :onAbort="onAbort"
                :isStreaming="!!isRunning"
                :isDisabled="isDisabled"
                showSelections
                :selections="selections"
                :setSelections="setSelections"
                :images="stagingImages"
                :setImages="setStagingImagesAndPersist"
                :onPickFiles="onPickComposerFiles"
                :onClickAnywhere="() => textAreaRef.current?.focus()"
              >
                <input
                  ref="imageFileInputRef"
                  type="file"
                  :accept="chatAttachFileAccept(supportsVision)"
                  multiple
                  class="hidden"
                  @change="onComposerFileInput"
                />
                <SapphireInputBox2
                  enableAtToMention
                  class="min-h-[81px] px-0.5 py-0.5"
                  :placeholder="placeholder"
                  :initValue="composerInitValue"
                  :onChangeText="onChangeText"
                  :onKeyDown="onKeyDown"
                  :onPaste="onComposerPaste"
                  :onFocus="() => chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)"
                  :textAreaRef="textAreaRef"
                  :fnsRef="textAreaFnsRef"
                  multiline
                />
              </SapphireChatArea>
            </div>
          </div>
        </div>
      </ErrorBoundary>

      <ErrorBoundary v-if="Object.keys(chatThreadsState.allThreads).length > 1">
        <!-- блок «Предыдущие чаты», если тредов больше одного -->
        <div class="pt-8 mb-2 text-void-fg-3 text-root select-none pointer-events-none">
          Предыдущие чаты
        </div>
        <PastThreadsList />
      </ErrorBoundary>
      <ErrorBoundary v-else>
        <div class="pt-8 mb-2 text-void-fg-3 text-root select-none pointer-events-none">
          Подсказки
        </div>
        <div class="flex flex-col gap-2 w-full text-nowrap text-void-fg-3 select-none">
          <div
            v-for="text in SUGGESTED_PROMPTS"
            :key="text"
            class="py-1 px-2 rounded text-sm bg-void-bg-2-hover hover:bg-void-bg-2-alt cursor-pointer opacity-80 hover:opacity-100"
            @click="onSubmit(text)"
          >
            {{ text }}
          </div>
        </div>
      </ErrorBoundary>
      </div>
    </div>

    <div
      v-else
      ref="sidebarRef"
      class="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      @dragenter="chatDropZone.onDragEnter"
      @dragover="chatDropZone.onDragOver"
      @dragleave="chatDropZone.onDragLeave"
      @drop="chatDropZone.onDrop"
    >
      <ChatDropOverlay :visible="dragOver" />
      <div
        :class="`flex flex-col flex-1 min-h-0 h-full ${
          variant === 'agents' ? (sidePaneOpen ? 'w-full' : 'w-full max-w-[800px] mx-auto') : 'w-full'
        }`"
      >
        <ErrorBoundary>
          <ScrollToBottomContainer
            :key="`messages${chatThreadsState.currentThreadId}`"
            :scrollContainerRef="scrollContainerRef"
            :style="{ flex: '1 1 auto', minHeight: 0 }"
            :class="`
			flex flex-col
			px-4 py-4 space-y-4
			w-full
			overflow-x-hidden
			overflow-y-auto
			${previousMessages.length === 0 && !displayContentSoFar ? 'hidden' : ''}
		`"
          >
            <ChatBubble
              v-for="(message, i) in previousMessages"
              :key="i"
              :currCheckpointIdx="currCheckpointIdx"
              :chatMessage="message"
              :messageIdx="i"
              isCommitted
              :chatIsRunning="isRunning"
              :threadId="threadId"
              :_scrollToBottom="() => scrollToBottom(scrollContainerRef)"
              :showContinueButton="i === lastPauseIdx && !isRunning && !resumedAfterPause"
              :collapsePlanUriFsPath="collapsePlanUriFsPath"
            />
            <ChatBubble
              v-if="showStreamingBubble"
              key="curr-streaming-msg"
              :currCheckpointIdx="currCheckpointIdx"
              :chatMessage="{
                role: 'assistant',
                displayContent: displayContentSoFar ?? '',
                reasoning: reasoningSoFar ?? '',
              }"
              :messageIdx="streamingChatIdx"
              :isCommitted="false"
              :chatIsRunning="isRunning"
              :threadId="threadId"
              :_scrollToBottom="null"
            />
            <EditToolSoFar
              v-for="(tc, i) in generatingTools"
              :key="`curr-streaming-tool-${tc.id || i}`"
              :toolCallSoFar="tc"
            />
            <ProseWrapper v-if="showThinking">
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 flex-col gap-0.5">
                  <IconLoading class="opacity-50 text-sm" label="Думаю" />
                  <span v-if="statusHint" class="text-[11px] leading-snug text-void-fg-3">
                    {{ statusHint }}
                  </span>
                </div>
                <span
                  v-if="isRunning === 'LLM' && liveTokensPerSecond != null"
                  class="shrink-0 text-right text-[11px] tabular-nums text-void-fg-3"
                >
                  {{ liveTokensPerSecond }} Токенов / сек
                </span>
              </div>
            </ProseWrapper>
            <div v-if="latestError !== undefined" class="px-2 my-1">
              <ErrorDisplay
                :message="latestError.message"
                :fullError="latestError.fullError"
                :onDismiss="() => chatThreadsService.dismissStreamError(currentThread.id)"
                showDismiss
              />
              <WarningBox
                class="text-sm my-2 mx-4"
                :onClick="() => commandService.executeCommand(SAPPHIRE_OPEN_SETTINGS_ACTION_ID)"
                text="Открыть настройки"
              />
            </div>
          </ScrollToBottomContainer>
        </ErrorBoundary>
        <ErrorBoundary>
          <div :key="`input${chatThreadsState.currentThreadId}`" class="px-2 pb-2" :style="{ flex: '0 0 auto' }">
            <div v-if="pinnedPlanMessage" class="px-2 pb-1">
              <ErrorBoundary>
                <PlanToolCard :toolMessage="pinnedPlanMessage" />
              </ErrorBoundary>
            </div>
            <CommandBarInChat />
            <div class="flex flex-col">
              <QueuedMessagesPanel :threadId="threadId" :onEditQueued="onEditQueued" />
              <SapphireChatArea
                featureName="Chat"
                :onSubmit="() => onSubmit()"
                :onAbort="onAbort"
                :isStreaming="!!isRunning"
                :isDisabled="isDisabled"
                showSelections
                :selections="selections"
                :setSelections="setSelections"
                :images="stagingImages"
                :setImages="setStagingImagesAndPersist"
                :onPickFiles="onPickComposerFiles"
                :onClickAnywhere="() => textAreaRef.current?.focus()"
                :contextUsage="contextUsage"
              >
                <input
                  ref="imageFileInputRef"
                  type="file"
                  :accept="chatAttachFileAccept(supportsVision)"
                  multiple
                  class="hidden"
                  @change="onComposerFileInput"
                />
                <SapphireInputBox2
                  enableAtToMention
                  class="min-h-[81px] px-0.5 py-0.5"
                  :placeholder="placeholder"
                  :initValue="composerInitValue"
                  :onChangeText="onChangeText"
                  :onKeyDown="onKeyDown"
                  :onPaste="onComposerPaste"
                  :onFocus="() => chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)"
                  :textAreaRef="textAreaRef"
                  :fnsRef="textAreaFnsRef"
                  multiline
                />
              </SapphireChatArea>
            </div>
          </div>
        </ErrorBoundary>
      </div>
    </div>
    <div class="shrink-0 px-2 pb-1 flex items-center justify-between gap-2">
      <ProjectIndexControls showStatusButton popoverPlacement="top-start" />
      <CopyChatLogButton />
    </div>
  </div>
</template>
