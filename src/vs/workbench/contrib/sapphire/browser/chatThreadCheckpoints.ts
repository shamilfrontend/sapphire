/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatThreadCollaboratorHost, ThreadType } from './chatThreadTypes.js';
import { URI } from '../../../../base/common/uri.js';
import { ChatMessage, CheckpointEntry } from '../common/chatThreadServiceTypes.js';
import { findLastIdx } from '../../../../base/common/arraysFind.js';
import { SapphireFileSnapshot } from '../common/editCodeServiceTypes.js';
import { manualEditBaselinesForCheckpoint } from '../common/manualEditCheckpoint.js';

export class ChatThreadCheckpoints {
  constructor(private readonly _s: ChatThreadCollaboratorHost) {}

  _addCheckpoint(threadId: string, checkpoint: CheckpointEntry) {
    this._s._addMessageToThread(threadId, checkpoint);
    // // обновить currCheckpointIdx на только что добавленный
    // const newThread = this._s.state.allThreads[threadId]
    // if (!newThread) return // не должно случаться
    // const currCheckpointIdx = newThread.messages.length - 1
    // this._s._setThreadState(threadId, { currCheckpointIdx: currCheckpointIdx })
  }

  _editMessageInThread(threadId: string, messageIdx: number, newMessage: ChatMessage) {
    const { allThreads } = this._s.state;
    const oldThread = allThreads[threadId];
    if (!oldThread) return; // не должно случаться
    // обновляем state и persist
    const newThreads = {
      ...allThreads,
      [oldThread.id]: {
        ...oldThread,
        lastModified: new Date().toISOString(),
        messages: [
          ...oldThread.messages.slice(0, messageIdx),
          newMessage,
          ...oldThread.messages.slice(messageIdx + 1, Infinity),
        ],
      },
    };
    this._s._storeAllThreads(newThreads);
    this._s._setState({ allThreads: newThreads }); // текущий тред изменился (добавили сообщение)
  }

  _getCheckpointInfo = (
    checkpointMessage: ChatMessage & { role: 'checkpoint' },
    fsPath: string,
    opts: { includeUserModifiedChanges: boolean },
  ) => {
    const sapphireFileSnapshot = checkpointMessage.sapphireFileSnapshotOfURI
      ? (checkpointMessage.sapphireFileSnapshotOfURI[fsPath] ?? null)
      : null;
    if (!opts.includeUserModifiedChanges) {
      return { sapphireFileSnapshot };
    }

    const userModifiedVoidFileSnapshot =
      fsPath in checkpointMessage.userModifications.sapphireFileSnapshotOfURI
        ? (checkpointMessage.userModifications.sapphireFileSnapshotOfURI[fsPath] ?? null)
        : null;
    return { sapphireFileSnapshot: userModifiedVoidFileSnapshot ?? sapphireFileSnapshot };
  };

  _computeNewCheckpointInfo({ threadId }: { threadId: string }) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;

    const lastCheckpointIdx = findLastIdx(thread.messages, (m) => m.role === 'checkpoint') ?? -1;

    const sapphireFileSnapshotOfURI: { [fsPath: string]: SapphireFileSnapshot | undefined } = {};

    // снимок для всех URI из истории checkpoint до последнего
    const { lastIdxOfURI } =
      lastCheckpointIdx === -1
        ? { lastIdxOfURI: {} as { [fsPath: string]: number } }
        : (this._getCheckpointsBetween({ threadId, loIdx: 0, hiIdx: lastCheckpointIdx }) ?? {});
    for (const fsPath in lastIdxOfURI ?? {}) {
      const { model } = this._s._sapphireModelService.getModelFromFsPath(fsPath);
      if (!model) continue;
      const checkpoint2 = thread.messages[lastIdxOfURI[fsPath]] || null;
      if (!checkpoint2) continue;
      if (checkpoint2.role !== 'checkpoint') continue;
      const res = this._getCheckpointInfo(checkpoint2, fsPath, {
        includeUserModifiedChanges: false,
      });
      if (!res) continue;
      const { sapphireFileSnapshot: oldVoidFileSnapshot } = res;

      const sapphireFileSnapshot = this._s._editCodeService.getVoidFileSnapshot(URI.file(fsPath));
      if (oldVoidFileSnapshot?.entireFileCode === sapphireFileSnapshot.entireFileCode) continue;
      sapphireFileSnapshotOfURI[fsPath] = sapphireFileSnapshot;
    }

    // файлы, правившиеся пользователем вне agent-checkpoint — текст «до» правки
    const beforeEntries: [string, string][] = [];
    for (const fsPath of this._s._userModifiedFilesToCheckInCheckpoints.keys()) {
      const before = this._s._userModifiedFilesToCheckInCheckpoints.get(fsPath);
      if (typeof before !== 'string') continue;
      beforeEntries.push([fsPath, before]);
    }
    const baselines = manualEditBaselinesForCheckpoint(beforeEntries, lastIdxOfURI ?? {});
    for (const fsPath in baselines) {
      if (fsPath in sapphireFileSnapshotOfURI) continue;
      sapphireFileSnapshotOfURI[fsPath] = baselines[fsPath];
    }

    return { sapphireFileSnapshotOfURI };
  }

  _addUserCheckpoint({ threadId }: { threadId: string }) {
    const { sapphireFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {};
    this._addCheckpoint(threadId, {
      role: 'checkpoint',
      type: 'user_edit',
      sapphireFileSnapshotOfURI: sapphireFileSnapshotOfURI ?? {},
      userModifications: { sapphireFileSnapshotOfURI: {} },
    });
    this._s._userModifiedFilesToCheckInCheckpoints.clear();
  }

  // вызывать сразу после правки файла tool/LLM
  _addToolEditCheckpoint({ threadId, uri }: { threadId: string; uri: URI }) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;
    const { model } = this._s._sapphireModelService.getModel(uri);
    if (!model) return; // не должно случаться
    const diffAreasSnapshot = this._s._editCodeService.getVoidFileSnapshot(uri);
    this._addCheckpoint(threadId, {
      role: 'checkpoint',
      type: 'tool_edit',
      sapphireFileSnapshotOfURI: { [uri.fsPath]: diffAreasSnapshot },
      userModifications: { sapphireFileSnapshotOfURI: {} },
    });
  }

  _getCheckpointBeforeMessage = ({
    threadId,
    messageIdx,
  }: {
    threadId: string;
    messageIdx: number;
  }): [CheckpointEntry, number] | undefined => {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return undefined;
    for (let i = messageIdx; i >= 0; i--) {
      const message = thread.messages[i];
      if (message.role === 'checkpoint') {
        return [message, i];
      }
    }
    return undefined;
  };

  _getCheckpointsBetween({
    threadId,
    loIdx,
    hiIdx,
  }: {
    threadId: string;
    loIdx: number;
    hiIdx: number;
  }) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return { lastIdxOfURI: {} }; // не должно случаться
    const lastIdxOfURI: { [fsPath: string]: number } = {};
    for (let i = loIdx; i <= hiIdx; i += 1) {
      const message = thread.messages[i];
      if (message?.role !== 'checkpoint') continue;
      for (const fsPath in message.sapphireFileSnapshotOfURI) {
        // userModified.beforeStrOfURI сюда не включаем — jump не откатывает эти правки
        lastIdxOfURI[fsPath] = i;
      }
    }
    return { lastIdxOfURI };
  }

  _readCurrentCheckpoint(threadId: string): [CheckpointEntry, number] | undefined {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;

    const { currCheckpointIdx } = thread.state;
    if (currCheckpointIdx === null) return;

    const checkpoint = thread.messages[currCheckpointIdx];
    if (!checkpoint) return;
    if (checkpoint.role !== 'checkpoint') return;
    return [checkpoint, currCheckpointIdx];
  }

  _addUserModificationsToCurrCheckpoint({ threadId }: { threadId: string }) {
    const { sapphireFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {};
    const res = this._readCurrentCheckpoint(threadId);
    if (!res) return;
    const [checkpoint, checkpointIdx] = res;
    this._editMessageInThread(threadId, checkpointIdx, {
      ...checkpoint,
      userModifications: { sapphireFileSnapshotOfURI: sapphireFileSnapshotOfURI ?? {} },
    });
  }

  _makeUsStandOnCheckpoint({ threadId }: { threadId: string }) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;
    if (thread.state.currCheckpointIdx === null) {
      const lastMsg = thread.messages[thread.messages.length - 1];
      if (lastMsg?.role !== 'checkpoint') this._addUserCheckpoint({ threadId });
      this._s._setThreadState(threadId, { currCheckpointIdx: thread.messages.length - 1 });
    }
  }

  jumpToCheckpointBeforeMessageIdx({
    threadId,
    messageIdx,
    jumpToUserModified,
  }: {
    threadId: string;
    messageIdx: number;
    jumpToUserModified: boolean;
  }) {
    // если currCheckpointIdx null — временный checkpoint для jump вперёд
    this._makeUsStandOnCheckpoint({ threadId });

    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;
    if (this._s.streamState[threadId]?.isRunning) return;

    const c = this._getCheckpointBeforeMessage({ threadId, messageIdx });
    if (c === undefined) return; // не должно случаться

    const fromIdx = thread.state.currCheckpointIdx;
    if (fromIdx === null) return; // не должно случаться

    const [_, toIdx] = c;
    if (toIdx === fromIdx) return;

    // console.log(`going from ${fromIdx} to ${toIdx}`)

    // фиксируем userModifications на текущем checkpoint
    this._addUserModificationsToCurrCheckpoint({ threadId });

    /*
Откат (undo jump):

A,B,C — файлы; x — checkpoint, где файл менялся.

A B C D E F G H I
  x x x x x   x           <-- «до» не всегда выше; иногда ищем ниже
  | | | | |   | x
--x-|-|-|-x---x-|-----     <-- to
	| | | | x   x
	| | x x |
	| |   | |
----x-|---x-x-------     <-- from
	  x

Откатываем изменения между to+1 и from.
**Для каждого файла берём последний x в 0…to и применяем содержимое.**
Только файлы, менявшиеся в to+1…from.
*/
    if (toIdx < fromIdx) {
      const { lastIdxOfURI } = this._getCheckpointsBetween({
        threadId,
        loIdx: toIdx + 1,
        hiIdx: fromIdx,
      });

      const idxes = function* () {
        for (let k = toIdx; k >= 0; k -= 1) {
          // сначала вверх по индексам
          yield k;
        }
        for (let k = toIdx + 1; k < thread.messages.length; k += 1) {
          // затем вниз
          yield k;
        }
      };

      for (const fsPath in lastIdxOfURI) {
        // первый checkpoint с этим файлом от toIdx (сначала вверх, иначе вниз)
        for (const k of idxes()) {
          const message = thread.messages[k];
          if (message.role !== 'checkpoint') continue;
          const res = this._getCheckpointInfo(message, fsPath, {
            includeUserModifiedChanges: jumpToUserModified,
          });
          if (!res) continue;
          const { sapphireFileSnapshot } = res;
          if (!sapphireFileSnapshot) continue;
          this._s._editCodeService.restoreVoidFileSnapshot(URI.file(fsPath), sapphireFileSnapshot);
          break;
        }
      }
    }

    /*
Повтор (redo jump):

A B C D E F G H I J
  x x x x x   x     x
  | | | | |   | x x x
--x-|-|-|-x---x-|-|---     <-- from
	| | | | x   x
	| | x x |
	| |   | |
----x-|---x-x-----|---     <-- to
	  x           x

Применяем последнее состояние для изменений между from+1 и to.
Только файлы из from+1…to.
*/
    if (toIdx > fromIdx) {
      const { lastIdxOfURI } = this._getCheckpointsBetween({
        threadId,
        loIdx: fromIdx + 1,
        hiIdx: toIdx,
      });
      for (const fsPath in lastIdxOfURI) {
        // для каждого uri — содержимое с наименьшим k (ближе к to)
        for (let k = toIdx; k >= fromIdx + 1; k -= 1) {
          const message = thread.messages[k];
          if (message.role !== 'checkpoint') continue;
          const res = this._getCheckpointInfo(message, fsPath, {
            includeUserModifiedChanges: jumpToUserModified,
          });
          if (!res) continue;
          const { sapphireFileSnapshot } = res;
          if (!sapphireFileSnapshot) continue;
          this._s._editCodeService.restoreVoidFileSnapshot(URI.file(fsPath), sapphireFileSnapshot);
          break;
        }
      }
    }

    this._s._setThreadState(threadId, { currCheckpointIdx: toIdx });
  }

  _threadIdFromApplyBoxId(applyBoxId: string): string | undefined {
    const parts = applyBoxId.split('-');
    if (parts.length < 3) return undefined;
    parts.pop(); // tokenIdx
    parts.pop(); // messageIdx
    const threadId = parts.join('-');
    return threadId || undefined;
  }

  _messageIdxFromApplyBoxId(applyBoxId: string): number | undefined {
    const parts = applyBoxId.split('-');
    if (parts.length < 3) return undefined;
    const messageIdx = Number(parts[parts.length - 2]);
    return Number.isFinite(messageIdx) ? messageIdx : undefined;
  }

  setApplyBoxUri(applyBoxId: string, uri: URI | undefined): void {
    const threadId = this._threadIdFromApplyBoxId(applyBoxId);
    if (!threadId) return;
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;
    const prev = thread.state.applyBoxState ?? {};
    let next: ThreadType['state']['applyBoxState'];
    if (uri) {
      next = { ...prev, [applyBoxId]: { uri } };
    } else {
      const { [applyBoxId]: _removed, ...rest } = prev;
      next = Object.keys(rest).length ? rest : undefined;
    }
    this._s._setThreadState(threadId, { applyBoxState: next });
    this._s._storeAllThreads(this._s.state.allThreads);
  }

  getApplyBoxUri(applyBoxId: string): URI | undefined {
    const threadId = this._threadIdFromApplyBoxId(applyBoxId);
    if (!threadId) return undefined;
    const entry = this._s.state.allThreads[threadId]?.state.applyBoxState?.[applyBoxId];
    return entry?.uri;
  }

  /** Удалить applyBox, если сообщение обрезали при truncate. */
  _pruneApplyBoxStateAfterTruncate(threadId: string, lastKeptMessageIdx: number): void {
    const thread = this._s.state.allThreads[threadId];
    if (!thread?.state.applyBoxState) return;
    const prev = thread.state.applyBoxState;
    const next: { [applyBoxId: string]: { uri: URI } } = {};
    let changed = false;
    for (const applyBoxId of Object.keys(prev)) {
      const messageIdx = this._messageIdxFromApplyBoxId(applyBoxId);
      if (messageIdx === undefined || messageIdx > lastKeptMessageIdx) {
        changed = true;
        continue;
      }
      next[applyBoxId] = prev[applyBoxId];
    }
    if (changed) {
      this._s._setThreadState(threadId, {
        applyBoxState: Object.keys(next).length ? next : undefined,
      });
      this._s._storeAllThreads(this._s.state.allThreads);
    }
  }
}
