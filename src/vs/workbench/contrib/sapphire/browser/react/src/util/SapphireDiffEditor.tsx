/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef } from 'react';
import { useAccessor } from './services.js';
import { DiffEditorWidget } from '../../../../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { createDiffEditorInstantiationService } from './diffEditorServices.js';
import {
  extractSearchReplaceBlocks,
  ExtractedSearchReplaceBlock,
} from '../../../../common/helpers/extractCodeFromResult.js';
import { detectLanguage } from '../../../../common/helpers/languageHelpers.js';

const SingleDiffEditor = ({
  block,
  lang,
}: {
  block: ExtractedSearchReplaceBlock;
  lang: string | undefined;
}) => {
  const accessor = useAccessor();
  const modelService = accessor.get('IModelService');
  const instantiationService = accessor.get('IInstantiationService');
  const languageService = accessor.get('ILanguageService');

  const languageSelection = useMemo(
    () => languageService.createById(lang),
    [lang, languageService],
  );

  // Модели «до» и «после» для одного блока search/replace
  const originalModel = useMemo(
    () => modelService.createModel(block.orig, languageSelection),
    [block.orig, languageSelection, modelService],
  );
  const modifiedModel = useMemo(
    () => modelService.createModel(block.final, languageSelection),
    [block.final, languageSelection, modelService],
  );

  // dispose моделей при размонтировании
  useEffect(
    () => () => {
      originalModel.dispose();
      modifiedModel.dispose();
    },
    [originalModel, modifiedModel],
  );

  // DiffEditorWidget монтируем императивно (не через React-обёртку VS Code)
  const divRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    if (!divRef.current) return;
    const scopedInstantiationService = createDiffEditorInstantiationService(instantiationService);
    const editor = scopedInstantiationService.createInstance(
      DiffEditorWidget,
      divRef.current,
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
    editor.setModel({ original: originalModel, modified: modifiedModel });

    // Высота контейнера по числу строк diff
    const updateHeight = () => {
      const contentHeight =
        Math.max(
          originalModel.getLineCount() * 19, // примерная высота строки
          modifiedModel.getLineCount() * 19,
        ) +
        19 * 2 +
        1; // отступы сверху/снизу

      // Ограничиваем min/max, чтобы diff не ломал layout чата
      const height = Math.min(Math.max(contentHeight, 100), 300);
      if (divRef.current) {
        divRef.current.style.height = `${height}px`;
        editor.layout();
      }
    };

    updateHeight();
    editorRef.current = editor;

    // Пересчёт высоты при правках модели
    const disposable1 = originalModel.onDidChangeContent(() => updateHeight());
    const disposable2 = modifiedModel.onDidChangeContent(() => updateHeight());

    return () => {
      disposable1.dispose();
      disposable2.dispose();
      editor.dispose();
      scopedInstantiationService.dispose();
      editorRef.current = null;
    };
  }, [originalModel, modifiedModel, instantiationService]);

  return <div className="w-full bg-void-bg-3 @@bg-editor-style-override" ref={divRef} />;
};

/**
 * Показывает diff по блокам search/replace из ответа LLM через DiffEditorWidget.
 * Props:
 *   - uri — для определения языка
 *   - searchReplaceBlocks — текст в формате search/replace
 *   - language — опционально, иначе detectLanguage или plaintext
 */
export const SapphireDiffEditor = ({
  uri,
  searchReplaceBlocks,
  language,
}: {
  uri?: any;
  searchReplaceBlocks: string;
  language?: string;
}) => {
  const accessor = useAccessor();
  const languageService = accessor.get('ILanguageService');

  // Парсим все блоки из строки инструмента
  const blocks = extractSearchReplaceBlocks(searchReplaceBlocks);

  // Язык по uri/содержимому, если не передан явно
  let lang = language;
  if (!lang && blocks.length > 0) {
    lang = detectLanguage(languageService, { uri: uri ?? null, fileContents: blocks[0].orig });
  }

  // Пустой ответ — заглушка без редактора
  if (blocks.length === 0) {
    return <div className="w-full p-4 text-void-fg-4 text-sm">No changes found</div>;
  }

  // Несколько блоков — колонка diff-редакторов
  return (
    <div className="w-full flex flex-col gap-2">
      {blocks.map((block, index) => (
        <div key={index} className="w-full">
          {blocks.length > 1 && (
            <div className="text-void-fg-4 text-xs mb-1 px-1">
              Change {index + 1} of {blocks.length}
            </div>
          )}
          <SingleDiffEditor block={block} lang={lang} />
        </div>
      ))}
    </div>
  );
};
