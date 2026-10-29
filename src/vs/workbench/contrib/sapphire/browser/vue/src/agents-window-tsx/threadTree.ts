/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { InjectionKey } from 'vue';
import {
  ChatDateGroup,
  ChatFolder,
} from '../../../../common/chatFolders.js';
import { ThreadType, ThreadStreamState } from '../../../chatThreadService.js';

export const EXPANDED_KEY = 'sapphire.agentsExpandedFolders';
const LEGACY_EXPANDED_KEY = 'ppr.agentsExpandedFolders';
export const DRAG_MIME = 'application/x-sapphire-chat-node';

export const DATE_LABELS: Record<ChatDateGroup, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  week: '7 дней',
  month: '30 дней',
  older: 'Ранее',
};

export type DragPayload = { kind: 'folder' | 'thread'; id: string };

export type DropTarget =
  | { kind: 'inside'; folderId: string }
  | { kind: 'before'; folderId: string }
  | { kind: 'root' };

export type MenuState = {
  kind: 'folder' | 'thread';
  id: string;
  top: number;
  left: number;
};

export type AgentsTreeApi = {
  currentThreadId: string;
  streamState: ThreadStreamState;
  folderIds: Set<string>;
  dropTarget: DropTarget | null;
  editingFolderId: string | null;
  draftName: string;
  isExpanded: (folderId: string) => boolean;
  toggleExpanded: (folderId: string) => void;
  childFolders: (parentId: string | null, visibleOnly: boolean) => ChatFolder[];
  threadsOf: (folderId: string) => ThreadType[];
  startDrag: (event: DragEvent, payload: DragPayload) => void;
  onFolderDragOver: (event: DragEvent, folderId: string) => void;
  onFolderDrop: (event: DragEvent, folderId: string) => void;
  onFolderBodyDragOver: (event: DragEvent, folderId: string) => void;
  onFolderBodyDrop: (event: DragEvent, folderId: string) => void;
  onThreadDragOver: (event: DragEvent, thread: ThreadType) => void;
  onThreadDrop: (event: DragEvent, thread: ThreadType) => void;
  onThreadClick: (threadId: string) => void;
  openMenu: (kind: MenuState['kind'], id: string, target: HTMLElement) => void;
  commitRename: () => void;
  setDraftName: (value: string) => void;
  cancelRename: () => void;
};

export const agentsTreeKey: InjectionKey<AgentsTreeApi> = Symbol('agentsTree');

export const readDrag = (dataTransfer: DataTransfer): DragPayload | null => {
  const raw = dataTransfer.getData(DRAG_MIME) || dataTransfer.getData('text/plain');
  if (!raw) {return null;}
  try {
    const data = JSON.parse(raw) as Partial<DragPayload>;
    if ((data.kind === 'folder' || data.kind === 'thread') && typeof data.id === 'string') {
      return { kind: data.kind, id: data.id };
    }
  } catch {
    return null;
  }
  return null;
};

export const loadExpanded = (): Set<string> | null => {
  try {
    let raw = localStorage.getItem(EXPANDED_KEY);
    if (raw === null) {
      const legacy = localStorage.getItem(LEGACY_EXPANDED_KEY);
      if (legacy !== null) {
        localStorage.setItem(EXPANDED_KEY, legacy);
        localStorage.removeItem(LEGACY_EXPANDED_KEY);
        raw = legacy;
      }
    }
    if (raw === null) {return null;}
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {return null;}
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return null;
  }
};

export const persistExpanded = (ids: Set<string>) => {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
    localStorage.removeItem(LEGACY_EXPANDED_KEY);
  } catch {
    // localStorage недоступен (квота / приватный режим)
  }
};

export const sameDrop = (a: DropTarget | null, b: DropTarget | null) => {
  if (a === b) {return true;}
  if (!a || !b) {return false;}
  if (a.kind === 'root' || b.kind === 'root') {return a.kind === b.kind;}
  return a.kind === b.kind && a.folderId === b.folderId;
};
