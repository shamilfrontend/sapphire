<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  PPR Code — folder tree of chats in the Режим Агент sidebar.
 *--------------------------------------------------------------------------------------*/

import { computed, nextTick, provide, reactive, ref, watch } from 'vue';
import {
  CHAT_DATE_GROUP_ORDER,
  ChatDateGroup,
  ChatFolder,
  chatDateGroup,
  collectDescendantFolderIds,
  folderWouldCreateCycle,
} from '../../../../common/chatFolders.js';
import { ThreadType } from '../../../chatThreadService.js';
import { useAccessor, useChatThreadsState, useFullChatThreadsStreamState } from '../util/services.js';
import { threadTitle } from '../util/threadDisplay.js';
import AgentsFolderNode from './AgentsFolderNode.vue';
import AgentsThreadRow from './AgentsThreadRow.vue';
import {
  agentsTreeKey,
  AgentsTreeApi,
  DATE_LABELS,
  DragPayload,
  DropTarget,
  loadExpanded,
  MenuState,
  persistExpanded,
  readDrag,
  sameDrop,
} from './threadTree.js';

const props = defineProps<{
  filterText: string;
  editingFolderId: string | null;
  onEditingFolderIdChange?: (folderId: string | null) => void;
  onThreadOpen?: () => void;
}>();

const emit = defineEmits<{
  editingFolderIdChange: [folderId: string | null];
  threadOpen: [];
}>();

const changeEditingFolderId = (folderId: string | null) => {
  props.onEditingFolderIdChange?.(folderId);
  emit('editingFolderIdChange', folderId);
};

const notifyThreadOpen = () => {
  props.onThreadOpen?.();
  emit('threadOpen');
};

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');
const threadsState = useChatThreadsState();
const streamState = useFullChatThreadsStreamState();

const expanded = ref<Set<string> | null>(loadExpanded());
const dropTarget = ref<DropTarget | null>(null);
const menu = ref<MenuState | null>(null);
const confirmDelete = ref(false);
const draftNameRef = ref('');
const menuRef = ref<HTMLDivElement | null>(null);
let dragging: DragPayload | null = null;

const query = computed(() => props.filterText.trim().toLowerCase());
const folderIds = computed(() => new Set(threadsState.value.folders.map((folder) => folder.id)));

const grouped = computed(() => {
  const byFolder = new Map<string, ThreadType[]>();
  const pinned: ThreadType[] = [];
  const byDate = new Map<ChatDateGroup, ThreadType[]>();
  const now = new Date();
  const q = query.value;
  const ids = folderIds.value;
  const folders = threadsState.value.folders;
  const allThreads = threadsState.value.allThreads;
  const currentThreadId = threadsState.value.currentThreadId;

  const folderNameHit = (folderId: string | null | undefined): boolean => {
    const seen = new Set<string>();
    let current = folderId && ids.has(folderId) ? folderId : null;
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = folders.find((item) => item.id === current);
      if (!folder) return false;
      if (folder.name.toLowerCase().includes(q)) return true;
      current = folder.parentId;
    }
    return false;
  };

  for (const thread of Object.values(allThreads)) {
    if (!thread) continue;
    if (thread.messages.length === 0 && thread.id !== currentThreadId) continue;
    const titleHit = threadTitle(thread).toLowerCase().includes(q);
    if (q && !titleHit && !folderNameHit(thread.folderId)) continue;
    if (thread.pinned) {
      pinned.push(thread);
      continue;
    }
    const key = thread.folderId && ids.has(thread.folderId) ? thread.folderId : null;
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
});

const folderVisible = (folderId: string, seen = new Set<string>()): boolean => {
  const q = query.value;
  if (!q) return true;
  if (seen.has(folderId)) return false;
  seen.add(folderId);
  const folders = threadsState.value.folders;
  const folder = folders.find((item) => item.id === folderId);
  if (folder?.name.toLowerCase().includes(q)) return true;
  if ((grouped.value.threadsByFolder.get(folderId) ?? []).length > 0) return true;
  return folders.some((item) => item.parentId === folderId && folderVisible(item.id, seen));
};

const childFolders = (parentId: string | null, visibleOnly: boolean): ChatFolder[] =>
  threadsState.value.folders
    .filter((folder) => folder.parentId === parentId)
    .filter((folder) => !visibleOnly || folderVisible(folder.id))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));

const isExpanded = (folderId: string) => {
  if (query.value) return true;
  if (expanded.value === null) return true;
  return expanded.value.has(folderId);
};

const toggleExpanded = (folderId: string) => {
  const prev = expanded.value;
  const next = new Set(prev ?? threadsState.value.folders.map((folder) => folder.id));
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);
  persistExpanded(next);
  expanded.value = next;
};

const expandFolder = (folderId: string) => {
  const prev = expanded.value;
  const next = new Set(prev ?? threadsState.value.folders.map((folder) => folder.id));
  next.add(folderId);
  persistExpanded(next);
  expanded.value = next;
};

const openMenu = (kind: MenuState['kind'], id: string, target: HTMLElement) => {
  const rect = target.getBoundingClientRect();
  const menuHeight = 280;
  const top =
    rect.bottom + 4 + menuHeight > window.innerHeight
      ? Math.max(8, rect.top - menuHeight - 4)
      : rect.bottom + 4;
  confirmDelete.value = false;
  menu.value = {
    kind,
    id,
    top,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 220)),
  };
};

const commitRename = () => {
  const editingFolderId = props.editingFolderId;
  if (!editingFolderId) return;
  const folder = threadsState.value.folders.find((item) => item.id === editingFolderId);
  const next = draftNameRef.value.trim();
  if (folder && next && next !== folder.name) {
    chatThreadsService.renameFolder(editingFolderId, next);
  }
  changeEditingFolderId(null);
};

const cancelRename = () => {
  changeEditingFolderId(null);
};

const setDraftName = (value: string) => {
  draftNameRef.value = value;
};

// Проверка DnD папки: без циклов parent и без drop «в себя»
const folderDropAllowed = (intent: DropTarget): boolean => {
  const data = dragging;
  if (!data || data.kind !== 'folder') return true;
  const folders = threadsState.value.folders;
  if (intent.kind === 'before' && intent.folderId === data.id) return false;
  if (intent.kind === 'inside') return !folderWouldCreateCycle(folders, data.id, intent.folderId);
  const parentId =
    intent.kind === 'before'
      ? (folders.find((folder) => folder.id === intent.folderId)?.parentId ?? null)
      : null;
  return !folderWouldCreateCycle(folders, data.id, parentId);
};

const showDrop = (intent: DropTarget) => {
  dropTarget.value = sameDrop(dropTarget.value, intent) ? dropTarget.value : intent;
};

const handleDrop = (intent: DropTarget, dataTransfer: DataTransfer | null) => {
  dropTarget.value = null;
  const data = (dataTransfer ? readDrag(dataTransfer) : null) ?? dragging;
  dragging = null;
  if (!data) return;
  const folders = threadsState.value.folders;

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

const onFolderDragOver = (event: DragEvent, folderId: string) => {
  event.preventDefault();
  event.stopPropagation();
  const data = dragging;
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || !event.dataTransfer) return;
  const rect = current.getBoundingClientRect();
  const before = data?.kind === 'folder' && event.clientY - rect.top < rect.height * 0.28;
  const intent: DropTarget = before ? { kind: 'before', folderId } : { kind: 'inside', folderId };
  if (!folderDropAllowed(intent)) {
    event.dataTransfer.dropEffect = 'none';
    dropTarget.value = null;
    return;
  }
  event.dataTransfer.dropEffect = 'move';
  showDrop(intent);
};

const onFolderDrop = (event: DragEvent, folderId: string) => {
  event.preventDefault();
  event.stopPropagation();
  const data = dragging;
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement)) return;
  const rect = current.getBoundingClientRect();
  const before = data?.kind === 'folder' && event.clientY - rect.top < rect.height * 0.28;
  handleDrop(
    before ? { kind: 'before', folderId } : { kind: 'inside', folderId },
    event.dataTransfer,
  );
};

const onFolderBodyDragOver = (event: DragEvent, folderId: string) => {
  event.preventDefault();
  event.stopPropagation();
  if (!event.dataTransfer) return;
  const intent: DropTarget = { kind: 'inside', folderId };
  if (!folderDropAllowed(intent)) {
    event.dataTransfer.dropEffect = 'none';
    dropTarget.value = null;
    return;
  }
  event.dataTransfer.dropEffect = 'move';
  showDrop(intent);
};

const onFolderBodyDrop = (event: DragEvent, folderId: string) => {
  event.preventDefault();
  event.stopPropagation();
  handleDrop({ kind: 'inside', folderId }, event.dataTransfer);
};

const onThreadDragOver = (event: DragEvent, thread: ThreadType) => {
  event.preventDefault();
  event.stopPropagation();
  if (!event.dataTransfer) return;
  const ids = folderIds.value;
  const threadFolderId = thread.folderId && ids.has(thread.folderId) ? thread.folderId : null;
  const intent: DropTarget = threadFolderId
    ? { kind: 'inside', folderId: threadFolderId }
    : { kind: 'root' };
  if (!folderDropAllowed(intent)) {
    event.dataTransfer.dropEffect = 'none';
    dropTarget.value = null;
    return;
  }
  event.dataTransfer.dropEffect = 'move';
  showDrop(intent);
};

const onThreadDrop = (event: DragEvent, thread: ThreadType) => {
  event.preventDefault();
  event.stopPropagation();
  const ids = folderIds.value;
  const threadFolderId = thread.folderId && ids.has(thread.folderId) ? thread.folderId : null;
  handleDrop(
    threadFolderId ? { kind: 'inside', folderId: threadFolderId } : { kind: 'root' },
    event.dataTransfer,
  );
};

const startDrag = (event: DragEvent, payload: DragPayload) => {
  if (!event.dataTransfer) return;
  dragging = payload;
  const raw = JSON.stringify(payload);
  event.dataTransfer.setData('application/x-ppr-chat-node', raw);
  event.dataTransfer.setData('text/plain', raw);
  event.dataTransfer.effectAllowed = 'move';
};

const onThreadClick = (threadId: string) => {
  chatThreadsService.openTab(threadId);
  notifyThreadOpen();
};

const api: AgentsTreeApi = reactive({
  get currentThreadId() {
    return threadsState.value.currentThreadId;
  },
  get streamState() {
    return streamState.value;
  },
  get folderIds() {
    return folderIds.value;
  },
  get dropTarget() {
    return dropTarget.value;
  },
  get editingFolderId() {
    return props.editingFolderId;
  },
  get draftName() {
    return draftNameRef.value;
  },
  set draftName(value: string) {
    draftNameRef.value = value;
  },
  isExpanded,
  toggleExpanded,
  childFolders,
  threadsOf: (folderId: string) => grouped.value.threadsByFolder.get(folderId) ?? [],
  startDrag,
  onFolderDragOver,
  onFolderDrop,
  onFolderBodyDragOver,
  onFolderBodyDrop,
  onThreadDragOver,
  onThreadDrop,
  onThreadClick,
  openMenu,
  commitRename,
  setDraftName,
  cancelRename,
});

provide(agentsTreeKey, api);

watch(
  () => props.editingFolderId,
  (editingFolderId) => {
    if (!editingFolderId) return;
    const folderList = threadsState.value.folders;
    const folder = folderList.find((item) => item.id === editingFolderId);
    draftNameRef.value = folder?.name ?? '';
    const prev = expanded.value;
    const next = new Set(prev ?? folderList.map((item) => item.id));
    if (next.has(editingFolderId)) return;
    next.add(editingFolderId);
    persistExpanded(next);
    expanded.value = next;
  },
  { immediate: true },
);

watch(
  menu,
  (current, _prev, onCleanup) => {
    if (!current) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (menuRef.value && target instanceof Node && !menuRef.value.contains(target)) {
        menu.value = null;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') menu.value = null;
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    });
  },
  { immediate: true },
);

watch(
  () => [menu.value, confirmDelete.value] as const,
  async () => {
    await nextTick();
    const node = menuRef.value;
    const current = menu.value;
    if (!current || !node) return;
    const rect = node.getBoundingClientRect();
    const margin = 8;
    let top = current.top;
    let left = current.left;
    if (rect.bottom > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - rect.height);
    }
    if (rect.top < margin) top = margin;
    if (rect.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - rect.width);
    }
    top = Math.round(top);
    left = Math.round(left);
    if (top !== current.top || left !== current.left) {
      menu.value = { ...current, top, left };
    }
  },
  { flush: 'post', immediate: true },
);

const rootFolders = computed(() => childFolders(null, true));
const nothingToShow = computed(() => {
  const byDate = grouped.value.threadsByDate;
  return (
    rootFolders.value.length === 0 &&
    grouped.value.pinnedThreads.length === 0 &&
    CHAT_DATE_GROUP_ORDER.every((group) => (byDate.get(group) ?? []).length === 0)
  );
});

const menuFolder = computed(() =>
  menu.value?.kind === 'folder'
    ? threadsState.value.folders.find((folder) => folder.id === menu.value?.id)
    : undefined,
);
const menuThread = computed(() =>
  menu.value?.kind === 'thread' ? threadsState.value.allThreads[menu.value.id] : undefined,
);
const menuSiblings = computed(() =>
  menuFolder.value ? childFolders(menuFolder.value.parentId, false) : [],
);
const menuSiblingIndex = computed(() =>
  menuFolder.value ? menuSiblings.value.findIndex((folder) => folder.id === menuFolder.value?.id) : -1,
);

const flatFolders = (
  parentId: string | null,
  depth: number,
): { folder: ChatFolder; depth: number }[] =>
  childFolders(parentId, false).flatMap((folder) => [
    { folder, depth },
    ...flatFolders(folder.id, depth + 1),
  ]);

const blockedFolderIds = computed(() =>
  menuFolder.value
    ? new Set([menuFolder.value.id, ...collectDescendantFolderIds(threadsState.value.folders, menuFolder.value.id)])
    : new Set<string>(),
);

const folderMoveTargets = computed(() =>
  flatFolders(null, 0).filter(({ folder }) => !blockedFolderIds.value.has(folder.id)),
);
const threadMoveTargets = computed(() => flatFolders(null, 0));

const threadsInGroup = (group: ChatDateGroup) => grouped.value.threadsByDate.get(group) ?? [];

const moveFolderUp = () => {
  const folder = menuFolder.value;
  const index = menuSiblingIndex.value;
  if (!folder || index <= 0) return;
  const before = menuSiblings.value[index - 1];
  if (!before) return;
  chatThreadsService.reorderFolder(folder.id, before.id);
  menu.value = null;
};

const moveFolderDown = () => {
  const folder = menuFolder.value;
  const index = menuSiblingIndex.value;
  const siblings = menuSiblings.value;
  if (!folder || index < 0 || index >= siblings.length - 1) return;
  chatThreadsService.reorderFolder(folder.id, siblings[index + 2]?.id ?? null);
  menu.value = null;
};

const createSubfolder = () => {
  const folder = menuFolder.value;
  if (!folder) return;
  const id = chatThreadsService.createFolder('Новая папка', folder.id);
  expandFolder(folder.id);
  changeEditingFolderId(id);
  menu.value = null;
};

const createChatInFolder = () => {
  const folder = menuFolder.value;
  if (!folder) return;
  chatThreadsService.openNewThread(folder.id);
  notifyThreadOpen();
  menu.value = null;
};

const moveMenuFolder = (parentId: string | null) => {
  const folder = menuFolder.value;
  if (!folder) return;
  chatThreadsService.moveFolder(folder.id, parentId);
  if (parentId) expandFolder(parentId);
  menu.value = null;
};

const deleteMenuFolder = () => {
  const folder = menuFolder.value;
  if (!folder) return;
  chatThreadsService.deleteFolder(folder.id);
  menu.value = null;
};

const togglePin = () => {
  const thread = menuThread.value;
  if (!thread) return;
  chatThreadsService.setThreadPinned(thread.id, !thread.pinned);
  menu.value = null;
};

const moveMenuThread = (folderId: string | null) => {
  const thread = menuThread.value;
  if (!thread) return;
  chatThreadsService.moveThreadToFolder(thread.id, folderId);
  if (folderId) expandFolder(folderId);
  menu.value = null;
};

const duplicateMenuThread = () => {
  const thread = menuThread.value;
  if (!thread) return;
  chatThreadsService.duplicateThread(thread.id);
  menu.value = null;
};

const deleteMenuThread = () => {
  const thread = menuThread.value;
  if (!thread) return;
  chatThreadsService.deleteThread(thread.id);
  menu.value = null;
};

const renameMenuFolder = () => {
  const folder = menuFolder.value;
  if (!folder) return;
  changeEditingFolderId(folder.id);
  menu.value = null;
};

const onRootDragOver = (event: DragEvent) => {
  event.preventDefault();
  const intent: DropTarget = { kind: 'root' };
  if (!event.dataTransfer) return;
  if (!folderDropAllowed(intent)) {
    event.dataTransfer.dropEffect = 'none';
    dropTarget.value = null;
    return;
  }
  event.dataTransfer.dropEffect = 'move';
  if (event.target === event.currentTarget) showDrop(intent);
};

const onRootDrop = (event: DragEvent) => {
  if (event.target !== event.currentTarget && event.defaultPrevented) return;
  event.preventDefault();
  handleDrop({ kind: 'root' }, event.dataTransfer);
};

const onDragEnd = () => {
  dragging = null;
  dropTarget.value = null;
};
</script>

<template>
  <div
    class="flex flex-col gap-0.5 w-full text-void-fg-3 select-none min-h-[48px]"
    :class="dropTarget?.kind === 'root' ? 'bg-[#00b0cc]/10 rounded' : ''"
    @dragover="onRootDragOver"
    @drop="onRootDrop"
    @dragend="onDragEnd"
  >
    <div v-if="nothingToShow" class="p-1 text-xs opacity-70">
      {{ query ? 'Ничего не найдено' : 'Нет сохранённых чатов' }}
    </div>
    <template v-else>
      <div v-if="grouped.pinnedThreads.length > 0">
        <div class="px-2 pt-3 pb-1 text-xs text-void-fg-3">Закреплённые</div>
        <AgentsThreadRow
          v-for="thread in grouped.pinnedThreads"
          :key="thread.id"
          :thread="thread"
          :depth="0"
        />
      </div>
      <div v-if="rootFolders.length > 0">
        <div class="px-2 pt-3 pb-1 text-xs text-void-fg-3">Папки</div>
        <AgentsFolderNode
          v-for="folder in rootFolders"
          :key="folder.id"
          :folder="folder"
          :depth="0"
        />
      </div>
      <template v-for="group in CHAT_DATE_GROUP_ORDER" :key="group">
        <div v-if="threadsInGroup(group).length > 0">
          <div class="px-2 pt-3 pb-1 text-xs text-void-fg-3">{{ DATE_LABELS[group] }}</div>
          <AgentsThreadRow
            v-for="thread in threadsInGroup(group)"
            :key="thread.id"
            :thread="thread"
            :depth="0"
          />
        </div>
      </template>
    </template>

    <div
      v-if="menu && (menuFolder || menuThread)"
      ref="menuRef"
      class="fixed z-[1000] min-w-[200px] max-w-[260px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-md border border-void-border-2 bg-void-bg-1 shadow-lg p-1 text-sm"
      :style="{ top: `${menu.top}px`, left: `${menu.left}px` }"
    >
      <template v-if="menu.kind === 'folder' && menuFolder">
        <div v-if="confirmDelete" class="p-1 flex flex-col gap-1">
          <div class="text-xs text-void-fg-3 px-1">Чаты и подпапки перейдут на уровень выше.</div>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
            @click="confirmDelete = false"
          >
            Отмена
          </button>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover text-red-400"
            @click="deleteMenuFolder"
          >
            Удалить папку
          </button>
        </div>
        <div v-else class="flex flex-col">
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
            @click="renameMenuFolder"
          >
            Переименовать
          </button>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover disabled:opacity-40"
            :disabled="menuSiblingIndex <= 0"
            @click="moveFolderUp"
          >
            Выше
          </button>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover disabled:opacity-40"
            :disabled="menuSiblingIndex < 0 || menuSiblingIndex >= menuSiblings.length - 1"
            @click="moveFolderDown"
          >
            Ниже
          </button>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
            @click="createSubfolder"
          >
            Новая подпапка
          </button>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
            @click="createChatInFolder"
          >
            Новый чат
          </button>
          <div class="px-2 pt-1 pb-0.5 text-xs text-void-fg-3">Переместить в папку</div>
          <div class="max-h-48 overflow-y-auto">
            <button
              type="button"
              class="w-full text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
              @click="moveMenuFolder(null)"
            >
              Без папки
            </button>
            <button
              v-for="({ folder, depth }) in folderMoveTargets"
              :key="folder.id"
              type="button"
              class="w-full text-left py-1 pr-2 rounded hover:bg-void-bg-2-hover truncate"
              :style="{ paddingLeft: `${8 + depth * 12}px` }"
              @click="moveMenuFolder(folder.id)"
            >
              {{ folder.name }}
            </button>
          </div>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover text-red-400"
            @click="confirmDelete = true"
          >
            Удалить
          </button>
        </div>
      </template>
      <template v-if="menu.kind === 'thread' && menuThread">
        <div v-if="confirmDelete" class="p-1 flex flex-col gap-1">
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
            @click="confirmDelete = false"
          >
            Отмена
          </button>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover text-red-400"
            @click="deleteMenuThread"
          >
            Удалить чат
          </button>
        </div>
        <div v-else class="flex flex-col">
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
            @click="togglePin"
          >
            {{ menuThread.pinned ? 'Открепить' : 'Закрепить' }}
          </button>
          <div class="px-2 pt-1 pb-0.5 text-xs text-void-fg-3">Переместить в папку</div>
          <div class="max-h-48 overflow-y-auto">
            <button
              type="button"
              class="w-full text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
              @click="moveMenuThread(null)"
            >
              Без папки
            </button>
            <button
              v-for="({ folder, depth }) in threadMoveTargets"
              :key="folder.id"
              type="button"
              class="w-full text-left py-1 pr-2 rounded hover:bg-void-bg-2-hover truncate"
              :style="{ paddingLeft: `${8 + depth * 12}px` }"
              @click="moveMenuThread(folder.id)"
            >
              {{ folder.name }}
            </button>
          </div>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover"
            @click="duplicateMenuThread"
          >
            Дублировать
          </button>
          <button
            type="button"
            class="text-left px-2 py-1 rounded hover:bg-void-bg-2-hover text-red-400"
            @click="confirmDelete = true"
          >
            Удалить
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
