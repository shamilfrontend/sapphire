/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { deepClone } from '../../../../base/common/objects.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import {
  ChatFolder,
  folderWouldCreateCycle,
  reorderFolderAmongSiblings,
} from '../common/chatFolders.js';
import { buildChatHistorySummary } from '../common/chatHistorySummary.js';
import { ChatThreadCollaboratorHost, ChatThreads, ThreadType } from './chatThreadTypes.js';

export const newThreadObject = (): ThreadType => {
  const now = new Date().toISOString();
  return {
    id: generateUuid(),
    createdAt: now,
    lastModified: now,
    messages: [],
    state: {
      currCheckpointIdx: null,
      stagingSelections: [],
      focusedMessageIdx: undefined,
      linksOfMessageIdx: {},
    },
  };
};

export class ChatThreadLibrary {
  constructor(private readonly _s: ChatThreadCollaboratorHost) {}

  getCurrentThread(): ThreadType {
    const state = this._s.state;
    const thread = state.allThreads[state.currentThreadId];
    if (!thread) throw new Error(`Current thread should never be undefined`);
    return thread;
  }

  getCurrentFocusedMessageIdx() {
    const thread = this.getCurrentThread();

    // focusedMessageIdx из state треда
    const focusedMessageIdx = thread.state.focusedMessageIdx;
    if (focusedMessageIdx === undefined) return;

    // сообщение должно быть user и в режиме редактирования
    const focusedMessage = thread.messages[focusedMessageIdx];
    if (focusedMessage.role !== 'user') return;
    if (!focusedMessage.state) return;

    return focusedMessageIdx;
  }

  isCurrentlyFocusingMessage() {
    return this.getCurrentFocusedMessageIdx() !== undefined;
  }

  switchToThread(threadId: string) {
    if (!this._s.state.allThreads[threadId]) return;
    const openThreadIds = this._s._withThreadOpened(threadId, this._s.state.openThreadIds);
    const shouldPersist = openThreadIds !== this._s.state.openThreadIds;
    this._s._setState({ currentThreadId: threadId, openThreadIds });
    if (shouldPersist) {
      this._s._storeAllThreads(this._s.state.allThreads, openThreadIds);
    }
  }

  openTab(threadId: string) {
    this.switchToThread(threadId);
  }

  closeTab(threadId: string) {
    const { openThreadIds: prevOpen, currentThreadId, allThreads } = this._s.state;
    const idx = prevOpen.indexOf(threadId);
    if (idx === -1) return;

    const openThreadIds = prevOpen.filter((id: string) => id !== threadId);

    if (openThreadIds.length === 0) {
      this._s._setState({ openThreadIds: [] });
      this._s._storeAllThreads(allThreads, []);
      this._s.openNewThread();
      return;
    }

    let nextCurrentId = currentThreadId;
    if (currentThreadId === threadId) {
      nextCurrentId = idx > 0 ? openThreadIds[idx - 1] : openThreadIds[0];
    }

    this._s._setState({ openThreadIds, currentThreadId: nextCurrentId });
    this._s._storeAllThreads(allThreads, openThreadIds);
  }

  openNewThread(folderId?: string | null) {
    const { allThreads: currentThreads, openThreadIds } = this._s.state;
    const newThread = newThreadObject();
    if (folderId && this._s.state.folders.some((folder: ChatFolder) => folder.id === folderId)) {
      newThread.folderId = folderId;
    }

    const newThreads: ChatThreads = {
      ...currentThreads,
      [newThread.id]: newThread,
    };
    const nextOpen = this._s._withThreadOpened(newThread.id, openThreadIds);
    this._s._storeAllThreads(newThreads, nextOpen);
    this._s._setState({
      allThreads: newThreads,
      currentThreadId: newThread.id,
      openThreadIds: nextOpen,
    });
  }

  deleteThread(threadId: string): void {
    const { allThreads: currentThreads, openThreadIds: prevOpen, currentThreadId } = this._s.state;

    // удаляем тред из allThreads
    const newThreads = { ...currentThreads };
    delete newThreads[threadId];
    this._s.clearMessageQueue(threadId);

    const openThreadIds = prevOpen.filter((id: string) => id !== threadId);

    // persist обновлённый список тредов
    this._s._storeAllThreads(newThreads, openThreadIds);

    if (currentThreadId === threadId) {
      if (openThreadIds.length > 0) {
        this._s._setState({
          allThreads: newThreads,
          openThreadIds,
          currentThreadId: openThreadIds[openThreadIds.length - 1],
        });
      } else {
        this._s._setState({ allThreads: newThreads, openThreadIds: [] });
        this._s.openNewThread();
      }
      return;
    }

    this._s._setState({ allThreads: newThreads, openThreadIds });
  }

  duplicateThread(threadId: string) {
    const { allThreads: currentThreads, openThreadIds } = this._s.state;
    const threadToDuplicate = currentThreads[threadId];
    if (!threadToDuplicate) return;
    const newThread = {
      ...deepClone(threadToDuplicate),
      id: generateUuid(),
      pinned: false,
    };
    const newThreads = {
      ...currentThreads,
      [newThread.id]: newThread,
    };
    this._s._storeAllThreads(newThreads, openThreadIds);
    this._s._setState({ allThreads: newThreads });
  }

  createFolder(name: string, parentId: string | null): string {
    const trimmed = name.trim() || 'Новая папка';
    const parent =
      parentId && this._s.state.folders.some((folder: ChatFolder) => folder.id === parentId)
        ? parentId
        : null;
    const siblings = this._s.state.folders.filter(
      (folder: ChatFolder) => folder.parentId === parent,
    );
    const order =
      siblings.reduce((max: number, folder: ChatFolder) => Math.max(max, folder.order), -1) + 1;
    const folder: ChatFolder = {
      id: generateUuid(),
      name: trimmed,
      parentId: parent,
      order,
    };
    const folders = [...this._s.state.folders, folder];
    this._s._setState({ folders });
    this._s._storeAllThreads(this._s.state.allThreads, this._s.state.openThreadIds, folders);
    return folder.id;
  }

  renameFolder(folderId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!this._s.state.folders.some((folder: ChatFolder) => folder.id === folderId)) return;
    const folders = this._s.state.folders.map((folder: ChatFolder) =>
      folder.id === folderId ? { ...folder, name: trimmed } : folder,
    );
    this._s._setState({ folders });
    this._s._storeAllThreads(this._s.state.allThreads, this._s.state.openThreadIds, folders);
  }

  deleteFolder(folderId: string): void {
    const folder = this._s.state.folders.find((item: ChatFolder) => item.id === folderId);
    if (!folder) return;
    const parentId = folder.parentId;
    const folders = this._s.state.folders
      .filter((item: ChatFolder) => item.id !== folderId)
      .map((item: ChatFolder) => (item.parentId === folderId ? { ...item, parentId } : item));
    const allThreads: ChatThreads = { ...this._s.state.allThreads };
    for (const threadId of Object.keys(allThreads)) {
      const thread = allThreads[threadId];
      if (thread?.folderId === folderId) {
        allThreads[threadId] = { ...thread, folderId: parentId };
      }
    }
    this._s._setState({ folders, allThreads });
    this._s._storeAllThreads(allThreads, this._s.state.openThreadIds, folders);
  }

  moveThreadToFolder(threadId: string, folderId: string | null): void {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;
    if (folderId && !this._s.state.folders.some((folder: ChatFolder) => folder.id === folderId))
      return;
    if ((thread.folderId ?? null) === (folderId ?? null)) return;
    const allThreads: ChatThreads = {
      ...this._s.state.allThreads,
      [threadId]: { ...thread, folderId },
    };
    this._s._setState({ allThreads });
    this._s._storeAllThreads(allThreads);
  }

  moveFolder(folderId: string, newParentId: string | null): void {
    const folder = this._s.state.folders.find((item: ChatFolder) => item.id === folderId);
    if (!folder) return;
    if (newParentId && !this._s.state.folders.some((item: ChatFolder) => item.id === newParentId))
      return;
    if (folder.parentId === newParentId) return;
    if (folderWouldCreateCycle(this._s.state.folders, folderId, newParentId)) return;
    const siblings = this._s.state.folders.filter(
      (item: ChatFolder) => item.parentId === newParentId && item.id !== folderId,
    );
    const order =
      siblings.reduce((max: number, item: ChatFolder) => Math.max(max, item.order), -1) + 1;
    const folders = this._s.state.folders.map((item: ChatFolder) =>
      item.id === folderId ? { ...item, parentId: newParentId, order } : item,
    );
    this._s._setState({ folders });
    this._s._storeAllThreads(this._s.state.allThreads, this._s.state.openThreadIds, folders);
  }

  reorderFolder(folderId: string, beforeSiblingId: string | null): void {
    const folders = reorderFolderAmongSiblings(this._s.state.folders, folderId, beforeSiblingId);
    if (!folders) return;
    this._s._setState({ folders });
    this._s._storeAllThreads(this._s.state.allThreads, this._s.state.openThreadIds, folders);
  }

  setThreadPinned(threadId: string, pinned: boolean): void {
    const thread = this._s.state.allThreads[threadId];
    if (!thread || !!thread.pinned === pinned) return;
    const allThreads: ChatThreads = {
      ...this._s.state.allThreads,
      [threadId]: { ...thread, pinned },
    };
    this._s._setState({ allThreads });
    this._s._storeAllThreads(allThreads);
  }

  getChatHistorySummary(opts?: { threadId?: string | null }): string {
    const { allThreads, currentThreadId, openThreadIds } = this._s.state;
    const ephemeral: Set<string> | undefined = this._s._ephemeralThreadIds;
    const visibleThreads = ephemeral?.size
      ? Object.fromEntries(
          Object.entries(allThreads).filter(([id]) => !ephemeral.has(id)),
        )
      : allThreads;
    return buildChatHistorySummary({
      allThreads: visibleThreads,
      currentThreadId,
      openThreadIds,
      threadId: opts?.threadId ?? null,
    });
  }
}
