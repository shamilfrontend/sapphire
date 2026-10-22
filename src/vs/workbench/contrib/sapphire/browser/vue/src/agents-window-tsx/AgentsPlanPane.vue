<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Sapphire — plan preview beside the chat in Режим Агент.
 *--------------------------------------------------------------------------------------*/

import { computed, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { URI } from '../../../../../../../base/common/uri.js';
import { getBasename } from '../../../../common/pathLabels.js';
import {
  parsePlanMarkdown,
  type ParsedPlanMarkdown,
} from '../../../../common/prompt/planFileHelpers.js';
import PlanEditorChrome from '../plan-editor-tsx/PlanEditorChrome.vue';
import type { PlanEditorMode } from '../plan-editor-tsx/planEditor.js';
import { useAccessor } from '../util/services.js';

const props = defineProps<{
  fsPath: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const emptyPlan = (): ParsedPlanMarkdown => ({ name: '', overview: '', plan: '', todos: [] });

const accessor = useAccessor();
const sapphireModelService = accessor.get('ISapphireModelService');
const uri = computed(() => URI.file(props.fsPath));
// Блокирует echo onDidChangeContent при записи из textarea в модель редактора.
let writing = false;
const mode = ref<PlanEditorMode>('preview');
const status = ref<'loading' | 'missing' | 'ready'>('loading');
const raw = ref('');
const parsed = ref<ParsedPlanMarkdown>(emptyPlan());

watch(
  uri,
  (nextUri, _previous, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    mode.value = 'preview';
    status.value = 'loading';
    void sapphireModelService.getModelSafe(nextUri).then((result) => {
      if (cancelled) return;
      const model = result.model;
      if (!model) {
        status.value = 'missing';
        raw.value = '';
        parsed.value = emptyPlan();
        return;
      }
      const value = model.getValue();
      raw.value = value;
      parsed.value = parsePlanMarkdown(value);
      status.value = 'ready';
    });
  },
  { immediate: true },
);

watch(
  () => [status.value, uri.value] as const,
  ([nextStatus, nextUri], _previous, onCleanup) => {
    if (nextStatus !== 'ready') return;
    const model = sapphireModelService.getModel(nextUri).model;
    if (!model) return;
    const subscription = model.onDidChangeContent(() => {
      if (writing) return;
      const value = model.getValue();
      raw.value = value;
      parsed.value = parsePlanMarkdown(value);
    });
    onCleanup(() => subscription.dispose());
  },
);

const onMarkdownChange = (value: string) => {
  raw.value = value;
  parsed.value = parsePlanMarkdown(value);
  const model = sapphireModelService.getModel(uri.value).model;
  if (!model || model.getValue() === value) return;
  writing = true;
  model.setValue(value);
  writing = false;
};

const onMarkdownKeyDown = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    event.stopPropagation();
    void sapphireModelService.saveModel(uri.value);
  }
};

const setMode = (next: PlanEditorMode) => {
  mode.value = next;
};

const label = computed(() => getBasename(props.fsPath));
</script>

<template>
  <aside class="flex-1 min-w-[320px] h-full min-h-0 flex flex-col border-l border-void-border-2 bg-void-bg-3">
    <div class="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-void-border-2">
      <span class="text-sm text-void-fg-1 truncate flex-1 min-w-0" :title="fsPath">{{ label }}</span>
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
    <div class="flex-1 min-h-0">
      <PlanEditorChrome
        v-if="status === 'ready'"
        :mode="mode"
        :name="parsed.name"
        :overview="parsed.overview"
        :plan="parsed.plan"
        :todos="parsed.todos"
        :planUriFsPath="fsPath"
        :onModeChange="setMode"
        :markdownValue="raw"
        :onMarkdownInput="onMarkdownChange"
        :onMarkdownKeydown="onMarkdownKeyDown"
      />
      <div v-else class="p-4 text-sm text-void-fg-3">
        {{ status === 'missing' ? 'Файл недоступен' : 'Загрузка…' }}
      </div>
    </div>
  </aside>
</template>
