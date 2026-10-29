/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { computed, h, onWatcherCleanup, ref, toValue, watch, type MaybeRefOrGetter, type VNode } from 'vue';
import { Bot, ListTodo, MessageSquare } from 'lucide-vue-next';
import { useAccessor, useChatThreadsState, useSettingsState } from '../util/services.js';
import {
  ChatMode,
  ModelSelection,
  resolveThreadChatMode,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import {
  ChatImageAttachment,
  ChatMessage,
} from '../../../../common/chatThreadServiceTypes.js';
import type { ChatContextUsage } from '../../../convertToLLMMessageService.js';

export const formatTokenCount = (n: number): string => {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(n);
};

export const useChatContextUsage = (
  chatMessages: MaybeRefOrGetter<ChatMessage[]>,
  chatMode: MaybeRefOrGetter<ChatMode>,
  modelSelection: MaybeRefOrGetter<ModelSelection | null>,
  draftText: MaybeRefOrGetter<string>,
  draftImages: MaybeRefOrGetter<ChatImageAttachment[]>,
  allowUpdatePlan?: MaybeRefOrGetter<boolean | undefined>,
  enabledMcpServerNames?: MaybeRefOrGetter<readonly string[] | undefined>,
) => {
  const accessor = useAccessor();
  const convertService = accessor.get('IConvertToLLMMessageService');
  const usage = ref<ChatContextUsage | null>(null);

  // Debounce: оценка токенов дорогая — пересчитываем после паузы в наборе.
  watch(
    () =>
      [
        toValue(chatMessages),
        toValue(chatMode),
        toValue(modelSelection),
        toValue(draftText),
        toValue(draftImages),
        toValue(allowUpdatePlan),
        toValue(enabledMcpServerNames),
      ] as const,
    ([messages, mode, selection, text, images, allowPlan, mcpNames]) => {
      let cancelled = false;
      const timer = setTimeout(() => {
        void convertService
          .estimateChatContextUsage({
            chatMessages: messages,
            chatMode: mode,
            modelSelection: selection,
            draftText: text,
            draftImages: images,
            allowUpdatePlan: allowPlan,
            enabledMcpServerNames: mcpNames,
          })
          .then((result) => {
            if (!cancelled) {usage.value = result;}
          })
          .catch(() => {
            if (!cancelled) {usage.value = null;}
          });
      }, 400);
      onWatcherCleanup(() => {
        cancelled = true;
        clearTimeout(timer);
      });
    },
    { immediate: true },
  );

  return usage;
};

/** Режим открытого чата. Смена в другом чате этот computed не двигает. */
export const useCurrentThreadChatMode = () => {
  const settingsState = useSettingsState();
  const threadsState = useChatThreadsState();
  return computed(() => {
    const state = threadsState.value;
    const thread = state.allThreads[state.currentThreadId];
    return resolveThreadChatMode(
      thread?.state.chatMode,
      settingsState.value.globalSettings.chatMode,
    );
  });
};

export const RESERVE_COLOR = '#38BDF8';

export const nameOfChatMode = {
  normal: 'Чат',
  plan: 'Планирование',
  agent: 'Агент',
};

export const detailOfChatMode = {
  normal: 'Обычный чат',
  plan: 'Сначала план, без правок',
  agent: 'Редактирует файлы и использует инструменты',
};

export const accentOfChatMode: Record<ChatMode, { fg: string; bg: string }> = {
  normal: { fg: '#89d185', bg: 'rgba(137, 209, 133, 0.12)' },
  plan: { fg: '#cca700', bg: 'rgba(204, 167, 0, 0.12)' },
  agent: { fg: '#179fff', bg: 'rgba(23, 159, 255, 0.12)' },
};

const iconComponentOfChatMode = {
  normal: MessageSquare,
  plan: ListTodo,
  agent: Bot,
} as const;

export const iconOfChatMode = (mode: ChatMode): VNode =>
  h(iconComponentOfChatMode[mode], { size: 14, class: 'stroke-[2]' });
