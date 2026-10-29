<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, type Component } from 'vue';
import { ChatMessage, ToolMessage } from '../../../../common/chatThreadServiceTypes.js';
import { isABuiltinToolName } from '../../../../common/prompt/prompts.js';
import { IsRunningType } from '../../../chatThreadService.js';
import { ToolName } from '../../../../common/toolsServiceTypes.js';
import type { ChatMessageLocation } from '../markdown/ChatMarkdownRender.js';
import ChatMarkdownRender from '../markdown/ChatMarkdownRender.vue';
import ErrorBoundary from './ErrorBoundary.vue';
import UserMessageComponent from './UserMessageComponent.vue';
import AssistantMessageComponent from './AssistantMessageComponent.vue';
import ProseWrapper from './ProseWrapper.vue';
import { formatTokenCount } from './ChatComposer.js';
import {
  builtinToolNameToComponent,
  type ResultWrapper,
  MCPToolWrapper,
  InvalidTool,
  CanceledTool,
  PlanToolInlinePlaceholder,
  ToolRequestAcceptRejectButtons,
} from './ChatToolCards.js';
import { shouldCollapsePlanToolInThread } from '../../../../common/planToolPin.js';

const props = defineProps<{
  chatMessage: ChatMessage;
  messageIdx: number;
  isCommitted: boolean;
  chatIsRunning: IsRunningType;
  threadId: string;
  currCheckpointIdx: number | undefined;
  _scrollToBottom: (() => void) | null;
  /** fsPath плана для схлопывания create_plan/update_plan в ленте (пин или building/built). */
  collapsePlanUriFsPath?: string | null;
}>();

const isCheckpointGhost = computed(
  () => props.messageIdx > (props.currCheckpointIdx ?? Infinity) && !props.chatIsRunning,
);

const toolWrapper = computed(() => {
  const message = props.chatMessage;
  if (message.role !== 'tool' || message.type === 'invalid_params') return null;
  const toolName = message.name;
  const isBuiltInTool = isABuiltinToolName(toolName);
  const wrapper = isBuiltInTool
    ? (builtinToolNameToComponent[toolName]?.resultWrapper as ResultWrapper<ToolName> | undefined)
    : (MCPToolWrapper as unknown as ResultWrapper<ToolName>);
  return wrapper ?? null;
});

const summaryHint = computed(() => {
  const message = props.chatMessage;
  if (message.role !== 'context_summary') return null;
  const from = message.compactedFromTokens;
  const to = message.compactedToTokens;
  if (from != null && to != null) return `${formatTokenCount(from)} → ${formatTokenCount(to)}`;
  if (from != null) return `было ~${formatTokenCount(from)}`;
  return null;
});

const summaryLocation = computed<ChatMessageLocation>(() => ({
  threadId: props.threadId,
  messageIdx: props.messageIdx,
}));

const asPlanTool = (message: ChatMessage) =>
  message as ToolMessage<'create_plan'> | ToolMessage<'update_plan'>;

const asComponent = (wrapper: ResultWrapper<ToolName> | null) => wrapper as unknown as Component | null;
</script>

<template>
  <ErrorBoundary>
    <UserMessageComponent
      v-if="
        chatMessage.role === 'user' &&
        !(!chatMessage.displayContent?.trim() && !chatMessage.images?.length)
      "
      :chatMessage="chatMessage"
      :isCheckpointGhost="isCheckpointGhost"
      :currCheckpointIdx="currCheckpointIdx"
      :messageIdx="messageIdx"
      :_scrollToBottom="_scrollToBottom"
    />

    <AssistantMessageComponent
      v-else-if="chatMessage.role === 'assistant'"
      :chatMessage="chatMessage"
      :isCheckpointGhost="isCheckpointGhost"
      :messageIdx="messageIdx"
      :isCommitted="isCommitted"
    />

    <template v-else-if="chatMessage.role === 'tool'">
      <div v-if="chatMessage.type === 'invalid_params'" :class="isCheckpointGhost ? 'opacity-50' : ''">
        <InvalidTool
          :toolName="chatMessage.name"
          :message="chatMessage.content"
          :mcpServerName="chatMessage.mcpServerName"
        />
      </div>
      <div
        v-else-if="shouldCollapsePlanToolInThread(chatMessage, collapsePlanUriFsPath)"
        :class="isCheckpointGhost ? 'opacity-50' : ''"
      >
        <PlanToolInlinePlaceholder :toolMessage="asPlanTool(chatMessage)" />
      </div>
      <template v-else-if="toolWrapper">
        <div :class="isCheckpointGhost ? 'opacity-50' : ''">
          <component
            :is="asComponent(toolWrapper)"
            :toolMessage="chatMessage"
            :messageIdx="messageIdx"
            :threadId="threadId"
          />
        </div>
        <div
          v-if="chatMessage.type === 'tool_request'"
          :class="isCheckpointGhost ? 'opacity-50 pointer-events-none' : ''"
        >
          <ToolRequestAcceptRejectButtons :toolName="chatMessage.name" />
        </div>
      </template>
    </template>

    <div
      v-else-if="chatMessage.role === 'interrupted_streaming_tool'"
      :class="isCheckpointGhost ? 'opacity-50' : ''"
    >
      <CanceledTool :toolName="chatMessage.name" :mcpServerName="chatMessage.mcpServerName" />
    </div>

    <div
      v-else-if="chatMessage.role === 'context_summary'"
      :class="`my-2 rounded-md border border-void-border-2 bg-void-bg-2/60 px-3 py-2 ${isCheckpointGhost ? 'opacity-50' : ''}`"
    >
      <div class="flex items-baseline justify-between gap-2 mb-1">
        <div class="text-[11px] font-medium text-void-fg-2">Сводка контекста</div>
        <div v-if="summaryHint" class="text-[11px] text-void-fg-3 whitespace-nowrap">
          {{ summaryHint }}
        </div>
      </div>
      <ProseWrapper>
        <ChatMarkdownRender
          :string="chatMessage.displayContent || chatMessage.content"
          :chatMessageLocation="summaryLocation"
          :isApplyEnabled="false"
          isLinkDetectionEnabled
        />
      </ProseWrapper>
    </div>
  </ErrorBoundary>
</template>
