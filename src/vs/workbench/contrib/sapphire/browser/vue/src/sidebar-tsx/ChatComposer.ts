/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { h, onWatcherCleanup, ref, toValue, watch, type MaybeRefOrGetter, type VNode } from 'vue';
import { Bot, Bug, ListTodo, MessageSquare } from 'lucide-vue-next';
import { useAccessor } from '../util/services.js';
import {
  ChatMode,
  ModelSelection,
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
            if (!cancelled) usage.value = result;
          })
          .catch(() => {
            if (!cancelled) usage.value = null;
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

export const RESERVE_COLOR = '#38BDF8';

export const REASONING_HINT =
  'Режим рассуждений: модель сначала продумывает ответ, затем отвечает. Чем выше уровень — тем тщательнее анализ, но медленнее и больше токенов. Можно выключить.';

export const nameOfChatMode = {
  normal: 'Чат',
  plan: 'Планирование',
  agent: 'Агент',
  debug: 'Отладка',
};

export const detailOfChatMode = {
  normal: 'Обычный чат',
  plan: 'Сначала план, без правок',
  agent: 'Редактирует файлы и использует инструменты',
  debug: 'Систематически ищет и чинит баги по runtime-трейсам',
};

export const accentOfChatMode: Record<ChatMode, { fg: string; bg: string }> = {
  normal: { fg: '#89d185', bg: 'rgba(137, 209, 133, 0.12)' },
  plan: { fg: '#cca700', bg: 'rgba(204, 167, 0, 0.12)' },
  agent: { fg: '#179fff', bg: 'rgba(23, 159, 255, 0.12)' },
  debug: { fg: '#f14c4c', bg: 'rgba(241, 76, 76, 0.12)' },
};

const iconComponentOfChatMode = {
  normal: MessageSquare,
  plan: ListTodo,
  agent: Bot,
  debug: Bug,
} as const;

export const iconOfChatMode = (mode: ChatMode): VNode =>
  h(iconComponentOfChatMode[mode], { size: 14, class: 'stroke-[2]' });
