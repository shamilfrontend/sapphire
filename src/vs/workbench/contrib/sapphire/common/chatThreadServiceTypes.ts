/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { SapphireFileSnapshot } from './editCodeServiceTypes.js';
import { LLMUsage, RawToolParamsObj } from './sendLLMMessageTypes.js';
import { ToolCallParams, ToolName, ToolResult } from './toolsServiceTypes.js';

export type ToolMessage<T extends ToolName> = {
  role: 'tool';
  content: string; // текст результата для LLM
  id: string;
  rawParams: RawToolParamsObj;
  mcpServerName: string | undefined; // имя MCP-сервера на момент вызова
  /** Epoch ms старта выполнения tool (старые треды могут не иметь). */
  startedAt?: number;
  /** Длительность выполнения tool, мс (старые треды могут не иметь). */
  durationMs?: number;
} &
  // по порядку событий:
  (
    | { type: 'invalid_params'; result: null; name: T }
    | { type: 'tool_request'; result: null; name: T; params: ToolCallParams<T> } // params проверены, ждём пользователя
    | { type: 'running_now'; result: null; name: T; params: ToolCallParams<T> }
    | { type: 'tool_error'; result: string; name: T; params: ToolCallParams<T> } // ошибка во время выполнения
    | { type: 'success'; result: Awaited<ToolResult<T>>; name: T; params: ToolCallParams<T> }
    | { type: 'rejected'; result: null; name: T; params: ToolCallParams<T> }
  ); // пользователь отклонил

type DecorativeCanceledTool = {
  role: 'interrupted_streaming_tool';
  name: ToolName;
  mcpServerName: string | undefined; // имя MCP-сервера на момент вызова
};

// checkpoint-ы
export type CheckpointEntry = {
  role: 'checkpoint';
  type: 'user_edit' | 'tool_edit';
  sapphireFileSnapshotOfURI: { [fsPath: string]: SapphireFileSnapshot | undefined };

  userModifications: {
    sapphireFileSnapshotOfURI: { [fsPath: string]: SapphireFileSnapshot | undefined };
  };
};

/** Изображение в user-сообщении (OpenAI-compatible image_url data URL). */
export type ChatImageAttachment = {
  id: string;
  mimeType: string; // e.g. image/jpeg, image/png, image/webp
  dataBase64: string; // raw base64 without data: prefix
  width?: number;
  height?: number;
};

/** Placeholder для LLM при пустом content (провайдеры отвергают ''). В UI не показываем. */
export const EMPTY_LLM_MESSAGE = '(empty message)';

/** Убрать API-placeholder'ы — не хранить и не рендерить как текст ассистента. */
const normalizeAssistantDisplayContent = (content: string): string => {
  const trimmed = content.trim();
  if (!trimmed || trimmed === EMPTY_LLM_MESSAGE) {
    return '';
  }
  return content;
};

/**
 * Если ответ только в reasoning — показать его как сообщение.
 * Непустой displayContent оставляет reasoning без изменений.
 * При tool call пустой display не поднимаем из reasoning — пересказ остаётся в свёрнутом блоке.
 */
export const promoteEmptyDisplayFromReasoning = (
  displayContent: string,
  reasoning: string,
  opts?: { hasToolCalls?: boolean },
): { displayContent: string; reasoning: string } => {
  const visible = normalizeAssistantDisplayContent(displayContent);
  if (visible) {
    return { displayContent: visible, reasoning };
  }
  const thought = reasoning.trim();
  if (!thought) {
    return { displayContent: '', reasoning: '' };
  }
  if (opts?.hasToolCalls) {
    return { displayContent: '', reasoning: thought };
  }
  return { displayContent: thought, reasoning: '' };
};

// ВНИМАНИЕ: смена формата — миграция на машинах пользователей, иначе ошибки десериализации.
export type ChatMessage =
  | {
      role: 'user';
      content: string; // для LLM на следующих turn'ах; '' → EMPTY_LLM_MESSAGE
      displayContent: string; // для UI; '' игнорируется
      selections: StagingSelectionItem[] | null; // выбор пользователя (@ / Ctrl+L)
      /** Изображения для vision (glm-5.3-flash). В старых тредах поля нет. */
      images?: ChatImageAttachment[];
      state: {
        stagingSelections: StagingSelectionItem[];
        isBeingEdited: boolean;
      };
    }
  | {
      role: 'assistant';
      displayContent: string; // ответ LLM; '' → EMPTY_LLM_MESSAGE только для API
      reasoning: string; // reasoning-текст для пошагового UI
      /** Usage биллинга шлюза. Нет в старых тредах / при abort. */
      usage?: LLMUsage;
      /** completion_tokens / сек от первого chunk до final. Нет без usage/timing. */
      outputTokensPerSecond?: number;
      /**
       * Мягкая пауза — ждём продолжения от пользователя (не обычный ответ).
       * В старых тредах поля нет.
       */
      pauseReason?: 'stop_repeat';
      /**
       * Подпись «Auto → …» на первом ответе хода. Нет у явной модели и у следующих tool-ходов.
       */
      autoResolvedDisplayName?: string;
    }
  | {
      /** Сохранённый context compaction — заменяет старые turn'ы в LLM и UI. */
      role: 'context_summary';
      content: string; // в LLM на следующих turn'ах
      displayContent: string; // в UI чата
      /** Оценка токенов диалога до compaction (UI). */
      compactedFromTokens?: number;
      /** Оценка размера summary в токенах (UI). */
      compactedToTokens?: number;
    }
  | ToolMessage<ToolName>
  | DecorativeCanceledTool
  | CheckpointEntry;

// элемент staging-selection в «пузыре» чата
export type StagingSelectionItem =
  | {
      type: 'File';
      uri: URI;
      language: string;
      /** Авто-подбор эвристикой (не ручной @ / Ctrl+L). */
      fromHeuristic?: boolean;
    }
  | {
      type: 'CodeSelection';
      range: [number, number];
      uri: URI;
      language: string;
    }
  | {
      type: 'Folder';
      uri: URI;
      language?: undefined;
    };

/** Сообщение в очереди, пока агент занят (эфемерно, не в persist). */
export type QueuedUserMessage = {
  id: string;
  text: string;
  images?: ChatImageAttachment[];
  selections?: StagingSelectionItem[];
};

// ссылка на символ (подчёркнутая ссылка на фрагмент кода)
export type CodespanLocationLink = {
  uri: URI; // сериализацию URI обрабатываем сами
  displayText: string;
  selection?:
    | {
        // храним как JSON — не возимся с сериализацией
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      }
    | undefined;
} | null;
