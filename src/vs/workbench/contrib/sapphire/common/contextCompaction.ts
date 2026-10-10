/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatMessage } from './chatThreadServiceTypes.js';

/** Compaction, когда заполнение окна контекста ≥ этой доли. */
export const CONTEXT_COMPACTION_THRESHOLD = 0.85;

/** Сколько последних сообщений оставить (tail расширяют, чтобы не резать batch tools). */
export const CONTEXT_COMPACTION_KEEP_RECENT = 8;

/** Префикс summary в wire-сообщении для LLM. */
export const CONTEXT_SUMMARY_LLM_PREFIX = '[CONTEXT SUMMARY]\n';

/** Мин. LLM-relevant сообщений в prefix перед summarization. */
export const CONTEXT_COMPACTION_MIN_PREFIX_MESSAGES = 2;

/** Лимит символов на строку transcript (чтобы запрос summary влез). */
const TRANSCRIPT_LINE_MAX_CHARS = 1_200;

/** Лимит всего transcript для summarizer. */
const TRANSCRIPT_MAX_CHARS = 80_000;

export type CompactionSplit = {
  prefix: ChatMessage[];
  tail: ChatMessage[];
  tailStartIndex: number;
};

export const isLlmRelevantChatMessage = (message: ChatMessage): boolean =>
  message.role === 'user' ||
  message.role === 'assistant' ||
  message.role === 'tool' ||
  message.role === 'context_summary';

const countLlmRelevant = (messages: ChatMessage[]): number =>
  messages.reduce((n, m) => n + (isLlmRelevantChatMessage(m) ? 1 : 0), 0);

/**
 * Сдвинуть начало tail влево, чтобы не разрезать хвост batch tools
 * (tool results без предшествующего assistant).
 */
export const expandTailStartForToolBatch = (
  messages: ChatMessage[],
  tentativeStart: number,
): number => {
  let start = Math.max(0, Math.min(tentativeStart, messages.length));
  while (start > 0) {
    const role = messages[start]?.role;
    if (role === 'tool' || role === 'interrupted_streaming_tool') {
      start -= 1;
      continue;
    }
    break;
  }
  return start;
};

/**
 * Разделить сообщения на prefix (сжимаем) и tail (оставляем).
 * null, если summarization нечего брать.
 */
export const splitMessagesForCompaction = (
  messages: ChatMessage[],
  keepRecent: number = CONTEXT_COMPACTION_KEEP_RECENT,
): CompactionSplit | null => {
  if (messages.length <= keepRecent) {
    return null;
  }

  let tailStart = messages.length - keepRecent;
  tailStart = expandTailStartForToolBatch(messages, tailStart);
  if (tailStart <= 0) {
    return null;
  }

  const prefix = messages.slice(0, tailStart);
  const tail = messages.slice(tailStart);
  if (countLlmRelevant(prefix) < CONTEXT_COMPACTION_MIN_PREFIX_MESSAGES) {
    return null;
  }

  return { prefix, tail, tailStartIndex: tailStart };
};

export const shouldCompactContext = ({
  percentFull,
  messages,
  lastCompactedAtMessageCount,
  threshold = CONTEXT_COMPACTION_THRESHOLD,
  keepRecent = CONTEXT_COMPACTION_KEEP_RECENT,
}: {
  percentFull: number;
  messages: ChatMessage[];
  lastCompactedAtMessageCount: number | undefined;
  threshold?: number;
  keepRecent?: number;
}): boolean => {
  if (percentFull < threshold * 100) {
    return false;
  }
  if (
    lastCompactedAtMessageCount !== undefined &&
    messages.length <= lastCompactedAtMessageCount
  ) {
    return false;
  }
  return splitMessagesForCompaction(messages, keepRecent) !== null;
};

const truncate = (text: string, max: number): string => {
  const t = text.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, Math.max(0, max - 1))}…`;
};

/** Текстовый transcript prefix для summarizer. */
export const buildCompactionTranscript = (prefix: ChatMessage[]): string => {
  const lines: string[] = [];
  for (const msg of prefix) {
    if (msg.role === 'checkpoint' || msg.role === 'interrupted_streaming_tool') {
      continue;
    }
    if (msg.role === 'user') {
      const text = (msg.displayContent || msg.content || '').trim();
      if (!text) {
        continue;
      }
      lines.push(`USER: ${truncate(text, TRANSCRIPT_LINE_MAX_CHARS)}`);
      continue;
    }
    if (msg.role === 'assistant') {
      const text = (msg.displayContent || '').trim();
      if (!text) {
        continue;
      }
      lines.push(`ASSISTANT: ${truncate(text, TRANSCRIPT_LINE_MAX_CHARS)}`);
      continue;
    }
    if (msg.role === 'context_summary') {
      const text = (msg.content || msg.displayContent || '').trim();
      if (!text) {
        continue;
      }
      lines.push(`PRIOR_SUMMARY: ${truncate(text, TRANSCRIPT_LINE_MAX_CHARS)}`);
      continue;
    }
    if (msg.role === 'tool') {
      const params =
        msg.rawParams && typeof msg.rawParams === 'object'
          ? truncate(JSON.stringify(msg.rawParams), 200)
          : '';
      const body = truncate(msg.content || '', TRANSCRIPT_LINE_MAX_CHARS);
      lines.push(
        `TOOL ${msg.name}${params ? ` ${params}` : ''}${body ? `: ${body}` : ''}`.trim(),
      );
    }
  }

  const joined = lines.join('\n');
  if (joined.length <= TRANSCRIPT_MAX_CHARS) {
    return joined;
  }
  return `${joined.slice(0, TRANSCRIPT_MAX_CHARS - 1)}…`;
};

export const CONTEXT_COMPACTION_SYSTEM_PROMPT = `You compress a long coding-agent chat history into a concise handoff summary.
Keep: user goals, decisions made, files/paths touched, commands run, errors and fixes, open tasks, and any plan progress.
Omit: filler, repeated tool dumps, full file contents, and verbatim logs.
Write in the same language the user used. Use short bullets. No preamble.`;

export const buildCompactionUserPrompt = (transcript: string): string =>
  `Summarize the following conversation so another agent can continue without the full history.\n\n---\n${transcript}\n---`;

export const buildContextSummaryMessage = ({
  summaryText,
  compactedFromTokens,
  compactedToTokens,
}: {
  summaryText: string;
  compactedFromTokens?: number;
  compactedToTokens?: number;
}): ChatMessage & { role: 'context_summary' } => {
  const content = summaryText.trim();
  return {
    role: 'context_summary',
    content,
    displayContent: content,
    ...(compactedFromTokens !== undefined ? { compactedFromTokens } : {}),
    ...(compactedToTokens !== undefined ? { compactedToTokens } : {}),
  };
};

/** Content для wire в prepareLLMChatMessages. */
export const contextSummaryToLlmContent = (summary: {
  content: string;
}): string => `${CONTEXT_SUMMARY_LLM_PREFIX}${summary.content}`;

export const applyCompactionReplace = (
  summary: ChatMessage & { role: 'context_summary' },
  tail: ChatMessage[],
): ChatMessage[] => [summary, ...tail];
