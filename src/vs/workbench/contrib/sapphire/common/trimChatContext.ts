/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
  cutTailFreeingTokens,
  estimateMessageTokens,
  estimateTextTokens,
  estimateToolCallTokens,
} from './estimateTokens.js';

/** Нижний предел длины сообщения после trim, если за один проход токенов мало. */
export const TRIM_TO_LEN = 120;

export type TrimableChatMessage =
  | {
      role: 'user';
      content: string;
      images?: readonly unknown[];
    }
  | {
      role: 'assistant';
      content: string;
    }
  | {
      role: 'tool';
      content: string;
      name: string;
      rawParams?: unknown;
    };

/** Оценка токенов одного сообщения (tool = result + args tool_call). */
export function estimateTrimableMessageTokens(message: TrimableChatMessage): number {
  if (message.role === 'user') {
    return estimateMessageTokens({
      content: message.content,
      imageCount: message.images?.length ?? 0,
    });
  }
  if (message.role === 'tool') {
    return (
      estimateMessageTokens({ content: message.content }) +
      estimateToolCallTokens({
        name: message.name,
        argumentsJson: JSON.stringify(message.rawParams ?? {}),
      })
    );
  }
  return estimateMessageTokens({ content: message.content });
}

/**
 * Мутирует `messages[i].content`, пока не освободится ~`tokensToFree` токенов.
 * Приоритет trim: tool 12, assistant 10, user 1.
 * Индекс 0 и последние 4 сообщения защищены (×0.05). System здесь нет.
 */
export function trimMessagesToFreeTokens(
  messages: TrimableChatMessage[],
  tokensToFree: number,
): void {
  let remaining = tokensToFree;
  if (remaining <= 0 || messages.length === 0) {
    return;
  }

  const alreadyTrimmedIdxes = new Set<number>();

  const weight = (message: TrimableChatMessage, idx: number): number => {
    const base = estimateTrimableMessageTokens(message);

    let multiplier = 1 + (messages.length - 1 - idx) / Math.max(1, messages.length); // 2 → 1
    if (message.role === 'user') {
      multiplier *= 1;
    } else if (message.role === 'tool') {
      multiplier *= 12;
    } else {
      multiplier *= 10;
    }

    if (alreadyTrimmedIdxes.has(idx)) {
      multiplier = 0;
    }
    if (idx === 0 || idx >= messages.length - 1 - 3) {
      multiplier *= 0.05;
    }
    return base * multiplier;
  };

  const findLargestByWeight = (): number => {
    let largestIndex = -1;
    let largestWeight = -Infinity;
    for (let i = 0; i < messages.length; i += 1) {
      const w = weight(messages[i], i);
      if (w > largestWeight) {
        largestWeight = w;
        largestIndex = i;
      }
    }
    return largestIndex;
  };

  let i = 0;
  while (remaining > 0) {
    i += 1;
    if (i > 100) {
      break;
    }

    const trimIdx = findLargestByWeight();
    if (trimIdx < 0) {
      break;
    }
    const m = messages[trimIdx];
    const beforeTokens = estimateTextTokens(m.content);
    const minKeep = Math.min(TRIM_TO_LEN, m.content.length);

    const { text: cutText, tokensFreed } = cutTailFreeingTokens(m.content, remaining, minKeep);

    if (tokensFreed >= remaining && cutText.length < m.content.length) {
      m.content = `${cutText.trimEnd()}...`;
      return;
    }

    const collapsed =
      m.content.length <= TRIM_TO_LEN
        ? m.content
        : `${m.content.substring(0, TRIM_TO_LEN - '...'.length)}...`;
    const afterTokens = estimateTextTokens(collapsed);
    remaining -= Math.max(0, beforeTokens - afterTokens);
    m.content = collapsed;
    alreadyTrimmedIdxes.add(trimIdx);
  }
}
