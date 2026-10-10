/*--------------------------------------------------------------------------------------
 *  PPR Code — folder tree of chats in the Режим Агент sidebar.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  LoaderCircle,
  MessageCircleQuestion,
  MoreHorizontal,
} from 'lucide-react';
import {
  CHAT_DATE_GROUP_ORDER,
  ChatDateGroup,
  ChatFolder,
  chatDateGroup,
  collectDescendantFolderIds,
  folderWouldCreateCycle,
} from '../../../../common/chatFolders.js';
import { ThreadType } from '../../../chatThreadService.js';
import {
  useAccessor,
  useChatThreadsState,
  useFullChatThreadsStreamState,
} from '../util/services.js';
import { threadActivity, threadTitle } from '../util/threadDisplay.js';

const EXPANDED_KEY = 'ppr.agentsExpandedFolders';
const DRAG_MIME = 'application/x-ppr-chat-node';

const DATE_LABELS: Record<ChatDateGroup, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  week: '7 дней',
  month: '30 дней',
  older: 'Ранее',
};

type DragPayload = { kind: 'folder' | 'thread'; id: string };

type DropTarget =
  { kind: 'inside'; folderId: string } | { kind: 'before'; folderId: string } | { kind: 'root' };

type MenuState = {
  kind: 'folder' | 'thread';
  id: string;
  top: number;
  left: number;
};

const readDrag = (dataTransfer: DataTransfer): DragPayload | null => {
  const raw = dataTransfer.getData(DRAG_MIME) || dataTransfer.getData('text/plain');
  if (!raw) return null;
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

const loadExpanded = (): Set<string> | null => {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((id) => typeof id === 'string'));
  } catch {
    return null;
  }
};

const persistExpanded = (ids: Set<string>) => {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage недоступен (квота / приватный режим)
  }
};

const sameDrop = (a: DropTarget | null, b: DropTarget | null) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind === 'root' || b.kind === 'root') return a.kind === b.kind;
  return a.kind === b.kind && a.folderId === b.folderId;
};

export const AgentsThreadTree = ({
  filterText,
  editingFolderId,
  onEditingFolderIdChange,
  onThreadOpen,
}: {
  filterText: string;
  editingFolderId: string | null;
  onEditingFolderIdChange: (folderId: string | null) => void;
  onThreadOpen?: () => void;
}) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const { allThreads, folders, currentThreadId } = useChatThreadsState();
  const streamState = useFullChatThreadsStreamState();

  const [expanded, setExpanded] = useState<Set<string> | null>(loadExpanded);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftName, setDraftName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<DragPayload | null>(null);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  const query = filterText.trim().toLowerCase();

  useEffect(() => {
    if (!editingFolderId) return;
    const folder = foldersRef.current.find((item) => item.id === editingFolderId);
    setDraftName(folder?.name ?? '');
    setExpanded((prev) => {
      const next = new Set(prev ?? foldersRef.current.map((item) => item.id));
      if (next.has(editingFolderId)) return prev;
      next.add(editingFolderId);
      persistExpanded(next);
      return next;
    });
  }, [editingFolderId]);

  useEffect(() => {
    if (!menu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!menu || !node) return;
    const rect = node.getBoundingClientRect();
    const margin = 8;
    let top = menu.top;
    let left = menu.left;
    if (rect.bottom > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - rect.height);
    }
    if (rect.top < margin) top = margin;
    if (rect.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - rect.width);
    }
    top = Math.round(top);
    left = Math.round(left);
    if (top !== menu.top || left !== menu.left) {
      setMenu((current) => (current ? { ...current, top, left } : current));
    }
  }, [confirmDelete, menu]);

  const folderIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);

  const { threadsByFolder, pinnedThreads, threadsByDate } = useMemo(() => {
    const byFolder = new Map<string, ThreadType[]>();
    const pinned: ThreadType[] = [];
    const byDate = new Map<ChatDateGroup, ThreadType[]>();
    const now = new Date();

    const folderNameHit = (folderId: string | null | undefined): boolean => {
      const seen = new Set<string>();
      let current = folderId && folderIds.has(folderId) ? folderId : null;
      while (current && !seen.has(current)) {
        seen.add(current);
        const folder = folders.find((item) => item.id === current);
        if (!folder) return false;
        if (folder.name.toLowerCase().includes(query)) return true;
        current = folder.parentId;
      }
      return false;
    };

    for (const thread of Object.values(allThreads)) {
      if (!thread) continue;
      if (thread.messages.length === 0 && thread.id !== currentThreadId) continue;
      const titleHit = threadTitle(thread).toLowerCase().includes(query);
      if (query && !titleHit && !folderNameHit(thread.folderId)) continue;
      if (thread.pinned) {
        pinned.push(thread);
        continue;
      }
      const key = thread.folderId && folderIds.has(thread.folderId) ? thread.folderId : null;
      if (key) {
        const list = byFolder.get(key) ?? [];
        list.push(thread);
        byFolder.set(key, list);
        continue;
      }
      const group = chatDateGroup(thread.lastModified, now);
      const list = byDate.get(group) ?? [];
      list.push(thread);
      byDate.set(group, list);
    }

    const byRecent = (a: ThreadType, b: ThreadType) => (a.lastModified < b.lastModified ? 1 : -1);
    pinned.sort(byRecent);
    for (const list of byFolder.values()) list.sort(byRecent);
    for (const list of byDate.values()) list.sort(byRecent);
    return { threadsByFolder: byFolder, pinnedThreads: pinned, threadsByDate: byDate };
  }, [allThreads, currentThreadId, folderIds, folders, query]);

  const folderVisible = (folderId: string, seen = new Set<string>()): boolean => {
    if (!query) return true;
    if (seen.has(folderId)) return false;
    seen.add(folderId);
    const folder = folders.find((item) => item.id === folderId);
    if (folder?.name.toLowerCase().includes(query)) return true;
    if ((threadsByFolder.get(folderId) ?? []).length > 0) return true;
    return folders.some((folder) => folder.parentId === folderId && folderVisible(folder.id, seen));
  };

  const childFolders = (parentId: string | null, visibleOnly: boolean): ChatFolder[] =>
    folders
      .filter((folder) => folder.parentId === parentId)
      .filter((folder) => !visibleOnly || folderVisible(folder.id))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));

  const isExpanded = (folderId: string) => {
    if (query) return true;
    if (expanded === null) return true;
    return expanded.has(folderId);
  };

  const toggleExpanded = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev ?? folders.map((folder) => folder.id));
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      persistExpanded(next);
      return next;
    });
  };

  const expandFolder = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev ?? folders.map((folder) => folder.id));
      next.add(folderId);
      persistExpanded(next);
      return next;
    });
  };

  const openMenu = (kind: MenuState['kind'], id: string, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const menuHeight = 280;
    const top =
      rect.bottom + 4 + menuHeight > window.innerHeight
        ? Math.max(8, rect.top - menuHeight - 4)
        : rect.bottom + 4;
    setConfirmDelete(false);
    setMenu({
      kind,
      id,
      top,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 220)),
    });
  };

  const commitRename = () => {
    if (!editingFolderId) return;
    const folder = folders.find((item) => item.id === editingFolderId);
    const next = draftName.trim();
    if (folder && next && next !== folder.name) {
      chatThreadsService.renameFolder(editingFolderId, next);
    }
    onEditingFolderIdChange(null);
  };

  // Проверка DnD папки: без циклов parent и без drop «в себя»
  const folderDropAllowed = (intent: DropTarget): boolean => {
    const data = dragging.current;
    if (!data || data.kind !== 'folder') return true;
    if (intent.kind === 'before' && intent.folderId === data.id) return false;
    if (intent.kind === 'inside') return !folderWouldCreateCycle(folders, data.id, intent.folderId);
    const parentId =
      intent.kind === 'before'
        ? (folders.find((folder) => folder.id === intent.folderId)?.parentId ?? null)
        : null;
    return !folderWouldCreateCycle(folders, data.id, parentId);
  };

  const showDrop = (intent: DropTarget) => {
    setDropTarget((prev) => (sameDrop(prev, intent) ? prev : intent));
  };

  const handleDrop = (intent: DropTarget, dataTransfer: DataTransfer) => {
    setDropTarget(null);
    const data = readDrag(dataTransfer) ?? dragging.current;
    dragging.current = null;
    if (!data) return;

    if (data.kind === 'thread') {
      if (intent.kind === 'inside') {
        chatThreadsService.moveThreadToFolder(data.id, intent.folderId);
        expandFolder(intent.folderId);
      } else if (intent.kind === 'root') {
        chatThreadsService.moveThreadToFolder(data.id, null);
      } else {
        const parentId = folders.find((folder) => folder.id === intent.folderId)?.parentId ?? null;
        chatThreadsService.moveThreadToFolder(data.id, parentId);
      }
      return;
    }

    if (intent.kind === 'inside') {
      if (folderWouldCreateCycle(folders, data.id, intent.folderId)) return;
      chatThreadsService.moveFolder(data.id, intent.folderId);
      expandFolder(intent.folderId);
      return;
    }

    if (intent.kind === 'root') {
      chatThreadsService.moveFolder(data.id, null);
      return;
    }

    const target = folders.find((folder) => folder.id === intent.folderId);
    if (!target || intent.folderId === data.id) return;
    const parentId = target.parentId;
    if (folderWouldCreateCycle(folders, data.id, parentId)) return;
    const dragged = folders.find((folder) => folder.id === data.id);
    if (dragged && dragged.parentId !== parentId) {
      chatThreadsService.moveFolder(data.id, parentId);
    }
    chatThreadsService.reorderFolder(data.id, intent.folderId);
  };

  const onFolderDragOver = (event: DragEvent<HTMLDivElement>, folderId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const data = dragging.current;
    const rect = event.currentTarget.getBoundingClientRect();
    const before = data?.kind === 'folder' && event.clientY - rect.top < rect.height * 0.28;
    const intent: DropTarget = before ? { kind: 'before', folderId } : { kind: 'inside', folderId };
    if (!folderDropAllowed(intent)) {
      event.dataTransfer.dropEffect = 'none';
      setDropTarget(null);
      return;
    }
    event.dataTransfer.dropEffect = 'move';
    showDrop(intent);
  };

  const startDrag = (event: DragEvent, payload: DragPayload) => {
    dragging.current = payload;
    const raw = JSON.stringify(payload);
    event.dataTransfer.setData(DRAG_MIME, raw);
    event.dataTransfer.setData('text/plain', raw);
    event.dataTransfer.effectAllowed = 'move';
  };

  const renderThread = (thread: ThreadType, depth: number) => {
    const isCurrent = thread.id === currentThreadId;
    const activity = threadActivity(streamState[thread.id]);
    const threadFolderId =
      thread.folderId && folderIds.has(thread.folderId) ? thread.folderId : null;

    return (
      <div
        key={thread.id}
        draggable
        onDragStart={(event) => startDrag(event, { kind: 'thread', id: thread.id })}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const intent: DropTarget = threadFolderId
            ? { kind: 'inside', folderId: threadFolderId }
            : { kind: 'root' };
          if (!folderDropAllowed(intent)) {
            event.dataTransfer.dropEffect = 'none';
            setDropTarget(null);
            return;
          }
          event.dataTransfer.dropEffect = 'move';
          showDrop(intent);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleDrop(
            threadFolderId ? { kind: 'inside', folderId: threadFolderId } : { kind: 'root' },
            event.dataTransfer,
          );
        }}
        onClick={() => {
          chatThreadsService.openTab(thread.id);
          onThreadOpen?.();
        }}
        className={`group flex items-center gap-1 h-7 pr-1 rounded text-sm cursor-pointer ${
          isCurrent
            ? 'bg-[#00b0cc]/20 text-void-fg-1 font-medium shadow-[inset_2px_0_0_0_#00b0cc]'
            : 'hover:bg-void-bg-2-hover text-void-fg-3'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={threadTitle(thread)}
      >
        {activity === 'running' ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
        ) : activity === 'awaiting' ? (
          <MessageCircleQuestion className="size-3.5 shrink-0" />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <span className="truncate flex-1 min-w-0">{threadTitle(thread)}</span>
        <button
          type="button"
          className="shrink-0 size-5 p-0 border-0 flex items-center justify-center rounded hover:bg-void-bg-2-alt opacity-0 group-hover:opacity-100"
          title="Действия"
          onClick={(event) => {
            event.stopPropagation();
            openMenu('thread', thread.id, event.currentTarget);
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>
    );
  };

  const renderFolder = (folder: ChatFolder, depth: number) => {
    const open = isExpanded(folder.id);
    const editing = editingFolderId === folder.id;
    const isInside = dropTarget?.kind === 'inside' && dropTarget.folderId === folder.id;
    const isBefore = dropTarget?.kind === 'before' && dropTarget.folderId === folder.id;
    const nested = childFolders(folder.id, true);
    const threads = threadsByFolder.get(folder.id) ?? [];
    const empty = nested.length === 0 && threads.length === 0;

    return (
      <div key={folder.id}>
        <div
          draggable={!editing}
          onDragStart={(event) => startDrag(event, { kind: 'folder', id: folder.id })}
          onDragOver={(event) => onFolderDragOver(event, folder.id)}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const data = dragging.current;
            const rect = event.currentTarget.getBoundingClientRect();
            const before = data?.kind === 'folder' && event.clientY - rect.top < rect.height * 0.28;
            handleDrop(
              before
                ? { kind: 'before', folderId: folder.id }
                : { kind: 'inside', folderId: folder.id },
              event.dataTransfer,
            );
          }}
          className={`group flex items-center gap-1 ${editing ? 'min-h-7 py-0.5' : 'h-7'} pr-1 rounded text-sm cursor-pointer ${
            isInside ? 'bg-[#00b0cc]/15 ring-1 ring-[#00b0cc]' : 'hover:bg-void-bg-2-hover'
          }`}
          style={{
            paddingLeft: 4 + depth * 14,
            boxShadow: isBefore ? 'inset 0 2px 0 #00b0cc' : undefined,
          }}
          onClick={() => {
            if (!editing) toggleExpanded(folder.id);
          }}
        >
          <button
            type="button"
            className="size-4 shrink-0 flex items-center justify-center text-void-fg-3"
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded(folder.id);
            }}
            title={open ? 'Свернуть' : 'Развернуть'}
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <Folder className="size-3.5 shrink-0 text-void-fg-3" />
          {editing ? (
            <input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') onEditingFolderIdChange(null);
              }}
              onBlur={commitRename}
              className="flex-1 min-w-0 bg-void-bg-1 border border-void-border-2 rounded px-1 py-0.5 text-sm text-void-fg-1 focus:outline-none"
            />
          ) : (
            <span className="truncate flex-1 min-w-0 text-void-fg-1">{folder.name}</span>
          )}
          <button
            type="button"
            className="shrink-0 size-5 p-0 border-0 flex items-center justify-center rounded hover:bg-void-bg-2-alt opacity-0 group-hover:opacity-100"
            title="Действия"
            onClick={(event) => {
              event.stopPropagation();
              openMenu('folder', folder.id, event.currentTarget);
            }}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </div>
        {open && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const intent: DropTarget = { kind: 'inside', folderId: folder.id };
              if (!folderDropAllowed(intent)) {
                event.dataTransfer.dropEffect = 'none';
                setDropTarget(null);
                return;
              }
              event.dataTransfer.dropEffect = 'move';
              showDrop(intent);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleDrop({ kind: 'inside', folderId: folder.id }, event.dataTransfer);
            }}
          >
            {nested.map((child) => renderFolder(child, depth + 1))}
            {threads.map((thread) => renderThread(thread, depth + 1))}
            {empty && (
              <div
                className="text-xs text-void-fg-3 py-1 min-h-[28px] opacity-70"
                style={{ paddingLeft: 22 + depth * 14 }}
              >
                Пусто
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const rootFolders = childFolders(null, true);
  const nothingToShow =
    rootFolders.length === 0 &&
    pinnedThreads.length === 0 &&
    CHAT_DATE_GROUP_ORDER.every((group) => (threadsByDate.get(group) ?? []).length === 0);

  const menuFolder =
    menu?.kind === 'folder' ? folders.find((folder) => folder.id === menu.id) : undefined;
  const menuThread = menu?.kind === 'thread' ? allThreads[menu.id] : undefined;
  const menuSiblings = menuFolder ? childFolders(menuFolder.parentId, false) : [];
  const menuSiblingIndex = menuFolder
    ? menuSiblings.findIndex((folder) => folder.id === menuFolder.id)
    : -1;

  const flatFolders = (
    parentId: string | null,
    depth: number,
  ): { folder: ChatFolder; depth: number }[] =>
    childFolders(parentId, false).flatMap((folder) => [
      { folder, depth },
      ...flatFolders(folder.id, depth + 1),
    ]);

  const blockedFolderIds = menuFolder
    ? new Set([menuFolder.id, ...collectDescendantFolderIds(folders, menuFolder.id)])
    : new Set<string>();

  const sectionLabel = (label: string) => (
    <div className="px-2 pt-3 pb-1 text-xs text-void-fg-3">{label}</div>
  );

  return (
    <div
      className={`flex flex-col gap-0.5 w-full text-void-fg-3 select-none min-h-[48px] ${
        dropTarget?.kind === 'root' ? 'bg-[#00b0cc]/10 rounded' : ''
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        const intent: DropTarget = { kind: 'root' };
        if (!folderDropAllowed(intent)) {
          event.dataTransfer.dropEffect = 'none';
          setDropTarget(null);
          return;
        }
        event.dataTransfer.dropEffect = 'move';
        if (event.target === event.currentTarget) showDrop(intent);
      }}
      onDrop={(event) => {
        if (event.target !== event.currentTarget && event.defaultPrevented) return;
        event.preventDefault();
        handleDrop({ kind: 'root' }, event.dataTransfer);
      }}
      onDragEnd={() => {
        dragging.current = null;
        setDropTarget(null);
      }}
    >
      {nothingToShow ? (
        <div className="p-1 text-xs opacity-70">
          {query ? 'Ничего не найдено' : 'Нет сохранённых чатов'}
        </div>
      ) : (
        <>
          {pinnedThreads.length > 0 && (
            <div>
              {sectionLabel('Закреплённые')}
              {pinnedThreads.map((thread) => renderThread(thread, 0))}
            </div>
          )}
          {rootFolders.length > 0 && (
            <div>
              {sectionLabel('Папки')}
              {rootFolders.map((folder) => renderFolder(folder, 0))}
            </div>
          )}
          {CHAT_DATE_GROUP_ORDER.map((group) => {
            const threads = threadsByDate.get(group) ?? [];
            if (threads.length === 0) return null;
            return (
              <div key={group}>
                {sectionLabel(DATE_LABELS[group])}
                {threads.map((thread) => renderThread(thread, 0))}
              </div>
            );
          })}
        </>
      )}

      {menu && (menuFolder || menuThread) && (
        <div
          ref={menuRef}
          className="fixed z-[1000] min-w-[200px] max-w-[260px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-md border border-void-border-2 bg-void-bg-1 shadow-lg p-1 text-sm"
          style={{ top: menu.top, left: menu.left }}
        >
          {menu.kind === 'folder' &&
            menuFolder &&
            (confirmDelete ? (
              <div className="p-1 flex flex-col gap-1">
                <div className="text-xs text-void-fg-3 px-1">
                  Чаты и подпапки перейдут на уровень выше.
                </div>
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
                  onClick={() => setConfirmDelete(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover text-red-400"
                  onClick={() => {
                    chatThreadsService.deleteFolder(menuFolder.id);
                    setMenu(null);
                  }}
                >
                  Удалить папку
                </button>
              </div>
            ) : (
              <div className="flex flex-col">
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
                  onClick={() => {
                    onEditingFolderIdChange(menuFolder.id);
                    setMenu(null);
                  }}
                >
                  Переименовать
                </button>
                <button
                  type="button"
                  disabled={menuSiblingIndex <= 0}
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover disabled:opacity-40"
                  onClick={() => {
                    const before = menuSiblings[menuSiblingIndex - 1];
                    if (!before) return;
                    chatThreadsService.reorderFolder(menuFolder.id, before.id);
                    setMenu(null);
                  }}
                >
                  Выше
                </button>
                <button
                  type="button"
                  disabled={menuSiblingIndex < 0 || menuSiblingIndex >= menuSiblings.length - 1}
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover disabled:opacity-40"
                  onClick={() => {
                    chatThreadsService.reorderFolder(
                      menuFolder.id,
                      menuSiblings[menuSiblingIndex + 2]?.id ?? null,
                    );
                    setMenu(null);
                  }}
                >
                  Ниже
                </button>
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
                  onClick={() => {
                    const id = chatThreadsService.createFolder('Новая папка', menuFolder.id);
                    expandFolder(menuFolder.id);
                    onEditingFolderIdChange(id);
                    setMenu(null);
                  }}
                >
                  Новая подпапка
                </button>
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
                  onClick={() => {
                    chatThreadsService.openNewThread(menuFolder.id);
                    onThreadOpen?.();
                    setMenu(null);
                  }}
                >
                  Новый чат
                </button>
                <div className="px-2 pt-1 pb-0.5 text-xs text-void-fg-3">Переместить в папку</div>
                <div className="max-h-48 overflow-y-auto">
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
                    onClick={() => {
                      chatThreadsService.moveFolder(menuFolder.id, null);
                      setMenu(null);
                    }}
                  >
                    Без папки
                  </button>
                  {flatFolders(null, 0)
                    .filter(({ folder }) => !blockedFolderIds.has(folder.id))
                    .map(({ folder, depth }) => (
                      <button
                        key={folder.id}
                        type="button"
                        className="w-full text-left py-1 pr-2 rounded hover:bg-void-bg-2-hover truncate"
                        style={{ paddingLeft: 8 + depth * 12 }}
                        onClick={() => {
                          chatThreadsService.moveFolder(menuFolder.id, folder.id);
                          expandFolder(folder.id);
                          setMenu(null);
                        }}
                      >
                        {folder.name}
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover text-red-400"
                  onClick={() => setConfirmDelete(true)}
                >
                  Удалить
                </button>
              </div>
            ))}
          {menu.kind === 'thread' &&
            menuThread &&
            (confirmDelete ? (
              <div className="p-1 flex flex-col gap-1">
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
                  onClick={() => setConfirmDelete(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover text-red-400"
                  onClick={() => {
                    chatThreadsService.deleteThread(menuThread.id);
                    setMenu(null);
                  }}
                >
                  Удалить чат
                </button>
              </div>
            ) : (
              <div className="flex flex-col">
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
                  onClick={() => {
                    chatThreadsService.setThreadPinned(menuThread.id, !menuThread.pinned);
                    setMenu(null);
                  }}
                >
                  {menuThread.pinned ? 'Открепить' : 'Закрепить'}
                </button>
                <div className="px-2 pt-1 pb-0.5 text-xs text-void-fg-3">Переместить в папку</div>
                <div className="max-h-48 overflow-y-auto">
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
                    onClick={() => {
                      chatThreadsService.moveThreadToFolder(menuThread.id, null);
                      setMenu(null);
                    }}
                  >
                    Без папки
                  </button>
                  {flatFolders(null, 0).map(({ folder, depth }) => (
                    <button
                      key={folder.id}
                      type="button"
                      className="w-full text-left py-1 pr-2 rounded hover:bg-void-bg-2-hover truncate"
                      style={{ paddingLeft: 8 + depth * 12 }}
                      onClick={() => {
                        chatThreadsService.moveThreadToFolder(menuThread.id, folder.id);
                        expandFolder(folder.id);
                        setMenu(null);
                      }}
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
                  onClick={() => {
                    chatThreadsService.duplicateThread(menuThread.id);
                    setMenu(null);
                  }}
                >
                  Дублировать
                </button>
                <button
                  type="button"
                  className="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover text-red-400"
                  onClick={() => setConfirmDelete(true)}
                >
                  Удалить
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
