<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Sapphire — folder tree of chats in the Режим Агент sidebar.
 *--------------------------------------------------------------------------------------*/

import { computed, inject } from 'vue';
import { ChevronDown, ChevronRight, Folder, MoreHorizontal } from 'lucide-vue-next';
import { ChatFolder } from '../../../../common/chatFolders.js';
import { agentsTreeKey } from './threadTree.js';
import AgentsFolderNode from './AgentsFolderNode.vue';
import AgentsThreadRow from './AgentsThreadRow.vue';

const props = defineProps<{
  folder: ChatFolder;
  depth: number;
}>();

const api = inject(agentsTreeKey);
if (!api) {
  throw new Error('AgentsFolderNode must be used inside AgentsThreadTree');
}

const open = computed(() => api.isExpanded(props.folder.id));
const editing = computed(() => api.editingFolderId === props.folder.id);
const isInside = computed(
  () => api.dropTarget?.kind === 'inside' && api.dropTarget.folderId === props.folder.id,
);
const isBefore = computed(
  () => api.dropTarget?.kind === 'before' && api.dropTarget.folderId === props.folder.id,
);
const nested = computed(() => api.childFolders(props.folder.id, true));
const threads = computed(() => api.threadsOf(props.folder.id));
const empty = computed(() => nested.value.length === 0 && threads.value.length === 0);

const onDragStart = (event: DragEvent) => {
  api.startDrag(event, { kind: 'folder', id: props.folder.id });
};
const onDragOver = (event: DragEvent) => {
  api.onFolderDragOver(event, props.folder.id);
};
const onDrop = (event: DragEvent) => {
  api.onFolderDrop(event, props.folder.id);
};
const onBodyDragOver = (event: DragEvent) => {
  api.onFolderBodyDragOver(event, props.folder.id);
};
const onBodyDrop = (event: DragEvent) => {
  api.onFolderBodyDrop(event, props.folder.id);
};
const onRowClick = () => {
  if (!editing.value) api.toggleExpanded(props.folder.id);
};
const onChevronClick = () => {
  api.toggleExpanded(props.folder.id);
};
const onMenuClick = (event: MouseEvent) => {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  api.openMenu('folder', props.folder.id, target);
};
const onDraftInput = (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  api.setDraftName(target.value);
};
const onDraftKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') api.commitRename();
  if (event.key === 'Escape') api.cancelRename();
};
</script>

<template>
  <div>
    <div
      :draggable="!editing"
      class="group flex items-center gap-1 pr-1 rounded text-sm cursor-pointer"
      :class="[
        editing ? 'min-h-7 py-0.5' : 'h-7',
        isInside ? 'bg-[#0e639c]/15 ring-1 ring-[#0e639c]' : 'hover:bg-void-bg-2-hover',
      ]"
      :style="{
        paddingLeft: `${4 + depth * 14}px`,
        boxShadow: isBefore ? 'inset 0 2px 0 #0e639c' : undefined,
      }"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @drop="onDrop"
      @click="onRowClick"
    >
      <button
        type="button"
        class="size-4 shrink-0 flex items-center justify-center text-void-fg-3"
        :title="open ? 'Свернуть' : 'Развернуть'"
        @click.stop="onChevronClick"
      >
        <ChevronDown v-if="open" class="size-3.5" />
        <ChevronRight v-else class="size-3.5" />
      </button>
      <Folder class="size-3.5 shrink-0 text-void-fg-3" />
      <input
        v-if="editing"
        autofocus
        :value="api.draftName"
        class="flex-1 min-w-0 bg-void-bg-1 border border-void-border-2 rounded px-1 py-0.5 text-sm text-void-fg-1 focus:outline-none"
        @click.stop
        @input="onDraftInput"
        @keydown="onDraftKeyDown"
        @blur="api.commitRename"
      />
      <span v-else class="truncate flex-1 min-w-0 text-void-fg-1">{{ folder.name }}</span>
      <button
        type="button"
        class="shrink-0 size-5 p-0 border-0 flex items-center justify-center rounded hover:bg-void-bg-2-alt opacity-0 group-hover:opacity-100"
        title="Действия"
        @click.stop="onMenuClick"
      >
        <MoreHorizontal class="size-3.5" />
      </button>
    </div>
    <div v-if="open" @dragover="onBodyDragOver" @drop="onBodyDrop">
      <AgentsFolderNode
        v-for="child in nested"
        :key="child.id"
        :folder="child"
        :depth="depth + 1"
      />
      <AgentsThreadRow v-for="thread in threads" :key="thread.id" :thread="thread" :depth="depth + 1" />
      <div
        v-if="empty"
        class="text-xs text-void-fg-3 py-1 min-h-[28px] opacity-70"
        :style="{ paddingLeft: `${22 + depth * 14}px` }"
      >
        Пусто
      </div>
    </div>
  </div>
</template>
