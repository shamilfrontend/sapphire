<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ref, useId, watch } from 'vue';
import { CodeEditorWidget } from '../../../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { ITextModel } from '../../../../../../../editor/common/model.js';
import { useAccessor } from './services.js';
import WidgetComponent from './WidgetComponent.vue';

// Убирает общий минимальный отступ — блок кода в сайдбаре не «уезжает» вправо
const normalizeIndentation = (code: string): string => {
  const lines = code.split('\n');

  let minLeadingSpaces = Infinity;

  // Минимальный общий отступ среди непустых строк
  for (const line of lines) {
    if (line.trim() === '') continue;
    let leadingSpaces = 0;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '\t' || char === ' ') {
        leadingSpaces += 1;
      } else {
        break;
      }
    }
    minLeadingSpaces = Math.min(minLeadingSpaces, leadingSpaces);
  }

  // Срезаем этот отступ у всех строк
  return lines
    .map((line) => {
      if (line.trim() === '') return line;

      let spacesToRemove = minLeadingSpaces;
      let i = 0;
      while (spacesToRemove > 0 && i < line.length) {
        const char = line[i];
        if (char === '\t' || char === ' ') {
          spacesToRemove -= 1;
          i++;
        } else {
          break;
        }
      }

      return line.slice(i);
    })
    .join('\n');
};

const modelOfEditorId: { [id: string]: ITextModel | undefined } = {};

const props = defineProps<{
  initValue: string;
  language?: string;
  maxHeight?: number;
  showScrollbars?: boolean;
}>();

// Дефолты высоты и скроллбаров фиксируются при монтировании, как useCallback без этих deps
const MAX_HEIGHT = props.maxHeight ?? Infinity;
const SHOW_SCROLLBARS = props.showScrollbars ?? false;

const accessor = useAccessor();
const instantiationService = accessor.get('IInstantiationService');
const modelService = accessor.get('IModelService');

const id = useId();

const normalizedInit = () => normalizeIndentation(props.initValue);

// Актуальные value/language для onCreateInstance без remount редактора
const initValueRef = ref(normalizedInit());
const languageRef = ref(props.language);
const modelRef = ref<ITextModel | null>(null);

// При смене props обновляем модель, не пересоздавая CodeEditorWidget
watch(
  () => props.initValue,
  () => {
    const next = normalizedInit();
    initValueRef.value = next;
    modelRef.value?.setValue(next);
  },
);
watch(
  () => props.language,
  (language) => {
    languageRef.value = language;
    if (language) modelRef.value?.setLanguage(language);
  },
);

const ctor = (container: HTMLDivElement) =>
  instantiationService.createInstance(
    CodeEditorWidget,
    container,
    {
      automaticLayout: true,
      wordWrap: 'off',

      scrollbar: {
        alwaysConsumeMouseWheel: false,
        ...(SHOW_SCROLLBARS
          ? {
              vertical: 'auto',
              verticalScrollbarSize: 8,
              horizontal: 'auto',
              horizontalScrollbarSize: 8,
            }
          : {
              vertical: 'hidden',
              verticalScrollbarSize: 0,
              horizontal: 'auto',
              horizontalScrollbarSize: 8,
              ignoreHorizontalScrollbarInContentHeight: true,
            }),
      },
      scrollBeyondLastLine: false,

      lineNumbers: 'off',

      readOnly: true,
      domReadOnly: true,
      readOnlyMessage: { value: '' },

      minimap: {
        enabled: false,
      },

      hover: { enabled: false },

      selectionHighlight: false, // без подсветки «слова под курсором»
      renderLineHighlight: 'none',

      folding: false,
      lineDecorationsWidth: 0,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      glyphMargin: false,

      stickyScroll: {
        enabled: false,
      },
    },
    {
      isSimpleWidget: true,
    },
  );

const onCreateInstance = (editor: CodeEditorWidget) => {
  const languageId = languageRef.value ? languageRef.value : 'plaintext';

  const model =
    modelOfEditorId[id] ??
    modelService.createModel(initValueRef.value, {
      languageId,
      onDidChange: (_e) => ({ dispose: () => {} }), // ILanguageSelection требует колбэк onDidChange
    });
  modelRef.value = model;
  editor.setModel(model);

  const container = editor.getDomNode();
  const parentNode = container?.parentElement;
  const resize = () => {
    const height = editor.getScrollHeight() + 1;
    if (parentNode) {
      parentNode.style.height = `${height}px`;
      parentNode.style.maxHeight = `${MAX_HEIGHT}px`;
      editor.layout();
    }
  };

  resize();
  const disposable = editor.onDidContentSizeChange(() => {
    resize();
  });

  return [disposable, model];
};

const disposeEditor = (editor: CodeEditorWidget) => {
  editor.dispose();
};

const propsFn = (_container: HTMLDivElement): unknown[] => [];
</script>

<template>
  <div class="relative z-0 px-2 py-1 bg-void-bg-3">
    <WidgetComponent
      class="@@bg-editor-style-override"
      :ctor="ctor"
      :propsFn="propsFn"
      :onCreateInstance="onCreateInstance"
      :dispose="disposeEditor"
    />
  </div>
</template>
