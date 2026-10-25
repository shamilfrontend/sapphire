<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Sapphire — текстовый файл рядом с чатом или настройками в режиме агента.
 *--------------------------------------------------------------------------------------*/

import { computed, nextTick, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { URI } from '../../../../../../../base/common/uri.js';
import { getBasename } from '../../../../common/pathLabels.js';
import { useAccessor } from '../util/services.js';

const props = defineProps<{
  fsPath: string;
  range?: [number, number] | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const accessor = useAccessor();
const sapphireModelService = accessor.get('ISapphireModelService');
const uri = computed(() => URI.file(props.fsPath));
const textAreaRef = ref<HTMLTextAreaElement | null>(null);
// Блокирует echo onDidChangeContent при записи из textarea в модель.
let writing = false;
const status = ref<'loading' | 'missing' | 'ready'>('loading');
const raw = ref('');

const lineOffset = (text: string, line: number): number => {
  if (line <= 1) return 0;
  let current = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      current++;
      if (current === line) return i + 1;
    }
  }
  return text.length;
};

const revealRange = async () => {
  await nextTick();
  const textarea = textAreaRef.value;
  if (!textarea) return;
  textarea.focus();
  const range = props.range;
  if (!range) return;
  const startLine = Math.max(1, range[0]);
  const endLine = Math.max(startLine, range[1]);
  const start = lineOffset(raw.value, startLine);
  const end = lineOffset(raw.value, endLine + 1);
  textarea.setSelectionRange(start, end);
  const style = getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || 21;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  textarea.scrollTop = Math.max(0, paddingTop + (startLine - 1) * lineHeight - lineHeight);
};

watch(
  uri,
  (nextUri, _previous, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    status.value = 'loading';
    void sapphireModelService.getModelSafe(nextUri).then((result) => {
      if (cancelled) return;
      const model = result.model;
      if (!model) {
        status.value = 'missing';
        raw.value = '';
        return;
      }
      raw.value = model.getValue();
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
      raw.value = model.getValue();
    });
    onCleanup(() => subscription.dispose());
  },
);

watch(
  () => [status.value, props.fsPath, props.range?.[0], props.range?.[1]] as const,
  ([nextStatus]) => {
    if (nextStatus !== 'ready') return;
    void revealRange();
  },
);

const onInput = (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  const value = target.value;
  raw.value = value;
  const model = sapphireModelService.getModel(uri.value).model;
  if (!model || model.getValue() === value) return;
  writing = true;
  model.setValue(value);
  writing = false;
};

const onKeyDown = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    event.stopPropagation();
    void sapphireModelService.saveModel(uri.value);
  }
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
      <textarea
        v-if="status === 'ready'"
        ref="textAreaRef"
        :value="raw"
        spellcheck="false"
        :aria-label="label"
        class="w-full h-full resize-none bg-void-bg-1 text-void-fg-1 font-mono text-[13px] leading-relaxed p-4 focus:outline-none"
        @input="onInput"
        @keydown="onKeyDown"
      />
      <div v-else class="p-4 text-sm text-void-fg-3">
        {{ status === 'missing' ? 'Файл недоступен' : 'Загрузка…' }}
      </div>
    </div>
  </aside>
</template>
