/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { LRUCache } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IAccessibilitySignalService } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ChatFolder } from '../common/chatFolders.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { IMCPService } from '../common/mcpService.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import { ChatMode, ModelSelection } from '../common/sapphireSettingsTypes.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { RawToolCallObj, RawToolParamsObj } from '../common/sendLLMMessageTypes.js';
import {
  BuiltinToolCallParams,
  BuiltinToolName,
  BuiltinToolResultType,
  ToolCallParams,
  ToolName,
} from '../common/toolsServiceTypes.js';
import {
  ChatImageAttachment,
  ChatMessage,
  CodespanLocationLink,
  QueuedUserMessage,
  StagingSelectionItem,
} from '../common/chatThreadServiceTypes.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { IAgentArenaService } from './agentArenaService.js';
import { ITerminalToolService } from './terminalToolService.js';

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

    /** Режим этого чата. Нет поля — берётся общий fallback, чтобы старые треды не сменили режим разом. */
    chatMode?: ChatMode;

    /** Модель этого чата. Нет поля — берётся global Chat, чтобы старые треды не сменили модель разом. */
    modelSelection?: ModelSelection;

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
          /** Подпись Auto на первом ходе прогона. Нет у явной модели и у следующих LLM-ходов. */
          autoResolvedDisplayName?: string;
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

/** Встроенные tools, которые коллабораторы вызывают через host. */
type CollaboratorToolsService = {
  readonly validateParams: {
    [T in BuiltinToolName]: (p: RawToolParamsObj) => BuiltinToolCallParams[T];
  };
  readonly callTool: {
    [T in BuiltinToolName]: (p: BuiltinToolCallParams[T]) => Promise<{
      result: BuiltinToolResultType[T] | Promise<BuiltinToolResultType[T]>;
      interruptTool?: () => void;
    }>;
  };
  readonly stringOfResult: {
    [T in BuiltinToolName]: (
      p: BuiltinToolCallParams[T],
      result: Awaited<BuiltinToolResultType[T]>,
    ) => string;
  };
};

export interface ChatThreadCollaboratorHost {
  readonly state: ThreadsState;
  readonly streamState: ThreadStreamState;
  readonly _accessibilitySignalService: IAccessibilitySignalService;
  readonly _configurationService: IConfigurationService;
  readonly _convertToLLMMessagesService: IConvertToLLMMessageService;
  readonly _directoryStringService: IDirectoryStrService;
  readonly _editCodeService: IEditCodeService;
  readonly _editorService: IEditorService;
  readonly _ephemeralThreadIds: Set<string>;
  readonly _fileService: IFileService;
  readonly _flushingQueue: Set<string>;
  readonly _languageFeaturesService: ILanguageFeaturesService;
  readonly _llmMessageService: ILLMMessageService;
  readonly _mcpService: IMCPService;
  readonly _messageQueues: { [threadId: string]: QueuedUserMessage[] };
  readonly _omitAutoActiveFileFsPathOfThread: { [threadId: string]: string | undefined };
  readonly _omitHeuristicFsPathsOfThread: { [threadId: string]: Set<string> | undefined };
  readonly _onDidChangeStreamState: Emitter<{ threadId: string }>;
  readonly _sapphireModelService: ISapphireModelService;
  readonly _settingsService: ISapphireSettingsService;
  readonly _stagingUndoOfThread: {
    [threadId: string]: {
      items: StagingSelectionItem[];
      insertAt: number;
      messageIdx: number | undefined;
    }[];
  };
  readonly _toolsService: CollaboratorToolsService;
  readonly _userModifiedFilesToCheckInCheckpoints: LRUCache<string, string>;
  readonly _workspaceContextService: IWorkspaceContextService;
  readonly _agentArenaService: IAgentArenaService;
  readonly _terminalToolService: ITerminalToolService;

  _addMessageToThread(threadId: string, message: ChatMessage): void;
  _addToolEditCheckpoint(opts: { threadId: string; uri: URI }): void | Promise<void>;
  _addUserCheckpoint(opts: { threadId: string }): void;
  _bumpAgentRunEpoch(threadId: string): number;
  _editMessageInThread(threadId: string, messageIdx: number, newMessage: ChatMessage): void;
  _flushMessageQueue(threadId: string): Promise<void>;
  _isActiveAgentRun(threadId: string, runEpoch: number): boolean;
  _replaceThreadMessages(
    threadId: string,
    messages: ChatMessage[],
    opts?: { markCompacted?: boolean },
  ): void;
  _setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean): void;
  _setStreamState(threadId: string, state: ThreadStreamState[string]): void;
  _setThreadState(
    threadId: string,
    state: Partial<ThreadType['state']>,
    doNotRefreshMountInfo?: boolean,
  ): void;
  _storeAllThreads(threads: ChatThreads, openThreadIds?: string[], folders?: ChatFolder[]): void;
  _withThreadOpened(threadId: string, openThreadIds: string[]): string[];
  _wrapRunAgentToNotify(p: Promise<void>, threadId: string): void;

  abortRunning(threadId: string, opts?: { skipFlush?: boolean }): Promise<void>;
  addUserMessageAndStreamResponse(opts: {
    userMessage: string;
    threadId: string;
    images?: ChatImageAttachment[];
    _chatSelections?: StagingSelectionItem[];
  }): Promise<void>;
  clearMessageQueue(threadId: string): void;
  getCurrentFocusedMessageIdx(): number | undefined;
  getCurrentThread(): ThreadType;
  openNewThread(folderId?: string | null): void;
  setThreadChatMode(threadId: string, chatMode: ChatMode): void;
  setThreadModelSelection(threadId: string, modelSelection: ModelSelection): void;
}
