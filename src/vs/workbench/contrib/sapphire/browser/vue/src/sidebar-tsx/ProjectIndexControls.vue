<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onMounted, onUnmounted, onWatcherCleanup, ref, watch, type CSSProperties } from 'vue';
import { autoUpdate, flip, offset, shift, useFloating, type Placement } from '@floating-ui/vue';
import { Pause, Play, RefreshCw } from 'lucide-vue-next';
import { useAccessor, useProjectIndexStatus } from '../util/services.js';
import { PPR_REINDEX_WORKSPACE_COMMAND_ID } from '../../../projectIndexService.js';
import type { ProjectIndexStatus } from '../../../../common/projectIndex/projectIndexTypes.js';

const props = withDefaults(
  defineProps<{
    showStatusButton?: boolean;
    className?: string;
    popoverPlacement?: Placement;
  }>(),
  {
    showStatusButton: true,
    className: '',
    popoverPlacement: 'top-end',
  },
);

const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** Самая длинная подпись статуса — ширина кнопки под неё, чтобы titlebar не дёргался. */
const STATUS_LABEL_INDEXED = 'Проект проиндексирован';
const STATUS_LABEL_NOT_INDEXED = 'Проект не проиндексирован';

function isIndexingPhase(phase: ProjectIndexStatus['phase']): boolean {
  return phase === 'scanning' || phase === 'analyzing' || phase === 'purpose';
}

function phaseLabel(phase: ProjectIndexStatus['phase']): string {
  switch (phase) {
    case 'scanning':
      return 'Сканирование';
    case 'analyzing':
      return 'Анализ файлов';
    case 'purpose':
      return 'Purpose (LLM)';
    default:
      return '';
  }
}

function labelForStatus(status: ProjectIndexStatus): string {
  if (isIndexingPhase(status.phase)) {
    const pct = Math.max(0, Math.min(100, status.percent));
    return 'Индексация ' + pct + '%';
  }
  if (status.isPaused) {
    const pct = Math.max(0, Math.min(100, status.percent));
    return 'Пауза ' + pct + '%';
  }
  if (status.isIndexed) {
    return STATUS_LABEL_INDEXED;
  }
  return STATUS_LABEL_NOT_INDEXED;
}

const progressTrackStyle: CSSProperties = {
  backgroundColor: 'var(--vscode-editorWidget-border, rgba(127,127,127,0.35))',
};

const progressFillStyle = (percent: number): CSSProperties => ({
  width: `${percent}%`,
  backgroundColor: 'var(--vscode-progressBar-background, var(--vscode-focusBorder, #0078d4))',
});

function formatTime(ts: number | null | undefined): string {
  if (!ts) {
    return '—';
  }
  try {
    return new Date(ts).toLocaleString();
  } catch (_err) {
    return '—';
  }
}

const accessor = useAccessor();
const commandService = accessor.get('ICommandService');
const projectIndexService = accessor.get('IProjectIndexService');
const workspaceService = accessor.get('IWorkspaceContextService');
const status = useProjectIndexStatus();
const open = ref(false);
const hasWorkspace = ref(workspaceService.getWorkspace().folders.length > 0);

const reference = ref<HTMLElement | null>(null);
const floating = ref<HTMLElement | null>(null);
const { x, y, strategy, update } = useFloating(reference, floating, {
  open: () => open.value,
  placement: () => props.popoverPlacement,
  middleware: [offset(8), flip(), shift({ padding: 8 })],
  // не пересчитывать anchor при каждом тике индексации
  // иначе popover «прыгает» при смене currentPath
  whileElementsMounted: (referenceEl, floatingEl, onUpdate) =>
    autoUpdate(referenceEl, floatingEl, onUpdate, { elementResize: false }),
  strategy: 'fixed',
});

const syncWorkspace = () => {
  hasWorkspace.value = workspaceService.getWorkspace().folders.length > 0;
};

let workspaceDisposable: { dispose: () => void } | undefined;
onMounted(() => {
  syncWorkspace();
  workspaceDisposable = workspaceService.onDidChangeWorkspaceFolders(syncWorkspace);
});
onUnmounted(() => {
  workspaceDisposable?.dispose();
});

// обновление позиции только при открытии popover
watch(open, (isOpen) => {
  if (isOpen) {
    void update();
  }
});

watch(
  open,
  (isOpen) => {
    if (!isOpen) {
      return;
    }
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const floatingEl = floating.value;
      const referenceEl = reference.value;
      const isReferenceHTMLElement = referenceEl && 'contains' in referenceEl;
      if (
        floatingEl &&
        (!isReferenceHTMLElement || !referenceEl.contains(target)) &&
        !floatingEl.contains(target)
      ) {
        open.value = false;
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    onWatcherCleanup(() => document.removeEventListener('mousedown', onDocMouseDown));
  },
  { immediate: true },
);

const counts = computed(() => status.value.manifest?.counts);
const showIndexNow = computed(
  () => !status.value.isIndexed && status.value.phase === 'idle' && !status.value.isPaused,
);
const indexing = computed(() => isIndexingPhase(status.value.phase));
const paused = computed(() => !!status.value.isPaused && !indexing.value);
const overallPercent = computed(() => Math.max(0, Math.min(100, status.value.percent)));
// play/pause: идёт индекс, пауза или остался purpose
const showPlayPause = computed(
  () =>
    indexing.value ||
    paused.value ||
    (!!counts.value?.purposePending && counts.value.purposePending > 0),
);
const showReindex = computed(() => status.value.isIndexed && !indexing.value);
const iconBtnClass =
  'inline-flex items-center justify-center rounded border border-void-border-1 bg-void-bg-1 text-void-fg-1 hover:brightness-110 shrink-0';
const iconBtnStyle = { width: 22, height: 22, ...noDrag } as CSSProperties;

const statusTitle = computed(() =>
  indexing.value
    ? `Общий прогресс индексации: ${overallPercent.value}% · ${phaseLabel(status.value.phase)}`
    : labelForStatus(status.value),
);

const kindEntries = computed(() => {
  const byKind = counts.value?.byKind;
  if (!byKind || Object.keys(byKind).length === 0) return [];
  return Object.entries(byKind);
});

const errorPaths = computed(() =>
  status.value.errors
    .slice(0, 5)
    .map((e) => e.path)
    .join(', '),
);
</script>

<template>
  <div
    v-if="hasWorkspace && showStatusButton"
    :class="`relative flex items-center gap-1 shrink-0 ${className}`"
    :style="noDrag"
  >
    <button
      type="button"
      ref="reference"
      :style="noDrag"
      class="text-[11px] px-1.5 py-0.5 rounded hover:bg-void-bg-2 cursor-pointer w-[188px] shrink-0 text-left"
      :title="statusTitle"
      :aria-expanded="open"
      :aria-label="statusTitle"
      @click.stop="open = !open"
    >
      <div v-if="indexing || paused" class="flex flex-col gap-0.5 w-full min-w-0">
        <div class="flex items-center justify-between gap-1 w-full min-w-0">
          <span class="truncate text-void-fg-1">{{ paused ? 'Пауза' : 'Индексация' }}</span>
          <span class="shrink-0 tabular-nums font-semibold text-void-fg-1">
            {{ overallPercent }}%
          </span>
        </div>
        <div class="h-1 w-full rounded-full overflow-hidden" :style="progressTrackStyle">
          <div
            class="h-full rounded-full transition-[width] duration-150 ease-out"
            :style="progressFillStyle(overallPercent)"
          />
        </div>
      </div>
      <span v-else class="block truncate text-void-fg-3 hover:text-void-fg-1">
        {{ labelForStatus(status) }}
      </span>
    </button>

    <div
      v-if="open"
      ref="floating"
      :style="{ position: strategy, top: y ?? 0, left: x ?? 0 }"
      class="z-[10000] w-[340px] max-h-[420px] overflow-auto rounded-lg border border-void-border-2 bg-void-bg-1 shadow-lg p-3 text-left"
      @click.stop
    >
      <div class="text-sm font-medium text-void-fg-1 mb-2">Индекс проекта</div>
      <div class="mb-3 rounded-md border border-void-border-2 bg-void-bg-2 px-2.5 py-2">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="text-xs font-medium text-void-fg-1">Общий прогресс</span>
          <span class="text-sm tabular-nums font-semibold text-void-fg-1">
            {{ indexing || status.isIndexed || paused ? `${overallPercent}%` : '—' }}
          </span>
        </div>
        <div class="h-2 w-full rounded-full overflow-hidden mb-1.5" :style="progressTrackStyle">
          <div
            class="h-full rounded-full transition-[width] duration-150 ease-out"
            :style="progressFillStyle(indexing || status.isIndexed || paused ? overallPercent : 0)"
          />
        </div>
        <div class="flex items-center gap-1.5 min-w-0">
          <div class="text-[11px] text-void-fg-2 truncate min-w-0 flex-1">
            <template v-if="indexing">
              {{
                `${phaseLabel(status.phase)}${
                  status.total > 0 ? ` · ${status.processed}/${status.total}` : ''
                }`
              }}
            </template>
            <template v-else-if="paused">На паузе</template>
            <template v-else-if="status.isIndexed">Готов</template>
            <template v-else>Не проиндексирован</template>
          </div>
          <button
            v-if="showPlayPause"
            type="button"
            :class="iconBtnClass"
            :style="iconBtnStyle"
            :title="indexing ? 'Пауза' : 'Продолжить'"
            :aria-label="indexing ? 'Пауза' : 'Продолжить'"
            @click.stop="
              indexing ? projectIndexService.pause() : void projectIndexService.resume()
            "
          >
            <Pause
              v-if="indexing"
              :size="12"
              :stroke-width="2.5"
              :style="{ width: 12, height: 12 }"
            />
            <Play v-else :size="12" :stroke-width="2.5" :style="{ width: 12, height: 12 }" />
          </button>
          <button
            v-if="showReindex"
            type="button"
            :class="iconBtnClass"
            :style="iconBtnStyle"
            title="Переиндексировать заново"
            aria-label="Переиндексировать заново"
            @click.stop="void commandService.executeCommand(PPR_REINDEX_WORKSPACE_COMMAND_ID)"
          >
            <RefreshCw :size="12" :stroke-width="2.5" :style="{ width: 12, height: 12 }" />
          </button>
        </div>
        <div
          v-if="(indexing || paused) && status.currentPath"
          class="truncate text-[11px] text-void-fg-3 mt-0.5"
          :title="status.currentPath"
        >
          {{ status.currentPath }}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-void-fg-3 mb-3">
        <span>Файлов: {{ counts?.files ?? 0 }}</span>
        <span>Символов: {{ counts?.symbols ?? 0 }}</span>
        <span>Чанков: {{ counts?.chunks ?? 0 }}</span>
        <span>Рёбер: {{ counts?.edges ?? 0 }}</span>
        <span>Purpose: {{ counts?.purposeDone ?? 0 }}</span>
        <span>Pending: {{ counts?.purposePending ?? 0 }}</span>
        <span class="col-span-2">Полная: {{ formatTime(status.manifest?.lastFullAt) }}</span>
        <span class="col-span-2">
          Инкремент: {{ formatTime(status.manifest?.lastIncrementalAt) }}
        </span>
      </div>

      <div v-if="kindEntries.length > 0" class="mb-3 text-[11px] text-void-fg-3">
        <span v-for="[k, v] in kindEntries" :key="k" class="mr-2">{{ k }}: {{ v }}</span>
      </div>

      <div v-if="status.errors.length > 0" class="mb-3 text-[11px] text-red-400">
        Ошибки: {{ errorPaths }}
      </div>

      <div v-if="showIndexNow || paused" class="flex flex-col gap-1.5">
        <button
          v-if="showIndexNow"
          type="button"
          class="text-xs bg-void-bg-2 text-void-fg-1 rounded px-2 py-1.5 text-left font-medium"
          @click="void projectIndexService.reindexFull()"
        >
          Проиндексировать сейчас
        </button>

        <button
          v-if="paused"
          type="button"
          class="text-xs bg-void-bg-2 text-void-fg-1 rounded px-2 py-1.5 text-left font-medium"
          @click="void projectIndexService.resume()"
        >
          Продолжить индексацию
        </button>
      </div>
    </div>
  </div>
</template>
