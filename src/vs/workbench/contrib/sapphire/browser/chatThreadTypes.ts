/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ChatFolder } from '../common/chatFolders.js';
import { RawToolCallObj, RawToolParamsObj } from '../common/sendLLMMessageTypes.js';
import { ToolCallParams, ToolName } from '../common/toolsServiceTypes.js';
import {
  ChatImageAttachment,
  ChatMessage,
  CodespanLocationLink,
  StagingSelectionItem,
} from '../common/chatThreadServiceTypes.js';

/*

Store a checkpoint of all "before" files on each x.
x's show up before user messages and LLM edit tool calls.

x     A          (edited A -> A')
(... user modified changes ...)
User message

x     A' B C     (edited A'->A'', B->B', C->C')
LLM Edit
x
LLM Edit
x
LLM Edit


INVARIANT:
A checkpoint appears before every LLM message, and before every user message (before user really means directly after LLM is done).
*/

type UserMessageType = ChatMessage & { role: 'user' };
export type UserMessageState = UserMessageType['state'];
export const defaultMessageState: UserMessageState = {
  stagingSelections: [],
  isBeingEdited: false,
};

// 'thread' — история сообщений чата

export type WhenMounted = {
  textAreaRef: { current: HTMLTextAreaElement | null }; // textarea треда, выставляется в SidebarChat
  scrollToBottom: () => void;
};

export type ThreadType = {
  id: string; // store the id here too
  createdAt: string; // ISO string
  lastModified: string; // ISO string
  /** Режим Агент folder. Absent or null means the chat is ungrouped. */
  folderId?: string | null;
  /** Shown in the pinned section of the Режим Агент sidebar. */
  pinned?: boolean;

  messages: ChatMessage[];

  // не обязательно отдельным state-объектом, но так удобнее
  state: {
    currCheckpointIdx: number | null; // текущий checkpoint (null при стриме или до выбора checkpoint)

    stagingSelections: StagingSelectionItem[];
    focusedMessageIdx: number | undefined; // индекс редактируемого user-сообщения (undefined — нет)

    /** Неотправленный текст композера (переживает переключение вкладок). */
    draftText?: string;
    /** Неотправленные изображения композера (переживают переключение вкладок). */
    stagingImages?: ChatImageAttachment[];

    linksOfMessageIdx: {
      // напр. link = linksOfMessageIdx[4]['RangeFunction']
      [messageIdx: number]: {
        [codespanName: string]: CodespanLocationLink;
      };
    };

    /** Последний план в этом треде (режим Plan → Build). */
    activePlan?: {
      planUriFsPath: string;
      name: string;
      status: 'ready' | 'building' | 'built';
      /** Напр. `2 из 4 · Генератор Excel` — текущий открытый todo во время building. */
      progressLabel?: string;
    };

    /** MCP-серверы, чьи полные схемы уходят в LLM до конца этого треда. */
    enabledMcpServers?: string[];

    /** Оставшиеся tool_calls из multi-tool хода LLM, ждут после паузы на approval. */
    pendingToolCalls?: RawToolCallObj[];

    /** applyBoxId → URI, последний для кнопок Apply (persist при remount React). */
    applyBoxState?: { [applyBoxId: string]: { uri: URI } };

    /**
     * `messages.length` сразу после последней compaction контекста.
     * Не даёт сжимать снова каждый ход, пока тред снова не вырастет.
     */
    lastCompactedAtMessageCount?: number;

    mountedInfo?: {
      whenMounted: Promise<WhenMounted>;
      _whenMountedResolver: (res: WhenMounted) => void;
      mountedIsResolvedRef: { current: boolean };
    };
  };
};

export type ChatThreads = {
  [id: string]: undefined | ThreadType;
};

export type ThreadsState = {
  allThreads: ChatThreads;
  currentThreadId: string; // только для внутреннего использования
  openThreadIds: string[]; // открытые вкладки по порядку; подмножество allThreads
  folders: ChatFolder[];
};

export type PersistedThreadsState = {
  allThreads: ChatThreads;
  openThreadIds: string[];
  folders: ChatFolder[];
};

export type IsRunningType =
  | 'LLM' // LLM сейчас стримит
  | 'tool' // сейчас выполняется tool
  | 'awaiting_user' // ждём ответа/approval пользователя
  | 'preparing' // prep до agent loop (heuristic / selections / Jira) — не follow-up enqueue
  | 'idle' // сейчас ничего не крутится, но UI чата остаётся «в работе» (между вызовами)
  | undefined;

export { canEnqueueFollowUp } from '../common/chatStreamGuards.js';

export type ThreadStreamState = {
  [threadId: string]:
    | undefined
    | {
        isRunning: undefined;
        error?: {
          message: string;
          fullError: Error | null;
          gatewayRetryExhausted?: boolean;
        };
        llmInfo?: undefined;
        toolInfo?: undefined;
        interrupt?: undefined;
        statusHint?: undefined;
      }
    | {
        // пишется ответ ассистента
        isRunning: 'LLM';
        error?: undefined;
        llmInfo: {
          displayContentSoFar: string;
          reasoningSoFar: string;
          toolCallsSoFar: RawToolCallObj[] | null;
          /** Wall-clock первого непустого чанка. Нет, пока не пришли text/reasoning/tool call. */
          firstTokenAt?: number;
        };
        toolInfo?: undefined;
        interrupt: Promise<() => void>; // на state не влияет (иначе путаница) — только отмена tool
        /** Живой статус: retry gateway / ожидание первого токена. */
        statusHint?: string;
      }
    | {
        // выполняется tool
        isRunning: 'tool';
        error?: undefined;
        llmInfo?: undefined;
        toolInfo: {
          toolName: ToolName;
          toolParams: ToolCallParams<ToolName>;
          id: string;
          content: string;
          rawParams: RawToolParamsObj;
          mcpServerName: string | undefined;
        };
        interrupt: Promise<() => void>;
        statusHint?: undefined;
      }
    | {
        isRunning: 'awaiting_user';
        error?: undefined;
        llmInfo?: undefined;
        toolInfo?: undefined;
        interrupt?: undefined;
        statusHint?: undefined;
      }
    | {
        // подготовка сообщения до agent loop
        isRunning: 'preparing';
        error?: undefined;
        llmInfo?: undefined;
        toolInfo?: undefined;
        interrupt: Promise<() => void>;
        statusHint?: string;
      }
    | {
        isRunning: 'idle';
        error?: undefined;
        llmInfo?: undefined;
        toolInfo?: undefined;
        interrupt: 'not_needed' | Promise<() => void>; // на state не влияет (иначе путаница) — только отмена tool
        /** Почему idle (напр. ожидание CHAT_RETRIES агента). */
        statusHint?: string;
      };
};

export interface ChatThreadCollaboratorHost {
  readonly state: ThreadsState;
  readonly streamState: ThreadStreamState;
  [key: string]: any;
}
