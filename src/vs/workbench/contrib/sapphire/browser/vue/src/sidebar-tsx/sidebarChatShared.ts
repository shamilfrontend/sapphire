/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onWatcherCleanup, ref, watch } from 'vue';
import { useSettingsState } from '../util/services.js';
import { getModelCapabilities } from '../../../../common/modelCapabilities.js';
import { ChatMessage } from '../../../../common/chatThreadServiceTypes.js';
import type { Diff } from '../../../../common/editCodeServiceTypes.js';
import { estimateTextTokens, outputTokensPerSecond } from '../../../../common/estimateTokens.js';

export const EMPTY_CHAT_MESSAGES: ChatMessage[] = [];

/** Оценка скорости вывода по растущему тексту; обновляется по таймеру, даже между чанками. */
export const useLiveOutputTokensPerSecond = (
  display: () => string | undefined,
  reasoning: () => string | undefined,
  firstTokenAt: () => number | undefined,
  active: () => boolean,
) => {
  const rate = ref<number | undefined>(undefined);
  const textRef = { current: { display: display() ?? '', reasoning: reasoning() ?? '' } };

  watch(
    () => ({ display: display() ?? '', reasoning: reasoning() ?? '' }),
    (next) => {
      textRef.current = next;
    },
    { immediate: true },
  );

  watch(
    () => [active(), firstTokenAt()] as const,
    ([isActive, startedAt]) => {
      if (!isActive || startedAt == null) {
        rate.value = undefined;
        return;
      }
      const tick = () => {
        const { display: text, reasoning: thought } = textRef.current;
        const tokens = estimateTextTokens(`${text}${thought}`);
        rate.value = outputTokensPerSecond(tokens, startedAt, Date.now());
      };
      tick();
      const id = window.setInterval(tick, 500);
      onWatcherCleanup(() => window.clearInterval(id));
    },
    { immediate: true },
  );

  return rate;
};

export const scrollToBottom = (divRef: { current: HTMLElement | null }) => {
  if (divRef.current) {
    divRef.current.scrollTop = divRef.current.scrollHeight;
  }
};

export const useChatSupportsVision = () => {
  const settingsState = useSettingsState();
  return computed(() => {
    const modelSelection = settingsState.value.modelSelectionOfFeature.Chat;
    if (!modelSelection) return false;
    return !!getModelCapabilities(
      modelSelection.providerName,
      modelSelection.modelName,
      settingsState.value.overridesOfModel,
    ).supportsVision;
  });
};

export const countDiffLineStats = (
  sortedDiffIds: string[] | undefined,
  diffOfId: Record<string, Diff>,
): { added: number; removed: number } => {
  let added = 0;
  let removed = 0;
  if (!sortedDiffIds) return { added, removed };

  for (const diffId of sortedDiffIds) {
    const diff = diffOfId[diffId];
    if (!diff) continue;

    if (diff.type === 'insertion') {
      added += diff.endLine - diff.startLine + 1;
    } else if (diff.type === 'deletion') {
      removed += diff.originalEndLine - diff.originalStartLine + 1;
    } else {
      added += diff.endLine - diff.startLine + 1;
      removed += diff.originalEndLine - diff.originalStartLine + 1;
    }
  }

  return { added, removed };
};

export const filesCountLabel = (count: number) => {
  if (count === 1) return '1 файл';
  if (count > 1 && count < 5) return `${count} файла`;
  return `${count} файлов`;
};

export const SUGGESTED_PROMPTS = [
  'Кратко опиши мой проект',
  'Как устроены типы в Rust?',
  'Создай файл .rules',
];

export const COPY_CHAT_LOG_FEEDBACK_MS = 1600;
