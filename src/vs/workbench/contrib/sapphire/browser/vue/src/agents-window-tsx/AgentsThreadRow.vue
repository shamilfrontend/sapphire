<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Sapphire — folder tree of chats in the Режим Агент sidebar.
 *--------------------------------------------------------------------------------------*/

import { computed, inject } from 'vue';
import { LoaderCircle, MessageCircleQuestion, MoreHorizontal } from 'lucide-vue-next';
import { ThreadType } from '../../../chatThreadService.js';
import { threadActivity, threadTitle } from '../util/threadDisplay.js';
import { agentsTreeKey } from './threadTree.js';

const props = defineProps<{
  thread: ThreadType;
  depth: number;
}>();

const api = inject(agentsTreeKey);
if (!api) {
  throw new Error('AgentsThreadRow must be used inside AgentsThreadTree');
}

const isCurrent = computed(() => props.thread.id === api.currentThreadId);
const activity = computed(() => threadActivity(api.streamState[props.thread.id]));
const title = computed(() => threadTitle(props.thread));

const onDragStart = (event: DragEvent) => {
  api.startDrag(event, { kind: 'thread', id: props.thread.id });
};
const onDragOver = (event: DragEvent) => {
  api.onThreadDragOver(event, props.thread);
};
const onDrop = (event: DragEvent) => {
  api.onThreadDrop(event, props.thread);
};
const onClick = () => {
  api.onThreadClick(props.thread.id);
};
const onMenuClick = (event: MouseEvent) => {
  event.stopPropagation();
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  api.openMenu('thread', props.thread.id, target);
};
</script>

<template>
  <div
    draggable="true"
    class="group flex items-center gap-1 h-7 pr-1 rounded text-sm cursor-pointer"
    :class="
      isCurrent
        ? 'bg-[#0e639c]/20 text-void-fg-1 font-medium shadow-[inset_2px_0_0_0_#0e639c]'
        : 'hover:bg-void-bg-2-hover text-void-fg-3'
    "
    :style="{ paddingLeft: `${8 + depth * 14}px` }"
    :title="title"
    @dragstart="onDragStart"
    @dragover="onDragOver"
    @drop="onDrop"
    @click="onClick"
  >
    <LoaderCircle v-if="activity === 'running'" class="size-3.5 shrink-0 animate-spin" />
    <MessageCircleQuestion v-else-if="activity === 'awaiting'" class="size-3.5 shrink-0" />
    <span v-else class="size-3.5 shrink-0" />
    <span class="truncate flex-1 min-w-0">{{ title }}</span>
    <button
      type="button"
      class="shrink-0 size-5 p-0 border-0 flex items-center justify-center rounded hover:bg-void-bg-2-alt opacity-0 group-hover:opacity-100"
      title="Действия"
      @click="onMenuClick"
    >
      <MoreHorizontal class="size-3.5" />
    </button>
  </div>
</template>
