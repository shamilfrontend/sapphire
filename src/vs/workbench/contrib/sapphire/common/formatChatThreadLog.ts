/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatMessage } from './chatThreadServiceTypes.js';

/** Лимит символов на один tool result / blob в экспортируемом логе. */
export const CHAT_THREAD_LOG_RESULT_CAP = 50_000;

type FormatChatThreadLogOptions = {
  threadId?: string;
  createdAt?: string;
  /** Подмена «сейчас» в тестах. */
  now?: Date;
};

const truncate = (text: string, cap = CHAT_THREAD_LOG_RESULT_CAP): string => {
  if (text.length <= cap) {
    return text;
  }
  return `${text.slice(0, cap)}\n… [обрезано, было ${text.length} символов]`;
};

const formatJsonish = (value: unknown): string => {
  try {
    return truncate(JSON.stringify(value, null, 2) ?? String(value));
  } catch {
    return truncate(String(value));
  }
};

const formatOneMessage = (message: ChatMessage): string => {
  switch (message.role) {
    case 'user': {
      const parts = ['## Пользователь', '', message.displayContent || message.content || '(пусто)'];
      if (message.images?.length) {
        parts.push('', `Вложения: ${message.images.length} изображ.`);
      }
      if (message.selections?.length) {
        const labels = message.selections
          .map((s) => {
            if (s.type === 'File' || s.type === 'Folder') {
              return s.uri.fsPath;
            }
            return `${s.uri.fsPath}:${s.range[0]}-${s.range[1]}`;
          })
          .join(', ');
        parts.push('', `Контекст: ${labels}`);
      }
      return parts.join('\n');
    }
    case 'assistant': {
      const parts = ['## Ассистент'];
      if (message.reasoning.trim()) {
        parts.push('', '### Рассуждение', '', message.reasoning);
      }
      if (message.displayContent.trim()) {
        parts.push('', '### Ответ', '', message.displayContent);
      }
      if (message.pauseReason) {
        parts.push('', `_Пауза: ${message.pauseReason}_`);
      }
      return parts.join('\n');
    }
    case 'tool': {
      const parts = [`## Инструмент: \`${message.name}\``, '', `Тип: ${message.type}`, `id: ${message.id}`];
      if (message.mcpServerName) {
        parts.push(`MCP: ${message.mcpServerName}`);
      }
      if ('params' in message && message.params != null) {
        parts.push('', '### Параметры', '', '```json', formatJsonish(message.params), '```');
      } else if (message.rawParams && Object.keys(message.rawParams).length > 0) {
        parts.push('', '### Параметры (raw)', '', '```json', formatJsonish(message.rawParams), '```');
      }
      if (message.type === 'success' || message.type === 'tool_error') {
        const body =
          typeof message.result === 'string'
            ? truncate(message.result)
            : formatJsonish(message.result);
        parts.push(
          '',
          message.type === 'tool_error' ? '### Ошибка' : '### Результат',
          '',
          '```',
          body,
          '```',
        );
      }
      return parts.join('\n');
    }
    case 'context_summary': {
      return [
        '## Сжатие контекста',
        '',
        message.displayContent || message.content || '(пусто)',
        message.compactedFromTokens != null || message.compactedToTokens != null
          ? `\n_(~${message.compactedFromTokens ?? '?'} → ~${message.compactedToTokens ?? '?'} ток.)_`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'checkpoint': {
      return `## Checkpoint (${message.type})`;
    }
    case 'interrupted_streaming_tool': {
      return `## Инструмент прерван: \`${message.name}\``;
    }
  }
};

/** Сериализация треда в markdown для экспорта (полный reasoning, без пересказа). */
export function formatChatThreadLog(
  messages: readonly ChatMessage[],
  options: FormatChatThreadLogOptions = {},
): string {
  const now = options.now ?? new Date();
  const header = [
    '# Лог чата',
    '',
    options.threadId ? `Тред: \`${options.threadId}\`` : null,
    options.createdAt ? `Создан: ${options.createdAt}` : null,
    `Экспорт: ${now.toISOString()}`,
    `Сообщений: ${messages.length}`,
    '',
    '---',
  ]
    .filter((line) => line !== null)
    .join('\n');

  if (messages.length === 0) {
    return `${header}\n\n_(пусто)_`;
  }

  const body = messages.map(formatOneMessage).join('\n\n---\n\n');
  return `${header}\n\n${body}\n`;
}
