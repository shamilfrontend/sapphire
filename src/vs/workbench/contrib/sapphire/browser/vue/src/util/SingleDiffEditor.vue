<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onUnmounted, ref, shallowRef, watch } from 'vue';
import { useAccessor } from './services.js';
import { DiffEditorWidget } from '../../../../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { createDiffEditorInstantiationService } from './diffEditorServices.js';
import { ExtractedSearchReplaceBlock } from '../../../../common/helpers/extractCodeFromResult.js';
import { ITextModel } from '../../../../../../../editor/common/model.js';

const props = defineProps<{
  block: ExtractedSearchReplaceBlock;
  lang: string | undefined;
}>();

const accessor = useAccessor();
const modelService = accessor.get('IModelService');
const instantiationService = accessor.get('IInstantiationService');
const languageService = accessor.get('ILanguageService');

const divRef = ref<HTMLDivElement | null>(null);
const editorRef = shallowRef<DiffEditorWidget | null>(null);
const originalModel = shallowRef<ITextModel | null>(null);
const modifiedModel = shallowRef<ITextModel | null>(null);

// Модели «до» и «после» для одного блока search/replace
watch(
  () => [props.block.orig, props.block.final, props.lang] as const,
  () => {
    const languageSelection = languageService.createById(props.lang);
    const nextOriginal = modelService.createModel(props.block.orig, languageSelection);
    const nextModified = modelService.createModel(props.block.final, languageSelection);
    const prevOriginal = originalModel.value;
    const prevModified = modifiedModel.value;
    originalModel.value = nextOriginal;
    modifiedModel.value = nextModified;
    prevOriginal?.dispose();
    prevModified?.dispose();
  },
  { immediate: true },
);

let disposeEditor: (() => void) | undefined;

// DiffEditorWidget монтируем императивно (не через обёртку VS Code)
watch(
  [originalModel, modifiedModel],
  () => {
    disposeEditor?.();
    disposeEditor = undefined;
    const host = divRef.value;
    const original = originalModel.value;
    const modified = modifiedModel.value;
    if (!host || !original || !modified) return;

    const scopedInstantiationService = createDiffEditorInstantiationService(instantiationService);
    const editor = scopedInstantiationService.createInstance(
      DiffEditorWidget,
      host,
      {
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        lineNumbers: 'off',
        scrollbar: {
          vertical: 'hidden',
          horizontal: 'auto',
          verticalScrollbarSize: 0,
          horizontalScrollbarSize: 8,
          alwaysConsumeMouseWheel: false,
          ignoreHorizontalScrollbarInContentHeight: true,
        },
        hover: { enabled: false },
        folding: false,
        selectionHighlight: false,
        renderLineHighlight: 'none',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        glyphMargin: false,
        stickyScroll: { enabled: false },
        scrollBeyondLastLine: false,
        renderGutterMenu: false,
        renderIndicators: false,
      },
      { originalEditor: { isSimpleWidget: true }, modifiedEditor: { isSimpleWidget: true } },
    );
    editor.setModel({ original, modified });

    // Высота контейнера по числу строк diff
    const updateHeight = () => {
      const contentHeight =
        Math.max(
          original.getLineCount() * 19, // примерная высота строки
          modified.getLineCount() * 19,
        ) +
        19 * 2 +
        1; // отступы сверху/снизу

      // Ограничиваем min/max, чтобы diff не ломал layout чата
      const height = Math.min(Math.max(contentHeight, 100), 300);
      if (divRef.value) {
        divRef.value.style.height = `${height}px`;
        editor.layout();
      }
    };

    updateHeight();
    editorRef.value = editor;

    // Пересчёт высоты при правках модели
    const disposable1 = original.onDidChangeContent(() => updateHeight());
    const disposable2 = modified.onDidChangeContent(() => updateHeight());

    disposeEditor = () => {
      disposable1.dispose();
      disposable2.dispose();
      editor.dispose();
      scopedInstantiationService.dispose();
      editorRef.value = null;
    };
  },
  { flush: 'post', immediate: true },
);

onUnmounted(() => {
  disposeEditor?.();
  disposeEditor = undefined;
  originalModel.value?.dispose();
  modifiedModel.value?.dispose();
  originalModel.value = null;
  modifiedModel.value = null;
});
</script>

<template>
  <div ref="divRef" class="w-full bg-void-bg-3 @@bg-editor-style-override" />
</template>
