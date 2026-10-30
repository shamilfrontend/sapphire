<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { ChevronDown, ChevronRight, FolderGit2, Square, X } from 'lucide-vue-next';
import { useAccessor } from '../util/services.js';
import type { AgentArenaEntry } from '../../../agentArenaService.js';
import { gitWorktreeRemoveCommand } from '../../../../common/agentWorktree.js';
import { generateUuid } from '../../../../../../../base/common/uuid.js';

const props = defineProps<{
  threadId: string;
}>();

const accessor = useAccessor();
const arena = accessor.get('IAgentArenaService');
const chatThreads = accessor.get('IChatThreadService');
const terminal = accessor.get('ITerminalToolService');
const workspace = accessor.get('IWorkspaceContextService');
const entries = shallowRef<readonly AgentArenaEntry[]>(arena.list(props.threadId));
const expanded = ref(true);

let disposeListener: { dispose: () => void } | undefined;
const refresh = () => {
  entries.value = arena.list(props.threadId);
};

onMounted(() => {
  refresh();
  disposeListener = arena.onDidChange(() => refresh());
});
onUnmounted(() => disposeListener?.dispose());

const visible = computed(() => entries.value.length > 0);
const runningCount = computed(() => entries.value.filter((e) => e.status === 'running').length);

const statusLabel = (status: AgentArenaEntry['status']) => {
  switch (status) {
    case 'running':
      return 'работает';
    case 'done':
      return 'готово';
    case 'error':
      return 'ошибка';
    case 'interrupted':
      return 'остановлен';
  }
};

const stopChild = (id: string) => {
  void chatThreads.abortRunning(id, { skipFlush: true });
};

const dismissFinished = () => {
  arena.clearFinished(props.threadId);
};

const removeWorktree = async (entry: AgentArenaEntry) => {
  if (!entry.worktreePath) {
    return;
  }
  const root = workspace.getWorkspace().folders[0]?.uri.fsPath;
  if (!root) {
    return;
  }
  try {
    const { resPromise } = await terminal.runCommand(gitWorktreeRemoveCommand(entry.worktreePath), {
      type: 'temporary',
      cwd: root,
      terminalId: `wt-rm-${generateUuid().slice(0, 8)}`,
    });
    await resPromise;
    arena.patch(entry.id, { worktreePath: undefined });
  } catch (e) {
    console.warn('[sapphire] worktree remove failed', e);
  }
};
</script>

<template>
  <div
    v-if="visible"
    class="mb-2 rounded-xl border border-void-border-3 bg-void-bg-1 overflow-hidden"
  >
    <button
      type="button"
      class="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-void-fg-3 hover:text-void-fg-1 cursor-pointer"
      @click="expanded = !expanded"
    >
      <ChevronDown v-if="expanded" :size="14" />
      <ChevronRight v-else :size="14" />
      <span>
        Арена
        <template v-if="runningCount"> · {{ runningCount }} активн.</template>
        <template v-else> · {{ entries.length }}</template>
      </span>
      <button
        v-if="runningCount === 0"
        type="button"
        class="ml-auto text-void-fg-3 hover:text-void-fg-1"
        title="Скрыть завершённые"
        @click.stop="dismissFinished"
      >
        <X :size="14" />
      </button>
    </button>
    <div v-if="expanded" class="flex flex-col gap-1 px-2 pb-2">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="rounded-lg px-2 py-1.5 bg-void-bg-2/60"
      >
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm text-void-fg-1 truncate">{{ entry.description }}</div>
            <div class="text-[11px] text-void-fg-3 mt-0.5">
              {{ statusLabel(entry.status) }}
              <span v-if="entry.readOnly"> · read-only</span>
              <span v-if="entry.worktreePath"> · worktree</span>
            </div>
            <div
              v-if="entry.summary && entry.status !== 'running'"
              class="text-[11px] text-void-fg-3 mt-1 line-clamp-2 whitespace-pre-wrap"
            >
              {{ entry.summary }}
            </div>
            <div
              v-if="entry.worktreePath"
              class="text-[10px] text-void-fg-3 mt-1 font-mono truncate"
              :title="entry.worktreePath"
            >
              {{ entry.worktreePath }}
            </div>
          </div>
          <button
            v-if="entry.status === 'running'"
            type="button"
            class="shrink-0 p-1 rounded hover:bg-void-bg-3 text-void-fg-3 hover:text-void-fg-1"
            title="Остановить"
            @click="stopChild(entry.id)"
          >
            <Square :size="12" />
          </button>
          <button
            v-else-if="entry.worktreePath"
            type="button"
            class="shrink-0 p-1 rounded hover:bg-void-bg-3 text-void-fg-3 hover:text-void-fg-1"
            title="Удалить worktree"
            @click="removeWorktree(entry)"
          >
            <FolderGit2 :size="12" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
