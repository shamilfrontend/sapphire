<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  PPR Code — pending file diffs beside the chat in Режим Агент.
 *--------------------------------------------------------------------------------------*/

import { computed, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { URI } from '../../../../../../../base/common/uri.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.vue';
import type { DiffZone } from '../../../../common/editCodeServiceTypes.js';
import { getBasename } from '../../../../common/pathLabels.js';
import { useAccessor, useCommandBarState } from '../util/services.js';
import { originalFromDiffZones } from './agentsReview.js';
import FileDiff from './FileDiff.vue';

/** EndOfLinePreference.LF — const enum не экспортируется в рантайме. */
const EOL_LF = 1;

const props = defineProps<{
  selectedFsPath: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const accessor = useAccessor();
const editCodeService = accessor.get('IEditCodeService');
const commandBarService = accessor.get('ISapphireCommandBarService');
const modelService = accessor.get('IModelService');
const sapphireModelService = accessor.get('ISapphireModelService');
const commandBarState = useCommandBarState();
const revision = ref(0);
const modelLoad = ref<{
  path: string;
  status: 'loading' | 'missing';
} | null>(null);

const sortedURIs = computed(() => commandBarState.value.sortedURIs);
const stateOfURI = computed(() => commandBarState.value.stateOfURI);

// Сначала выбор из чата; иначе первый URI с ожидающими правками, пока панель открыта.
const selectedUri = computed(
  () => sortedURIs.value.find((uri) => uri.fsPath === props.selectedFsPath) ?? sortedURIs.value[0],
);
const anyStreaming = computed(() =>
  sortedURIs.value.some((uri) => stateOfURI.value[uri.fsPath]?.isStreaming),
);
const selectedStreaming = computed(
  () => !!selectedUri.value && !!stateOfURI.value[selectedUri.value.fsPath]?.isStreaming,
);

const resolveModel = (uri: URI) => modelService.getModel(uri) ?? sapphireModelService.getModel(uri).model;

const modelStatus = computed(() => {
  const uri = selectedUri.value;
  if (!uri) return 'ready';
  if (resolveModel(uri)) return 'ready';
  if (modelLoad.value?.path === uri.fsPath) return modelLoad.value.status;
  return 'loading';
});

watch(
  () => selectedUri.value?.fsPath,
  (_fsPath, _previous, onCleanup) => {
    const uri = selectedUri.value;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    // resolveModel замыкает оба сервиса моделей из deps — отдельно не указываем
    if (!uri || resolveModel(uri)) return;
    const path = uri.fsPath;
    modelLoad.value = { path, status: 'loading' };
    void sapphireModelService.getModelSafe(uri).then((result) => {
      if (cancelled) return;
      if (result.model) {
        modelLoad.value = null;
        revision.value += 1;
      } else {
        modelLoad.value = { path, status: 'missing' };
      }
    });
  },
  { immediate: true },
);

watch(
  () => [modelLoad.value, selectedUri.value] as const,
  ([, uri], _previous, onCleanup) => {
    if (!uri) return;
    const model = resolveModel(uri);
    if (!model) return;
    const subscription = model.onDidChangeContent(() => {
      revision.value += 1;
    });
    onCleanup(() => subscription.dispose());
  },
  { immediate: true },
);

const pair = computed(() => {
  // revision — правки в модели без смены набора DiffZone
  const _revision = revision.value;
  const _state = stateOfURI.value;
  void _revision;
  void _state;
  const uri = selectedUri.value;
  if (!uri) return null;
  const model = resolveModel(uri);
  if (!model) return null;
  const zones: DiffZone[] = [];
  for (const id of editCodeService.diffAreasOfURI[uri.fsPath] ?? []) {
    const area = editCodeService.diffAreaOfId[id];
    if (area?.type === 'DiffZone') zones.push(area);
  }
  const modified = model.getValue(EOL_LF);
  return { original: originalFromDiffZones(modified, zones), modified };
});

const acceptOrRejectFile = (behavior: 'accept' | 'reject') => {
  const uri = selectedUri.value;
  if (!uri || selectedStreaming.value) return;
  editCodeService.acceptOrRejectAllDiffAreas({
    uri,
    removeCtrlKs: true,
    behavior,
    _addToHistory: true,
  });
};

const selectedLabel = computed(() => (selectedUri.value ? getBasename(selectedUri.value.fsPath) : ''));
</script>

<template>
  <aside class="flex-1 min-w-[320px] h-full min-h-0 flex flex-col border-l border-void-border-2 bg-void-bg-3">
    <div class="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-void-border-2">
      <span class="text-sm text-void-fg-1 truncate flex-1 min-w-0" :title="selectedUri?.fsPath">
        {{ selectedLabel }}
      </span>
      <span v-if="selectedStreaming" class="text-xs text-void-fg-3 shrink-0">пишет…</span>
      <template v-if="!selectedStreaming && selectedUri">
        <button
          type="button"
          class="px-2 py-0.5 text-xs rounded border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 shrink-0"
          @click="acceptOrRejectFile('reject')"
        >
          Отменить
        </button>
        <button
          type="button"
          class="px-2 py-0.5 text-xs rounded bg-[#00b0cc] text-white hover:bg-[#0097b2] shrink-0"
          @click="acceptOrRejectFile('accept')"
        >
          Оставить
        </button>
      </template>
      <template v-if="!anyStreaming">
        <button
          type="button"
          class="px-2 py-0.5 text-xs text-void-fg-3 hover:text-void-fg-1 shrink-0"
          @click="commandBarService.acceptOrRejectAllFiles({ behavior: 'reject' })"
        >
          Отменить все
        </button>
        <button
          type="button"
          class="px-2 py-0.5 text-xs text-void-fg-3 hover:text-void-fg-1 shrink-0"
          @click="commandBarService.acceptOrRejectAllFiles({ behavior: 'accept' })"
        >
          Оставить все
        </button>
      </template>
      <button
        type="button"
        title="Свернуть"
        aria-label="Свернуть"
        class="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2"
        @click="emit('close')"
      >
        <X class="w-4 h-4" />
      </button>
    </div>
    <div class="flex-1 min-h-0 min-w-0">
      <ErrorBoundary v-if="selectedUri && pair">
        <FileDiff :key="selectedUri.fsPath" :uri="selectedUri" :original="pair.original" :modified="pair.modified" />
      </ErrorBoundary>
      <div v-else class="p-4 text-sm text-void-fg-3">
        {{ modelStatus === 'missing' ? 'Файл недоступен' : 'Загрузка…' }}
      </div>
    </div>
  </aside>
</template>
