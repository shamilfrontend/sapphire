<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  PPR Code — pending file diffs beside the chat in Режим Агент.
 *--------------------------------------------------------------------------------------*/

import { ref, watch } from 'vue';
import { URI } from '../../../../../../../base/common/uri.js';
import { DiffEditorWidget } from '../../../../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { createDiffEditorInstantiationService } from '../util/diffEditorServices.js';
import { useAccessor } from '../util/services.js';

const props = defineProps<{
  uri: URI;
  original: string;
  modified: string;
}>();

const accessor = useAccessor();
const modelService = accessor.get('IModelService');
const instantiationService = accessor.get('IInstantiationService');
const languageService = accessor.get('ILanguageService');
const hostRef = ref<HTMLDivElement | null>(null);
const modelsRef = ref<{
  setOriginal: (value: string) => void;
  setModified: (value: string) => void;
} | null>(null);

// Пересоздаём виджет только при смене файла; текст обновляем через setValue.
watch(
  hostRef,
  (host, _previous, onCleanup) => {
    if (!host) return;

    const languageId = languageService.guessLanguageIdByFilepathOrFirstLine(props.uri) ?? 'plaintext';
    const languageSelection = languageService.createById(languageId);
    const originalModel = modelService.createModel(props.original, languageSelection);
    const modifiedModel = modelService.createModel(props.modified, languageSelection);
    const scopedInstantiationService = createDiffEditorInstantiationService(instantiationService);
    const editor = scopedInstantiationService.createInstance(
      DiffEditorWidget,
      host,
      {
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: false,
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollbar: {
          vertical: 'auto',
          horizontal: 'auto',
          alwaysConsumeMouseWheel: false,
        },
        hover: { enabled: false },
        folding: false,
        stickyScroll: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        glyphMargin: false,
      },
      { originalEditor: { isSimpleWidget: true }, modifiedEditor: { isSimpleWidget: true } },
    );
    editor.setModel({ original: originalModel, modified: modifiedModel });
    modelsRef.value = {
      setOriginal: (value) => {
        if (originalModel.getValue() !== value) originalModel.setValue(value);
      },
      setModified: (value) => {
        if (modifiedModel.getValue() !== value) modifiedModel.setValue(value);
      },
    };
    const observer = new ResizeObserver(() => editor.layout());
    observer.observe(host);

    onCleanup(() => {
      observer.disconnect();
      modelsRef.value = null;
      editor.dispose();
      scopedInstantiationService.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    });
  },
  { flush: 'post' },
);

watch(
  () => [props.original, props.modified] as const,
  ([original, modified]) => {
    modelsRef.value?.setOriginal(original);
    modelsRef.value?.setModified(modified);
  },
);
</script>

<template>
  <div ref="hostRef" class="h-full w-full bg-void-bg-3 @@bg-editor-style-override" />
</template>
