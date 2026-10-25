/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
  IStorageService,
  StorageScope,
  StorageTarget,
} from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { chat_userMessageContent } from '../common/prompt/prompts.js';
import { ChatFolder, normalizeChatFolders } from '../common/chatFolders.js';
import { getErrorMessage } from '../common/sendLLMMessageTypes.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import { ChatMode } from '../common/sapphireSettingsTypes.js';
import {
  isChatPrepTimeoutError,
  SAPPHIRE_CHAT_HEURISTIC_TIMEOUT_MS,
  SAPPHIRE_CHAT_PREP_TIMEOUT_MS,
  racePrepAwait,
} from '../common/chatPrepGuard.js';
import { chatTrace } from '../common/chatSendTrace.js';
import { IToolsService } from './toolsService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import {
  ChatImageAttachment,
  CodespanLocationLink,
  QueuedUserMessage,
  StagingSelectionItem,
} from '../common/chatThreadServiceTypes.js';
import { IHeuristicFileRetrieveService } from './heuristicFileRetrieveService.js';
import { ChatThreadAgentLoop } from './chatThreadAgentLoop.js';
import { ChatThreadCheckpoints } from './chatThreadCheckpoints.js';
import { ChatThreadCodespanLinks } from './chatThreadCodespanLinks.js';
import { ChatThreadLibrary } from './chatThreadLibrary.js';
import { ChatThreadQueue } from './chatThreadQueue.js';
import { ChatThreadStaging } from './chatThreadStaging.js';
import {
  ChatThreadCollaboratorHost,
  ChatThreads,
  defaultMessageState,
  PersistedThreadsState,
  ThreadStreamState,
  ThreadsState,
  ThreadType,
  UserMessageState,
  WhenMounted,
} from './chatThreadTypes.js';
export type {
  IsRunningType,
  ThreadStreamState,
  ThreadsState,
  ThreadType,
} from './chatThreadTypes.js';
export { canEnqueueFollowUp } from '../common/chatStreamGuards.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { findLast } from '../../../../base/common/arraysFind.js';
import { LRUCache } from '../../../../base/common/map.js';
import { rememberFirstBefore } from '../common/manualEditCheckpoint.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import {
  INotificationService,
  Severity,
} from '../../../../platform/notification/common/notification.js';
import { truncate } from '../../../../base/common/strings.js';
import { THREAD_STORAGE_KEY } from '../common/storageKeys.js';
import { normalizeThreadsFromStorage } from '../common/normalizeChatThreads.js';
import { sanitizeThreadsForPersist } from '../common/sanitizePersistedThreads.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IOfficeExtractService } from '../common/officeExtractService.js';
import { IMCPService } from '../common/mcpService.js';
import { IAccessibilitySignalService } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
export interface IChatThreadService {
  readonly _serviceBrand: undefined;

  readonly state: ThreadsState;
  readonly streamState: ThreadStreamState; // не сохраняется в storage

  onDidChangeCurrentThread: Event<void>;
  onDidChangeStreamState: Event<{ threadId: string }>;
  onDidRequestShowHistory: Event<void>;

  getCurrentThread(): ThreadType;
  openNewThread(folderId?: string | null): void;
  switchToThread(threadId: string): void;
  openTab(threadId: string): void;
  closeTab(threadId: string): void;
  requestShowHistory(): void;

  // управление тредами в селекторе
  deleteThread(threadId: string): void;
  duplicateThread(threadId: string): void;

  createFolder(name: string, parentId: string | null): string;
  renameFolder(folderId: string, name: string): void;
  deleteFolder(folderId: string): void;
  moveThreadToFolder(threadId: string, folderId: string | null): void;
  moveFolder(folderId: string, newParentId: string | null): void;
  /** Переместить папку перед соседом; `beforeSiblingId === null` — в конец списка. */
  reorderFolder(folderId: string, beforeSiblingId: string | null): void;
  setThreadPinned(threadId: string, pinned: boolean): void;

  /** Сжатая история других вкладок для инструмента get_chat_history. */
  getChatHistorySummary(opts?: { threadId?: string | null }): string;

  // геттеры/сеттеры UI
  // все относятся к текущему треду
  getCurrentMessageState: (messageIdx: number) => UserMessageState;
  setCurrentMessageState: (messageIdx: number, newState: Partial<UserMessageState>) => void;
  getCurrentThreadState: () => ThreadType['state'];
  setCurrentThreadState: (newState: Partial<ThreadType['state']>) => void;
  /** Режим только этого чата. Не пишет globalSettings.chatMode. */
  setThreadChatMode: (threadId: string, chatMode: ChatMode) => void;
  /** Тихо сохранить черновик композера (без notify/remount). */
  setComposerDraft: (
    threadId: string,
    draft: { draftText?: string; stagingImages?: ChatImageAttachment[] },
  ) => void;

  // Редактируется одно «сфокусированное» сообщение; cmd+L добавляет selection именно в него.
  getCurrentFocusedMessageIdx(): number | undefined;
  isCurrentlyFocusingMessage(): boolean;
  setCurrentlyFocusedMessageIdx(messageIdx: number | undefined): void;

  popStagingSelections(numPops?: number): void;
  removeStagingSelectionAt(index: number, messageIdx?: number): void;
  undoStagingPop(): boolean;
  addNewStagingSelection(newSelection: StagingSelectionItem): void;

  /** Эфемерно: не автоприкреплять активный файл при следующей отправке в этом треде. */
  omitAutoActiveFileForNextSend(fsPath: string): void;
  clearOmitAutoActiveFile(): void;
  getOmitAutoActiveFileFsPath(): string | undefined;

  /** Эфемерно: не подтягивать эвристикой этот path при следующей отправке. */
  omitHeuristicFileForNextSend(fsPath: string): void;
  clearOmitHeuristicFiles(): void;
  getOmitHeuristicFileFsPaths(): ReadonlySet<string>;

  dangerousSetState: (newState: ThreadsState) => void;
  resetState: () => void;

  // // staging selections текущего треда (закомментированный API)
  // closeCurrentStagingSelectionsInMessage(opts: { messageIdx: number }): void;
  // closeCurrentStagingSelectionsInThread(): void;

  // codespan-ссылки на символы в markdown
  getCodespanLink(opts: {
    codespanStr: string;
    messageIdx: number;
    threadId: string;
  }): CodespanLocationLink | undefined;
  addCodespanLink(opts: {
    newLinkText: string;
    newLinkLocation: CodespanLocationLink;
    messageIdx: number;
    threadId: string;
  }): void;
  generateCodespanLink(opts: {
    codespanStr: string;
    threadId: string;
  }): Promise<CodespanLocationLink>;
  getRelativeStr(uri: URI): string | undefined;

  // очередь сообщений (эфемерная, пока агент работает)
  getMessageQueue(threadId: string): QueuedUserMessage[];
  enqueueUserMessage(opts: {
    threadId: string;
    text: string;
    images?: ChatImageAttachment[];
    selections?: StagingSelectionItem[];
  }): QueuedUserMessage;
  removeQueuedMessage(threadId: string, queuedId: string): QueuedUserMessage | undefined;
  updateQueuedMessage(
    threadId: string,
    queuedId: string,
    patch: Partial<Pick<QueuedUserMessage, 'text' | 'images' | 'selections'>>,
  ): void;
  /** Прервать текущий прогон и сразу отправить сообщение из очереди (Steer). */
  steerQueuedMessage(threadId: string, queuedId: string): Promise<void>;
  clearMessageQueue(threadId: string): void;

  // точки входа для UI
  abortRunning(threadId: string, opts?: { skipFlush?: boolean }): Promise<void>;
  dismissStreamError(threadId: string): void;

  // редактирование сообщения и новый прогон
  editUserMessageAndStreamResponse({
    userMessage,
    messageIdx,
    threadId,
    images,
  }: {
    userMessage: string;
    messageIdx: number;
    threadId: string;
    images?: ChatImageAttachment[];
  }): Promise<void>;

  // новое сообщение пользователя и стрим ответа
  addUserMessageAndStreamResponse({
    userMessage,
    threadId,
    images,
    _chatSelections,
  }: {
    userMessage: string;
    threadId: string;
    images?: ChatImageAttachment[];
    _chatSelections?: StagingSelectionItem[];
  }): Promise<void>;

  // одобрение/отклонение tool
  approveLatestToolRequest(threadId: string): void;
  rejectLatestToolRequest(threadId: string): void;

  /** Режим Plan → Agent и реализация активного плана. */
  buildActivePlan(threadId: string): Promise<void>;

  // переход к checkpoint в истории
  jumpToCheckpointBeforeMessageIdx(opts: {
    threadId: string;
    messageIdx: number;
    jumpToUserModified: boolean;
  }): void;

  /** Сохранить/прочитать URI для кнопки Apply (переживает remount React). */
  setApplyBoxUri(applyBoxId: string, uri: URI | undefined): void;
  getApplyBoxUri(applyBoxId: string): URI | undefined;

  focusCurrentChat: () => Promise<void>;
  blurCurrentChat: () => Promise<void>;
}

export const IChatThreadService = createDecorator<IChatThreadService>('sapphireChatThreadService');
class ChatThreadService extends Disposable implements IChatThreadService {
  private _agentLoop!: ChatThreadAgentLoop;
  private _checkpoints!: ChatThreadCheckpoints;
  private _queue!: ChatThreadQueue;
  private _codespanLinks!: ChatThreadCodespanLinks;
  private _library!: ChatThreadLibrary;
  private _staging!: ChatThreadStaging;

  _serviceBrand: undefined;

  // Срабатывает при любом изменении текущего треда (переключение, новое сообщение и т.д.)
  private readonly _onDidChangeCurrentThread = new Emitter<void>();

  readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

  private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();

  readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

  private readonly _onDidRequestShowHistory = new Emitter<void>();

  readonly onDidRequestShowHistory: Event<void> = this._onDidRequestShowHistory.event;

  readonly streamState: ThreadStreamState = {};

  /** Эфемерная очередь сообщений по threadId (не в storage). */
  private readonly _messageQueues: { [threadId: string]: QueuedUserMessage[] } = {};
  private readonly _flushingQueue = new Set<string>();
  /** Увеличивается при abort/новом прогоне — устаревший loop не затирает следующий (Steer). */
  private readonly _agentRunEpoch: { [threadId: string]: number } = {};
  /** Скрытые дочерние треды run_subagent — только в памяти, не персистятся. */
  readonly _ephemeralThreadIds = new Set<string>();

  /** Эфемерный undo для staging-чипов (Backspace / крестик). Не в storage. */
  private readonly _stagingUndoOfThread: {
    [threadId: string]: {
      items: StagingSelectionItem[];
      insertAt: number;
      messageIdx: number | undefined;
    }[];
  } = {};

  /** Эфемерно: не автоприкреплять fsPath при следующей отправке (на тред). */
  private readonly _omitAutoActiveFileFsPathOfThread: { [threadId: string]: string | undefined } =
    {};

  /** Эфемерно: не эвристически подтягивать эти fsPaths при следующей отправке. */
  private readonly _omitHeuristicFsPathsOfThread: { [threadId: string]: Set<string> } = {};

  state: ThreadsState; // allThreads, openThreadIds, folders — в storage; currentThreadId — нет отдельно

  // Checkpoint: снимок текста до первой ручной правки файла (до следующего checkpoint)
  private readonly _userModifiedFilesToCheckInCheckpoints = new LRUCache<string, string>(50);

  /** Throttle persist тредов — не JSON.stringify на каждое сообщение. */
  private _persistTimer: ReturnType<typeof setTimeout> | undefined;
  private _pendingPersistPayload: PersistedThreadsState | null = null;
  private static readonly THREAD_PERSIST_DEBOUNCE_MS = 400;

  constructor(
    @IStorageService private readonly _storageService: IStorageService,
    @ISapphireModelService private readonly _sapphireModelService: ISapphireModelService,
    @ILLMMessageService public readonly _llmMessageService: ILLMMessageService,
    @IToolsService private readonly _toolsService: IToolsService,
    @ISapphireSettingsService private readonly _settingsService: ISapphireSettingsService,
    @ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
    @IEditCodeService private readonly _editCodeService: IEditCodeService,
    @INotificationService private readonly _notificationService: INotificationService,
    @IConvertToLLMMessageService
    public readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
    @IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
    @IDirectoryStrService private readonly _directoryStringService: IDirectoryStrService,
    @IFileService private readonly _fileService: IFileService,
    @IMCPService public readonly _mcpService: IMCPService,
    @IAccessibilitySignalService
    public readonly _accessibilitySignalService: IAccessibilitySignalService,
    @IConfigurationService public readonly _configurationService: IConfigurationService,
    @IEditorService private readonly _editorService: IEditorService,
    @IHeuristicFileRetrieveService
    private readonly _heuristicFileRetrieveService: IHeuristicFileRetrieveService,
    @IOfficeExtractService private readonly _officeExtractService: IOfficeExtractService,
  ) {
    super();
    const host = this as unknown as ChatThreadCollaboratorHost;
    this._agentLoop = new ChatThreadAgentLoop(host);
    this._checkpoints = new ChatThreadCheckpoints(host);
    this._queue = new ChatThreadQueue(host);
    this._codespanLinks = new ChatThreadCodespanLinks(host);
    this._library = new ChatThreadLibrary(host);
    this._staging = new ChatThreadStaging(host);
    // Collaborator-модули читают поля через host; void — чтобы TypeScript не ругался на noUnusedLocals.
    void this._messageQueues;
    void this._flushingQueue;
    void this._stagingUndoOfThread;
    void this._sapphireModelService;
    void this._toolsService;
    void this._languageFeaturesService;
    void this._workspaceContextService;
    void this._editorService;

    this.state = {
      allThreads: {},
      currentThreadId: null as unknown as string,
      openThreadIds: [],
      folders: [],
    }; // начальное состояние до hydrate

    const { allThreads, openThreadIds: storedOpenThreadIds, folders } = this._readPersistedState();
    const openThreadIds = storedOpenThreadIds.filter((id) => !!allThreads[id]);

    this.state = {
      allThreads,
      currentThreadId: null as unknown as string, // задаётся ниже
      openThreadIds,
      folders,
    };

    if (openThreadIds.length > 0) {
      // Восстанавливаем последнюю изменённую открытую вкладку
      const currentThreadId = [...openThreadIds].sort((a, b) =>
        (allThreads[a]?.lastModified ?? '') > (allThreads[b]?.lastModified ?? '') ? -1 : 1,
      )[0];
      this._setState({ currentThreadId });
    } else {
      // Всегда должен быть активный тред
      this.openNewThread();
    }

    this._register(
      this._editCodeService.onDidUserChangeContent(({ uri, beforeEntireFileCode }) => {
        rememberFirstBefore(
          this._userModifiedFilesToCheckInCheckpoints,
          uri.fsPath,
          beforeEntireFileCode,
        );
      }),
    );

    this._register({
      dispose: () => {
        if (this._persistTimer !== undefined) {
          clearTimeout(this._persistTimer);
          this._persistTimer = undefined;
        }
        this._flushThreadPersist();
      },
    });
  }

  async focusCurrentChat() {
    const threadId = this.state.currentThreadId;
    const thread = this.state.allThreads[threadId];
    if (!thread) {return;}
    const s = await thread.state.mountedInfo?.whenMounted;
    if (!this.isCurrentlyFocusingMessage()) {
      s?.textAreaRef.current?.focus();
    }
  }

  async blurCurrentChat() {
    const threadId = this.state.currentThreadId;
    const thread = this.state.allThreads[threadId];
    if (!thread) {return;}
    const s = await thread.state.mountedInfo?.whenMounted;
    if (!this.isCurrentlyFocusingMessage()) {
      s?.textAreaRef.current?.blur();
    }
  }

  dangerousSetState = (newState: ThreadsState) => {
    const openThreadIdsRaw = newState.openThreadIds ?? [];
    const openThreadIds = newState.currentThreadId
      ? this._withThreadOpened(newState.currentThreadId, openThreadIdsRaw)
      : openThreadIdsRaw;
    this.state = {
      ...newState,
      openThreadIds,
      folders: newState.folders ?? this.state.folders ?? [],
    };
    this._onDidChangeCurrentThread.fire();
  };

  resetState = () => {
    this.state = {
      allThreads: {},
      currentThreadId: null as unknown as string,
      openThreadIds: [],
      folders: [],
    }; // как в constructor
    this.openNewThread();
    this._onDidChangeCurrentThread.fire();
  };

  requestShowHistory(): void {
    this._onDidRequestShowHistory.fire();
  }

  // Важно для revive URI из JSON storage ($mid)
  // Можно было бы взять marshalling.ts, но здесь достаточно reviver в JSON.parse
  private _convertThreadDataFromStorage(threadsStr: string): unknown {
    return JSON.parse(threadsStr, (key, value) => {
      if (value && typeof value === 'object' && value.$mid === 1) {
        // $mid — MarshalledId; $mid === 1 означает URI
        return URI.revive(value);
      }
      return value;
    });
  }

  private _isPersistedThreadsState(data: unknown): data is PersistedThreadsState {
    return (
      !!data &&
      typeof data === 'object' &&
      'allThreads' in data &&
      typeof (data as PersistedThreadsState).allThreads === 'object'
    );
  }

  private _readPersistedState(): PersistedThreadsState {
    const threadsStr = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION);
    if (!threadsStr) {
      return { allThreads: {}, openThreadIds: [], folders: [] };
    }
    const parsed = this._convertThreadDataFromStorage(threadsStr);
    if (this._isPersistedThreadsState(parsed)) {
      const stored = parsed as PersistedThreadsState & { folders?: unknown };
      return {
        allThreads: this._normalizeThreadsFromStorage(parsed.allThreads ?? {}),
        openThreadIds: Array.isArray(parsed.openThreadIds) ? parsed.openThreadIds : [],
        folders: normalizeChatFolders(stored.folders),
      };
    }
    // Старый формат: только map allThreads без openThreadIds/folders
    return {
      allThreads: this._normalizeThreadsFromStorage((parsed as ChatThreads) ?? {}),
      openThreadIds: [],
      folders: [],
    };
  }

  /** Убрать устаревшие поля и гарантировать messages[] / state после JSON hydrate. */
  private _normalizeThreadsFromStorage(threads: ChatThreads): ChatThreads {
    return normalizeThreadsFromStorage(threads) as ChatThreads;
  }

  /** Запись тредов в APPLICATION storage; эфемерные subagent-треды пропускаем. */
  private _storeAllThreads(
    threads: ChatThreads,
    openThreadIds: string[] = this.state.openThreadIds,
    folders: ChatFolder[] = this.state.folders,
  ) {
    const allThreads: ChatThreads = {};
    for (const id of Object.keys(threads)) {
      if (this._ephemeralThreadIds.has(id)) {
        continue;
      }
      const thread = threads[id];
      if (!thread) {
        continue;
      }
      // mountedInfo — promise/resolver; в storage не нужен и ломает JSON.stringify.
      if (thread.state.mountedInfo) {
        const { mountedInfo: _drop, ...restState } = thread.state;
        allThreads[id] = { ...thread, state: restState };
      } else {
        allThreads[id] = thread;
      }
    }
    this._pendingPersistPayload = {
      allThreads: sanitizeThreadsForPersist(allThreads),
      openThreadIds: openThreadIds.filter((id) => !this._ephemeralThreadIds.has(id)),
      folders,
    };
    if (this._persistTimer === undefined) {
      this._persistTimer = setTimeout(() => {
        this._persistTimer = undefined;
        this._flushThreadPersist();
      }, ChatThreadService.THREAD_PERSIST_DEBOUNCE_MS);
    }
  }

  private _flushThreadPersist() {
    const payload = this._pendingPersistPayload;
    if (!payload) {
      return;
    }
    this._pendingPersistPayload = null;
    this._storageService.store(
      THREAD_STORAGE_KEY,
      JSON.stringify(payload),
      StorageScope.APPLICATION,
      StorageTarget.USER,
    );
  }

  private _withThreadOpened(threadId: string, openThreadIds: string[]): string[] {
    if (openThreadIds.includes(threadId)) {
      return openThreadIds;
    }
    return [...openThreadIds, threadId];
  }

  // Единственное место присваивания this.state (кроме constructor), кроме dangerousSetState
  private _setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean) {
    const newState: ThreadsState = {
      ...this.state,
      ...state,
      openThreadIds: state.openThreadIds ?? this.state.openThreadIds ?? [],
      folders: state.folders ?? this.state.folders ?? [],
    };

    this.state = newState;

    this._onDidChangeCurrentThread.fire();

    // После переключения треда синхронизируем streamState с последним сообщением (после рестарта IDE)
    const threadId = newState.currentThreadId;
    const streamState = this.streamState[threadId];
    if (streamState?.isRunning === undefined && !streamState?.error) {
      const messages = newState.allThreads[threadId]?.messages;
      const lastMessage = messages && messages[messages.length - 1];
      // tool_request без streamState — показываем awaiting_user
      if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'tool_request')
        {this._setStreamState(threadId, { isRunning: 'awaiting_user' });}

      // running_now после рестарта — помечаем rejected, иначе UI «зависнет» на tool
      if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'running_now') {
        this._updateLatestTool(threadId, {
          role: 'tool',
          type: 'rejected',
          content: lastMessage.content,
          id: lastMessage.id,
          rawParams: lastMessage.rawParams,
          result: null,
          name: lastMessage.name,
          params: lastMessage.params,
          mcpServerName: lastMessage.mcpServerName,
        });
      }
    }

    // Обновляем promise whenMounted для React (если не suppress через doNotRefreshMountInfo)
    if (doNotRefreshMountInfo) {return;}

    let whenMountedResolver: (w: WhenMounted) => void;
    const whenMountedPromise = new Promise<WhenMounted>((res) => (whenMountedResolver = res));

    this._setThreadState(
      threadId,
      {
        mountedInfo: {
          whenMounted: whenMountedPromise,
          mountedIsResolvedRef: { current: false },
          _whenMountedResolver: (w: WhenMounted) => {
            whenMountedResolver(w);
            const mountInfo = this.state.allThreads[threadId]?.state.mountedInfo;
            if (mountInfo) {mountInfo.mountedIsResolvedRef.current = true;}
          },
        },
      },
      true,
    ); // _setThreadState(..., true) — без лишнего _setState
  }

  /** Эфемерное состояние стрима по threadId (не в storage). */
  private _setStreamState(threadId: string, state: ThreadStreamState[string]) {
    const prev = this.streamState[threadId]?.isRunning;
    this.streamState[threadId] = state;
    const next = state?.isRunning;
    if (prev !== next) {
      const hint = state && Object.hasOwn(state, 'statusHint') && state.statusHint ? ` hint=${state.statusHint}` : '';
      chatTrace(threadId, 'stream', `${prev ?? 'none'} -> ${next ?? 'none'}${hint}`);
    }
    this._onDidChangeStreamState.fire({ threadId });
  }

  /** Инкремент «поколения» прогона агента для защиты от гонок abort/Steer. */
  _bumpAgentRunEpoch(threadId: string): number {
    const next = (this._agentRunEpoch[threadId] ?? 0) + 1;
    this._agentRunEpoch[threadId] = next;
    return next;
  }

  /** true, если runEpoch всё ещё актуален (не было abort/нового прогона). */
  _isActiveAgentRun(threadId: string, runEpoch: number): boolean {
    return this._agentRunEpoch[threadId] === runEpoch;
  }

  getMessageQueue(threadId: string): QueuedUserMessage[] {
    return this._queue.getMessageQueue(threadId);
  }

  enqueueUserMessage(opts: {
    threadId: string;
    text: string;
    images?: ChatImageAttachment[];
    selections?: StagingSelectionItem[];
  }): QueuedUserMessage {
    return this._queue.enqueueUserMessage(opts);
  }

  removeQueuedMessage(threadId: string, queuedId: string): QueuedUserMessage | undefined {
    return this._queue.removeQueuedMessage(threadId, queuedId);
  }

  updateQueuedMessage(
    threadId: string,
    queuedId: string,
    patch: Partial<Pick<QueuedUserMessage, 'text' | 'images' | 'selections'>>,
  ): void {
    this._queue.updateQueuedMessage(threadId, queuedId, patch);
  }

  clearMessageQueue(threadId: string): void {
    this._queue.clearMessageQueue(threadId);
  }

  async steerQueuedMessage(threadId: string, queuedId: string): Promise<void> {
    return this._queue.steerQueuedMessage(threadId, queuedId);
  }

  async _flushMessageQueue(threadId: string): Promise<void> {
    return this._queue._flushMessageQueue(threadId);
  }

  /** Уведомление, если прогон завершился в фоновой вкладке; сброс «залипшего» streamState при ошибке. */
  private _wrapRunAgentToNotify(p: Promise<void>, threadId: string) {
    const notify = ({ error }: { error: string | null }) => {
      const thread = this.state.allThreads[threadId];
      if (!thread) {return;}
      const userMsg = findLast(thread.messages, (m) => m.role === 'user');
      if (!userMsg) {return;}
      if (userMsg.role !== 'user') {return;}
      const messageContent = truncate(userMsg.displayContent, 50, '...');

      this._notificationService.notify({
        severity: error ? Severity.Warning : Severity.Info,
        message: error ? `Error: ${error} ` : `A new Chat result is ready.`,
        source: messageContent,
        sticky: true,
        actions: {
          primary: [
            {
              id: 'sapphire.goToChat',
              enabled: true,
              label: `Jump to Chat`,
              tooltip: '',
              class: undefined,
              run: () => {
                this.switchToThread(threadId);
                // прокрутка вниз
                this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then((m) => {
                  m.scrollToBottom();
                });
              },
            },
          ],
        },
      });
    };

    p.then(() => {
      if (threadId !== this.state.currentThreadId) {notify({ error: null });}
    }).catch((e) => {
      this._clearStuckAgentStreamState(threadId, {
        message: getErrorMessage(e),
        fullError: e instanceof Error ? e : null,
      });
      if (threadId !== this.state.currentThreadId) {notify({ error: getErrorMessage(e) });}
    });
  }

  dismissStreamError(threadId: string): void {
    this._setStreamState(threadId, undefined);
  }

  private async _addUserMessageAndStreamResponse({
    userMessage,
    _chatSelections,
    threadId,
    images,
    skipAutoAttach,
  }: {
    userMessage: string;
    _chatSelections?: StagingSelectionItem[];
    threadId: string;
    images?: ChatImageAttachment[];
    /** При редактировании прошлого сообщения — не мержить активный файл. */
    skipAutoAttach?: boolean;
  }) {
    const thread = this.state.allThreads[threadId];
    if (!thread) {return;} // invariant

    // Новая отправка прерывает текущий стрим/агента
    const runningBefore = this.streamState[threadId]?.isRunning;
    chatTrace(
      threadId,
      'send',
      `chars=${userMessage.length} running=${runningBefore ?? 'none'} epoch=${this._agentRunEpoch[threadId] ?? 0}`,
    );
    if (runningBefore) {
      chatTrace(threadId, 'send.abort-previous', String(runningBefore));
      await this.abortRunning(threadId);
    }

    // Общий epoch для подготовки и agent loop — Stop инвалидирует оба.
    const prepEpoch = this._bumpAgentRunEpoch(threadId);
    const isPrepActive = () => this._isActiveAgentRun(threadId, prepEpoch);
    const prepCts = new CancellationTokenSource();
    const cancelPrep = () => {
      prepCts.cancel();
    };
    /** Prep до agent loop — отдельный state, чтобы follow-up не уходил в мёртвую очередь. */
    const setPreparing = (statusHint?: string) => {
      if (!isPrepActive()) {
        return;
      }
      this._setStreamState(threadId, {
        isRunning: 'preparing',
        interrupt: Promise.resolve(cancelPrep),
        ...(statusHint ? { statusHint } : {}),
      });
    };

    setPreparing();

    const threadNow = this.state.allThreads[threadId];
    if (!threadNow) {
      prepCts.dispose(true);
      this._clearStuckAgentStreamState(threadId);
      return;
    }

    const instructions = userMessage;
    const userSelns: StagingSelectionItem[] = [
      ...(_chatSelections ?? threadNow.state?.stagingSelections ?? []),
    ];
    // Убираем старые heuristic-файлы — при re-edit/re-send подтянутся заново
    let currSelns: StagingSelectionItem[] = userSelns.filter(
      (s) => !(s.type === 'File' && s.fromHeuristic),
    );

    let userMessageIdx = -1;
    let agentStarted = false;
    let prepError: { message: string; fullError: Error | null } | undefined;

    const patchUserMessage = (
      content: string,
      displayContent: string,
      selections?: StagingSelectionItem[],
    ) => {
      if (!isPrepActive() || userMessageIdx < 0) {return;}
      const msg = this.state.allThreads[threadId]?.messages[userMessageIdx];
      if (!msg || msg.role !== 'user') {return;}
      this._editMessageInThread(threadId, userMessageIdx, {
        ...msg,
        content,
        displayContent,
        ...(selections ? { selections } : {}),
      });
    };

    try {
      // Пустой checkpoint перед первым user-сообщением — единая модель «checkpoint перед user».
      // Сбой здесь не должен оставлять preparing навечно (вне try раньше так и было).
      if ((threadNow.messages ?? []).length === 0) {
        chatTrace(threadId, 'prep.checkpoint');
        try {
          this._addUserCheckpoint({ threadId });
        } catch (e) {
          chatTrace(
            threadId,
            'prep.checkpoint.error',
            e instanceof Error ? e.message.slice(0, 120) : 'unknown',
          );
        }
      }

      // Optimistic bubble сразу — уходим с landing до merge/heuristic/office
      chatTrace(threadId, 'prep.bubble');
      this._addMessageToThread(threadId, {
        role: 'user',
        content: instructions,
        displayContent: instructions,
        selections: currSelns,
        ...(images?.length ? { images } : {}),
        state: defaultMessageState,
      });
      userMessageIdx = (this.state.allThreads[threadId]?.messages.length ?? 1) - 1;

      this._omitAutoActiveFileFsPathOfThread[threadId] = undefined;
      delete this._omitHeuristicFsPathsOfThread[threadId];

      this._setThreadState(
        threadId,
        {
          currCheckpointIdx: null,
          pendingToolCalls: undefined,
        },
        true,
      );

      this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then((m) => {
        m.scrollToBottom();
      });

      // Local prep (active file / heuristic / office) — короткий wall-clock; на timeout cancel CTS и fail-open.
      const runLocalPrep = async (): Promise<{
        selns: StagingSelectionItem[];
        userMessageContent: string;
      }> => {
        let selns = currSelns;
        if (!skipAutoAttach) {
          chatTrace(threadId, 'prep.merge.start');
          setPreparing('Подключаю активный файл…');
          selns = await this._mergeActiveFileIntoSelections(selns, threadId, prepCts.token);
          chatTrace(threadId, 'prep.merge.done', `selns=${selns.length}`);
        }
        if (prepCts.token.isCancellationRequested) {
          throw new CancellationError();
        }

        const heuristicEnabled =
          this._settingsService.state.globalSettings.autoRetrieveRelevantFiles !== false;
        if (heuristicEnabled) {
          chatTrace(threadId, 'prep.heuristic.start');
          setPreparing('Ищу релевантные файлы…');
          try {
            selns = await racePrepAwait(
              this._heuristicFileRetrieveService.mergeRelevantFilesIntoSelections(
                instructions,
                selns,
                {
                  enabled: true,
                  userSelns: userSelns.filter((s) => !(s.type === 'File' && s.fromHeuristic)),
                  omittedFsPaths: this._omitHeuristicFsPathsOfThread[threadId],
                  token: prepCts.token,
                },
              ),
              prepCts.token,
              SAPPHIRE_CHAT_HEURISTIC_TIMEOUT_MS,
            );
            chatTrace(threadId, 'prep.heuristic.done', `selns=${selns.length}`);
          } catch (e) {
            // Не блокируем send: зависший fileSearch после другого чата — частая причина.
            chatTrace(
              threadId,
              'prep.heuristic.skip',
              isChatPrepTimeoutError(e) ? 'timeout' : isCancellationError(e) ? 'cancel' : 'error',
            );
          }
        }
        if (prepCts.token.isCancellationRequested) {
          throw new CancellationError();
        }

        chatTrace(threadId, 'prep.content.start', `selns=${selns.length}`);
        setPreparing('Готовлю сообщение…');
        const userMessageContent = await chat_userMessageContent(instructions, selns, {
          directoryStrService: this._directoryStringService,
          fileService: this._fileService,
          extractOffice: (uri) => this._officeExtractService.extractIfOffice(uri),
        });
        chatTrace(threadId, 'prep.content.done', `chars=${userMessageContent.length}`);
        return { selns, userMessageContent };
      };

      let userMessageContent: string;
      chatTrace(threadId, 'prep.local.start', `timeoutMs=${SAPPHIRE_CHAT_PREP_TIMEOUT_MS}`);
      try {
        const local = await racePrepAwait(runLocalPrep(), prepCts.token, SAPPHIRE_CHAT_PREP_TIMEOUT_MS);
        currSelns = local.selns;
        userMessageContent = local.userMessageContent;
        chatTrace(threadId, 'prep.local.done');
      } catch (e) {
        if (!isPrepActive()) {
          chatTrace(threadId, 'prep.inactive', e instanceof Error ? e.name : 'unknown');
          return;
        }
        // Жёстко рвём фон (search/model) — иначе следующий send снова виснет.
        prepCts.cancel();
        if (isChatPrepTimeoutError(e) || isCancellationError(e)) {
          chatTrace(threadId, 'prep.fail-open', isChatPrepTimeoutError(e) ? 'timeout' : 'cancel');
          userMessageContent = instructions;
        } else {
          chatTrace(threadId, 'prep.error', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
          throw e;
        }
      }
      if (!isPrepActive()) {return;}

      patchUserMessage(userMessageContent, instructions, currSelns);

      if (!isPrepActive()) {return;}

      // Тот же prepEpoch — Stop во время короткого окна до входа в loop не «воскресит» агента
      agentStarted = true;
      chatTrace(threadId, 'agent.start', `epoch=${prepEpoch}`);
      this._wrapRunAgentToNotify(
        this._runChatAgent({
          threadId,
          ...this._currentModelSelectionProps(),
          runEpoch: prepEpoch,
        }),
        threadId,
      );
    } catch (e) {
      if (isPrepActive() && !agentStarted) {
        prepError = {
          message: getErrorMessage(e),
          fullError: e instanceof Error ? e : null,
        };
      }
      if (!isPrepActive() && (isCancellationError(e) || isChatPrepTimeoutError(e))) {
        return;
      }
      throw e;
    } finally {
      prepCts.dispose(true);
      // Страховка: early-return / необработанный выход без старта агента не оставляют idle/LLM.
      if (isPrepActive() && !agentStarted) {
        chatTrace(threadId, 'prep.clear-stuck', prepError?.message?.slice(0, 120) ?? 'no-agent');
        this._clearStuckAgentStreamState(threadId, prepError);
      } else if (!agentStarted) {
        chatTrace(threadId, 'prep.exit', `active=${isPrepActive()}`);
      }
    }
  }

  async addUserMessageAndStreamResponse({
    userMessage,
    _chatSelections,
    threadId,
    images,
  }: {
    userMessage: string;
    _chatSelections?: StagingSelectionItem[];
    threadId: string;
    images?: ChatImageAttachment[];
  }) {
    const thread = this.state.allThreads[threadId];
    if (!thread) {return;}

    // Если пользователь «откатился» к checkpoint — обрезаем хвост истории
    if (thread.state.currCheckpointIdx !== null) {
      const checkpointIdx = thread.state.currCheckpointIdx;
      const newMessages = thread.messages.slice(0, checkpointIdx + 1);

      // Персистим обрезанную историю
      const newThreads = {
        ...this.state.allThreads,
        [threadId]: {
          ...thread,
          lastModified: new Date().toISOString(),
          messages: newMessages,
        },
      };
      this._storeAllThreads(newThreads);
      this._setState({ allThreads: newThreads });
      this._pruneApplyBoxStateAfterTruncate(threadId, checkpointIdx);
    }

    // Добавление сообщения и запуск агента
    await this._addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId, images });
  }

  editUserMessageAndStreamResponse: IChatThreadService['editUserMessageAndStreamResponse'] =
    async ({ userMessage, messageIdx, threadId, images }) => {
      const thread = this.state.allThreads[threadId];
      if (!thread) {return;} // invariant

      if (thread.messages?.[messageIdx]?.role !== 'user') {
        throw new Error(`Error: editing a message with role !=='user'`);
      }

      // Сохраняем selections до обрезки истории
      const currSelns = thread.messages[messageIdx].state.stagingSelections || [];
      const imagesToKeep =
        images ??
        (thread.messages[messageIdx].role === 'user'
          ? thread.messages[messageIdx].images
          : undefined);

      // Обрезаем сообщения после редактируемого
      const slicedMessages = thread.messages.slice(0, messageIdx);
      this._setState({
        allThreads: {
          ...this.state.allThreads,
          [thread.id]: {
            ...thread,
            messages: slicedMessages,
          },
        },
      });
      this._pruneApplyBoxStateAfterTruncate(threadId, messageIdx - 1);

      // Повторная отправка отредактированного user-сообщения
      this._addUserMessageAndStreamResponse({
        userMessage,
        _chatSelections: currSelns,
        threadId,
        images: imagesToKeep,
        skipAutoAttach: true,
      });
    };

  abortRunning(threadId: string, opts?: { skipFlush?: boolean }): Promise<void> {
    return this._agentLoop.abortRunning(threadId, opts);
  }

  approveLatestToolRequest(threadId: string): void {
    this._agentLoop.approveLatestToolRequest(threadId);
  }

  rejectLatestToolRequest(threadId: string): void {
    this._agentLoop.rejectLatestToolRequest(threadId);
  }

  buildActivePlan(threadId: string): Promise<void> {
    return this._agentLoop.buildActivePlan(threadId);
  }

  jumpToCheckpointBeforeMessageIdx(opts: {
    threadId: string;
    messageIdx: number;
    jumpToUserModified: boolean;
  }): void {
    this._checkpoints.jumpToCheckpointBeforeMessageIdx(opts);
  }

  setApplyBoxUri(applyBoxId: string, uri: URI | undefined): void {
    this._checkpoints.setApplyBoxUri(applyBoxId, uri);
  }

  getApplyBoxUri(applyBoxId: string): URI | undefined {
    return this._checkpoints.getApplyBoxUri(applyBoxId);
  }

  // Прокси на collaborator-модули после разбиения ChatThreadService.
  private _currentModelSelectionProps(
    ...args: Parameters<ChatThreadAgentLoop['_currentModelSelectionProps']>
  ) {
    return this._agentLoop._currentModelSelectionProps(...args);
  }
  private _updateLatestTool(...args: Parameters<ChatThreadAgentLoop['_updateLatestTool']>) {
    return this._agentLoop._updateLatestTool(...args);
  }
  private _clearStuckAgentStreamState(
    ...args: Parameters<ChatThreadAgentLoop['_clearStuckAgentStreamState']>
  ) {
    return this._agentLoop._clearStuckAgentStreamState(...args);
  }
  private _runChatAgent(...args: Parameters<ChatThreadAgentLoop['_runChatAgent']>) {
    return this._agentLoop._runChatAgent(...args);
  }
  private _addUserCheckpoint(...args: Parameters<ChatThreadCheckpoints['_addUserCheckpoint']>) {
    return this._checkpoints._addUserCheckpoint(...args);
  }
  _editMessageInThread(...args: Parameters<ChatThreadCheckpoints['_editMessageInThread']>) {
    return this._checkpoints._editMessageInThread(...args);
  }
  _addToolEditCheckpoint(...args: Parameters<ChatThreadCheckpoints['_addToolEditCheckpoint']>) {
    return this._checkpoints._addToolEditCheckpoint(...args);
  }
  private _pruneApplyBoxStateAfterTruncate(
    ...args: Parameters<ChatThreadCheckpoints['_pruneApplyBoxStateAfterTruncate']>
  ) {
    return this._checkpoints._pruneApplyBoxStateAfterTruncate(...args);
  }

  private _addMessageToThread(...args: Parameters<ChatThreadStaging['_addMessageToThread']>) {
    return this._staging._addMessageToThread(...args);
  }
  _replaceThreadMessages(...args: Parameters<ChatThreadStaging['_replaceThreadMessages']>) {
    return this._staging._replaceThreadMessages(...args);
  }
  private _setThreadState(...args: Parameters<ChatThreadStaging['_setThreadState']>) {
    return this._staging._setThreadState(...args);
  }
  private _mergeActiveFileIntoSelections(
    ...args: Parameters<ChatThreadStaging['_mergeActiveFileIntoSelections']>
  ) {
    return this._staging._mergeActiveFileIntoSelections(...args);
  }

  getRelativeStr = (uri: URI) => {
    return this._codespanLinks.getRelativeStr(uri);
  };
  generateCodespanLink: IChatThreadService['generateCodespanLink'] = async (opts) => {
    return this._codespanLinks.generateCodespanLink(opts);
  };
  getCodespanLink(opts: {
    codespanStr: string;
    messageIdx: number;
    threadId: string;
  }): CodespanLocationLink | undefined {
    return this._codespanLinks.getCodespanLink(opts);
  }
  addCodespanLink(opts: {
    newLinkText: string;
    newLinkLocation: CodespanLocationLink;
    messageIdx: number;
    threadId: string;
  }) {
    return this._codespanLinks.addCodespanLink(opts);
  }

  getCurrentThread(): ThreadType {
    return this._library.getCurrentThread();
  }
  getCurrentFocusedMessageIdx() {
    return this._library.getCurrentFocusedMessageIdx();
  }
  isCurrentlyFocusingMessage() {
    return this._library.isCurrentlyFocusingMessage();
  }
  switchToThread(threadId: string) {
    this._library.switchToThread(threadId);
  }
  openTab(threadId: string) {
    this._library.openTab(threadId);
  }
  closeTab(threadId: string) {
    this._library.closeTab(threadId);
  }
  openNewThread(folderId?: string | null) {
    this._library.openNewThread(folderId);
  }
  deleteThread(threadId: string): void {
    this._library.deleteThread(threadId);
  }
  duplicateThread(threadId: string) {
    this._library.duplicateThread(threadId);
  }
  createFolder(name: string, parentId: string | null): string {
    return this._library.createFolder(name, parentId);
  }
  renameFolder(folderId: string, name: string): void {
    this._library.renameFolder(folderId, name);
  }
  deleteFolder(folderId: string): void {
    this._library.deleteFolder(folderId);
  }
  moveThreadToFolder(threadId: string, folderId: string | null): void {
    this._library.moveThreadToFolder(threadId, folderId);
  }
  moveFolder(folderId: string, newParentId: string | null): void {
    this._library.moveFolder(folderId, newParentId);
  }
  reorderFolder(folderId: string, beforeSiblingId: string | null): void {
    this._library.reorderFolder(folderId, beforeSiblingId);
  }
  setThreadPinned(threadId: string, pinned: boolean): void {
    this._library.setThreadPinned(threadId, pinned);
  }
  getChatHistorySummary(opts?: { threadId?: string | null }): string {
    return this._library.getChatHistorySummary(opts);
  }

  setCurrentlyFocusedMessageIdx(messageIdx: number | undefined) {
    this._staging.setCurrentlyFocusedMessageIdx(messageIdx);
  }
  addNewStagingSelection(newSelection: StagingSelectionItem): void {
    this._staging.addNewStagingSelection(newSelection);
  }
  omitAutoActiveFileForNextSend(fsPath: string): void {
    this._staging.omitAutoActiveFileForNextSend(fsPath);
  }
  clearOmitAutoActiveFile(): void {
    this._staging.clearOmitAutoActiveFile();
  }
  getOmitAutoActiveFileFsPath(): string | undefined {
    return this._staging.getOmitAutoActiveFileFsPath();
  }
  omitHeuristicFileForNextSend(fsPath: string): void {
    this._staging.omitHeuristicFileForNextSend(fsPath);
  }
  clearOmitHeuristicFiles(): void {
    this._staging.clearOmitHeuristicFiles();
  }
  getOmitHeuristicFileFsPaths(): ReadonlySet<string> {
    return this._staging.getOmitHeuristicFileFsPaths();
  }
  popStagingSelections(numPops: number): void {
    this._staging.popStagingSelections(numPops);
  }
  removeStagingSelectionAt(index: number, messageIdx?: number): void {
    this._staging.removeStagingSelectionAt(index, messageIdx);
  }
  undoStagingPop(): boolean {
    return this._staging.undoStagingPop();
  }
  getCurrentThreadState = () => {
    return this._staging.getCurrentThreadState();
  };
  setCurrentThreadState = (newState: Partial<ThreadType['state']>) => {
    this._staging.setCurrentThreadState(newState);
  };
  setThreadChatMode(threadId: string, chatMode: ChatMode): void {
    const thread = this.state.allThreads[threadId];
    if (!thread || thread.state.chatMode === chatMode) {return;}
    // Без remount композера: смена режима не должна сбрасывать черновик и фокус.
    this._setThreadState(threadId, { chatMode }, true);
    this._storeAllThreads(this.state.allThreads);
  }
  setComposerDraft = (
    threadId: string,
    draft: { draftText?: string; stagingImages?: ChatImageAttachment[] },
  ) => {
    this._staging.setComposerDraft(threadId, draft);
  };
  getCurrentMessageState(messageIdx: number): UserMessageState {
    return this._staging.getCurrentMessageState(messageIdx);
  }
  setCurrentMessageState(messageIdx: number, newState: Partial<UserMessageState>) {
    this._staging.setCurrentMessageState(messageIdx, newState);
  }
}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);
