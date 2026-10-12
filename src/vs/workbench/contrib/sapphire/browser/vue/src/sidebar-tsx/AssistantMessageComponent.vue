<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { useAccessor } from '../util/services.js';
import type { ChatMessageLocation } from '../markdown/ChatMarkdownRender.js';
import ChatMarkdownRender from '../markdown/ChatMarkdownRender.vue';
import { ChatMessage, promoteEmptyDisplayFromReasoning } from '../../../../common/chatThreadServiceTypes.js';
import { formatTokenCount } from './ChatComposer.js';
import ProseWrapper from './ProseWrapper.vue';
import SmallProseWrapper from './SmallProseWrapper.vue';
import ReasoningWrapper from './ReasoningWrapper.vue';

const props = defineProps<{
  chatMessage: ChatMessage & { role: 'assistant' };
  isCheckpointGhost: boolean;
  messageIdx: number;
  isCommitted: boolean;
  showContinueButton?: boolean;
}>();

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');

const visibleTurn = computed(() =>
  promoteEmptyDisplayFromReasoning(props.chatMessage.displayContent, props.chatMessage.reasoning ?? ''),
);
const displayContent = computed(() => visibleTurn.value.displayContent);
const reasoningStr = computed(() => visibleTurn.value.reasoning.trim() || null);
const hasReasoning = computed(() => !!reasoningStr.value);
const isDoneReasoning = computed(() => !!displayContent.value);
const thread = computed(() => chatThreadsService.getCurrentThread());
const chatMessageLocation = computed<ChatMessageLocation>(() => ({
  threadId: thread.value.id,
  messageIdx: props.messageIdx,
}));
const isEmpty = computed(() => !displayContent.value && !props.chatMessage.reasoning);

const onContinue = () => {
  void chatThreadsService.addUserMessageAndStreamResponse({
    userMessage: 'продолжай',
    threadId: thread.value.id,
  });
};
</script>

<template>
  <template v-if="!isEmpty">
    <!-- Блок рассуждений -->
    <div v-if="hasReasoning" :class="isCheckpointGhost ? 'opacity-50' : ''">
      <ReasoningWrapper :isDoneReasoning="isDoneReasoning" :isStreaming="!isCommitted">
        <SmallProseWrapper>
          <ChatMarkdownRender
            :string="reasoningStr ?? ''"
            :chatMessageLocation="chatMessageLocation"
            :isApplyEnabled="false"
            isLinkDetectionEnabled
          />
        </SmallProseWrapper>
      </ReasoningWrapper>
    </div>

    <!-- Ответ ассистента -->
    <div v-if="displayContent" :class="isCheckpointGhost ? 'opacity-50' : ''">
      <ProseWrapper>
        <ChatMarkdownRender
          :string="displayContent"
          :chatMessageLocation="chatMessageLocation"
          isApplyEnabled
          isLinkDetectionEnabled
        />
      </ProseWrapper>
      <div v-if="chatMessage.usage" class="mt-1 text-[11px] text-void-fg-3">
        {{ formatTokenCount(chatMessage.usage.prompt_tokens) }} →
        {{ ' ' }}
        {{ formatTokenCount(chatMessage.usage.completion_tokens) }}
        {{ ' · всего ' }}
        {{ formatTokenCount(chatMessage.usage.total_tokens) }}
        {{
          chatMessage.outputTokensPerSecond != null
            ? ` · ${chatMessage.outputTokensPerSecond} Токенов / сек`
            : ''
        }}
      </div>
      <div v-if="showContinueButton && !isCheckpointGhost" class="mt-2 flex justify-end">
        <button
          type="button"
          class="px-2 py-1 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:opacity-90 rounded-sm text-sm font-medium"
          @click="onContinue"
        >
          Продолжить
        </button>
      </div>
    </div>
  </template>
</template>
