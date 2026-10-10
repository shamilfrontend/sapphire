/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import {
  ChatImageAttachment,
  ChatMessage,
  StagingSelectionItem,
} from '../common/chatThreadServiceTypes.js';
import { mergeActiveFileSelection } from '../common/activeFileAttach.js';
import { PPR_CHAT_PREP_TIMEOUT_MS, racePrepAwait } from '../common/chatPrepGuard.js';
import {
  ChatThreadCollaboratorHost,
  defaultMessageState,
  ThreadType,
  UserMessageState,
} from './chatThreadTypes.js';

const STAGING_UNDO_MAX = 20;

const findStagingSelectionIndex = (
  currentSelections: StagingSelectionItem[] | undefined,
  newSelection: StagingSelectionItem,
): number | null => {
  if (!currentSelections) return null;

  for (let i = 0; i < currentSelections.length; i += 1) {
    const s = currentSelections[i];

    if (s.uri.fsPath !== newSelection.uri.fsPath) continue;

    if (s.type === 'File' && newSelection.type === 'File') {
      return i;
    }
    if (s.type === 'CodeSelection' && newSelection.type === 'CodeSelection') {
      if (s.uri.fsPath !== newSelection.uri.fsPath) continue;
      // совпадение uri и range — тот же selection
      const [oldStart, oldEnd] = s.range;
      const [newStart, newEnd] = newSelection.range;
      if (oldStart !== newStart || oldEnd !== newEnd) continue;
      return i;
    }
    if (s.type === 'Folder' && newSelection.type === 'Folder') {
      return i;
    }
  }
  return null;
};

export class ChatThreadStaging {
  constructor(private readonly _s: ChatThreadCollaboratorHost) {}

  _addMessageToThread(threadId: string, message: ChatMessage) {
    const { allThreads } = this._s.state;
    const oldThread = allThreads[threadId];
    if (!oldThread) return; // не должно случаться
    // обновляем state и persist
    const newThreads = {
      ...allThreads,
      [oldThread.id]: {
        ...oldThread,
        lastModified: new Date().toISOString(),
        messages: [...oldThread.messages, message],
      },
    };
    this._s._storeAllThreads(newThreads);
    this._s._setState({ allThreads: newThreads }); // текущий тред изменился (добавлено сообщение)
  }

  /**
   * Заменяет весь список сообщений (например после compaction контекста).
   * Опционально обновляет lastCompactedAtMessageCount и чинит currCheckpointIdx.
   */
  _replaceThreadMessages(
    threadId: string,
    messages: ChatMessage[],
    opts?: { markCompacted?: boolean },
  ) {
    const { allThreads } = this._s.state;
    const oldThread = allThreads[threadId];
    if (!oldThread) return;

    let currCheckpointIdx = oldThread.state.currCheckpointIdx;
    if (currCheckpointIdx !== null && currCheckpointIdx !== undefined) {
      if (currCheckpointIdx >= messages.length || messages[currCheckpointIdx]?.role !== 'checkpoint') {
        let lastCp: number | null = null;
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].role === 'checkpoint') {
            lastCp = i;
          }
        }
        currCheckpointIdx = lastCp;
      }
    }

    const newThreads = {
      ...allThreads,
      [oldThread.id]: {
        ...oldThread,
        lastModified: new Date().toISOString(),
        messages,
        state: {
          ...oldThread.state,
          currCheckpointIdx,
          ...(opts?.markCompacted ? { lastCompactedAtMessageCount: messages.length } : {}),
        },
      },
    };
    this._s._storeAllThreads(newThreads);
    this._s._setState({ allThreads: newThreads });
  }

  // индекс фокуса на сообщении (undefined, если ничего не выбрано)
  setCurrentlyFocusedMessageIdx(messageIdx: number | undefined) {
    const threadId = this._s.state.currentThreadId;
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;

    this._s._setState({
      allThreads: {
        ...this._s.state.allThreads,
        [threadId]: {
          ...thread,
          state: {
            ...thread.state,
            focusedMessageIdx: messageIdx,
          },
        },
      },
    });

    // // при смене focused idx — jump; при Edit назад не прыгаем (слишком путано)
    // if (messageIdx !== undefined)
    // 	this.jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified: true })
  }

  addNewStagingSelection(newSelection: StagingSelectionItem): void {
    const focusedMessageIdx = this._s.getCurrentFocusedMessageIdx();
    const { selections, setSelections } = this._getStagingAccess(focusedMessageIdx);

    // совпадение с существующим — перезаписываем (текст мог измениться)
    const idx = findStagingSelectionIndex(selections, newSelection);
    if (idx !== null && idx !== -1) {
      setSelections([
        ...selections.slice(0, idx),
        newSelection,
        ...selections.slice(idx + 1, Infinity),
      ]);
    }
    // иначе добавляем в конец
    else {
      setSelections([...selections, newSelection]);
    }
  }

  omitAutoActiveFileForNextSend(fsPath: string): void {
    const threadId = this._s.state.currentThreadId;
    if (!threadId) {
      return;
    }
    this._s._omitAutoActiveFileFsPathOfThread[threadId] = fsPath;
    // Новый объект state для React (Object.is); omit хранится вне ThreadsState.
    this._s._setState({});
  }

  clearOmitAutoActiveFile(): void {
    const threadId = this._s.state.currentThreadId;
    if (!threadId) {
      return;
    }
    if (this._s._omitAutoActiveFileFsPathOfThread[threadId] === undefined) {
      return;
    }
    this._s._omitAutoActiveFileFsPathOfThread[threadId] = undefined;
    this._s._setState({});
  }

  getOmitAutoActiveFileFsPath(): string | undefined {
    const threadId = this._s.state.currentThreadId;
    if (!threadId) {
      return undefined;
    }
    return this._s._omitAutoActiveFileFsPathOfThread[threadId];
  }

  omitHeuristicFileForNextSend(fsPath: string): void {
    const threadId = this._s.state.currentThreadId;
    if (!threadId || !fsPath) {
      return;
    }
    const set = this._s._omitHeuristicFsPathsOfThread[threadId] ?? new Set<string>();
    set.add(fsPath);
    this._s._omitHeuristicFsPathsOfThread[threadId] = set;
    this._s._setState({});
  }

  clearOmitHeuristicFiles(): void {
    const threadId = this._s.state.currentThreadId;
    if (!threadId) {
      return;
    }
    if (!this._s._omitHeuristicFsPathsOfThread[threadId]?.size) {
      return;
    }
    delete this._s._omitHeuristicFsPathsOfThread[threadId];
    this._s._setState({});
  }

  getOmitHeuristicFileFsPaths(): ReadonlySet<string> {
    const threadId = this._s.state.currentThreadId;
    if (!threadId) {
      return new Set();
    }
    return this._s._omitHeuristicFsPathsOfThread[threadId] ?? new Set();
  }

  async _mergeActiveFileIntoSelections(
    selns: StagingSelectionItem[],
    threadId: string,
    token: CancellationToken = CancellationToken.None,
  ): Promise<StagingSelectionItem[]> {
    const enabled = this._s._settingsService.state.globalSettings.autoAttachActiveFile !== false;
    const activeUri = this._s._editorService.activeEditor?.resource;
    let language = 'plaintext';
    if (activeUri && !token.isCancellationRequested) {
      try {
        const modelSafe = this._s._sapphireModelService.getModelSafe(activeUri) as Promise<{
          model: { getLanguageId(): string } | null;
        }>;
        const modelResult = await racePrepAwait(modelSafe, token, PPR_CHAT_PREP_TIMEOUT_MS);
        language = modelResult.model?.getLanguageId() || 'plaintext';
      } catch {
        // fail-open: Stop / таймаут — без languageId, plaintext
        language = 'plaintext';
      }
    }
    return mergeActiveFileSelection(selns, activeUri ? { uri: activeUri, language } : null, {
      enabled,
      omittedUriFsPath: this._s._omitAutoActiveFileFsPathOfThread[threadId],
    });
  }

  private _getStagingAccess(messageIdx: number | undefined): {
    messageIdx: number | undefined;
    selections: StagingSelectionItem[];
    setSelections: (s: StagingSelectionItem[]) => void;
  } {
    if (messageIdx === undefined) {
      return {
        messageIdx: undefined,
        selections: this.getCurrentThreadState().stagingSelections ?? [],
        setSelections: (s: StagingSelectionItem[]) =>
          this.setCurrentThreadState({ stagingSelections: s }),
      };
    }
    return {
      messageIdx,
      selections: this.getCurrentMessageState(messageIdx).stagingSelections ?? [],
      setSelections: (s: StagingSelectionItem[]) =>
        this.setCurrentMessageState(messageIdx, { stagingSelections: s }),
    };
  }

  private _pushStagingUndo(entry: {
    items: StagingSelectionItem[];
    insertAt: number;
    messageIdx: number | undefined;
  }): void {
    const threadId = this._s.state.currentThreadId;
    const stack = this._s._stagingUndoOfThread[threadId] ?? [];
    stack.push(entry);
    if (stack.length > STAGING_UNDO_MAX) {
      stack.shift();
    }
    this._s._stagingUndoOfThread[threadId] = stack;
  }

  // Снимает последние staging-selections с текущего треда
  popStagingSelections(numPops: number): void {
    numPops = numPops ?? 1;

    const focusedMessageIdx = this._s.getCurrentFocusedMessageIdx();
    const { selections, setSelections } = this._getStagingAccess(focusedMessageIdx);
    const n = Math.min(numPops, selections.length);
    if (n <= 0) return;

    const insertAt = selections.length - n;
    this._pushStagingUndo({
      items: selections.slice(insertAt),
      insertAt,
      messageIdx: focusedMessageIdx,
    });
    setSelections(selections.slice(0, insertAt));
  }

  removeStagingSelectionAt(index: number, messageIdx?: number): void {
    const targetIdx = messageIdx !== undefined ? messageIdx : this._s.getCurrentFocusedMessageIdx();
    const { selections, setSelections } = this._getStagingAccess(targetIdx);
    if (index < 0 || index >= selections.length) return;

    this._pushStagingUndo({
      items: [selections[index]],
      insertAt: index,
      messageIdx: targetIdx,
    });
    setSelections([...selections.slice(0, index), ...selections.slice(index + 1)]);
  }

  undoStagingPop(): boolean {
    const threadId = this._s.state.currentThreadId;
    const stack = this._s._stagingUndoOfThread[threadId];
    if (!stack?.length) return false;

    const entry = stack.pop()!;
    const { selections, setSelections } = this._getStagingAccess(entry.messageIdx);
    const insertAt = Math.min(Math.max(entry.insertAt, 0), selections.length);
    setSelections([
      ...selections.slice(0, insertAt),
      ...entry.items,
      ...selections.slice(insertAt),
    ]);
    return true;
  }

  // частичное обновление message.state
  private _setCurrentMessageState(state: Partial<UserMessageState>, messageIdx: number): void {
    const threadId = this._s.state.currentThreadId;
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;

    this._s._setState({
      allThreads: {
        ...this._s.state.allThreads,
        [threadId]: {
          ...thread,
          messages: thread.messages.map((m: ChatMessage, i: number) =>
            i === messageIdx && m.role === 'user'
              ? {
                  ...m,
                  state: {
                    ...m.state,
                    ...state,
                  },
                }
              : m,
          ),
        },
      },
    });
  }

  // частичное обновление thread.state
  _setThreadState(
    threadId: string,
    state: Partial<ThreadType['state']>,
    doNotRefreshMountInfo?: boolean,
  ): void {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;

    this._s._setState(
      {
        allThreads: {
          ...this._s.state.allThreads,
          [thread.id]: {
            ...thread,
            state: {
              ...thread.state,
              ...state,
            },
          },
        },
      },
      doNotRefreshMountInfo,
    );
  }

  getCurrentThreadState = () => {
    const currentThread = this._s.getCurrentThread();
    return currentThread.state;
  };

  setCurrentThreadState = (newState: Partial<ThreadType['state']>) => {
    this._setThreadState(this._s.state.currentThreadId, newState);
  };

  /**
   * Тихо сохранить черновик композера в thread.state — без _setState/notify/remount,
   * чтобы не дёргать UI на каждый символ. Persist — при следующем _storeAllThreads.
   */
  setComposerDraft = (
    threadId: string,
    draft: { draftText?: string; stagingImages?: ChatImageAttachment[] },
  ): void => {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;
    if (draft.draftText !== undefined) {
      thread.state.draftText = draft.draftText;
    }
    if (draft.stagingImages !== undefined) {
      thread.state.stagingImages = draft.stagingImages;
    }
  };

  getCurrentMessageState(messageIdx: number): UserMessageState {
    const currMessage = this._s.getCurrentThread()?.messages?.[messageIdx];
    if (!currMessage || currMessage.role !== 'user') return defaultMessageState;
    return currMessage.state;
  }

  setCurrentMessageState(messageIdx: number, newState: Partial<UserMessageState>) {
    const currMessage = this._s.getCurrentThread()?.messages?.[messageIdx];
    if (!currMessage || currMessage.role !== 'user') return;
    this._setCurrentMessageState(newState, messageIdx);
  }
}
