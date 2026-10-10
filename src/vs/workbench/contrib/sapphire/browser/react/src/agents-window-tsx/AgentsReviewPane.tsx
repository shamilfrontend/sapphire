/*--------------------------------------------------------------------------------------
 *  PPR Code — pending file diffs beside the chat in Режим Агент.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { URI } from '../../../../../../../base/common/uri.js';
import { DiffEditorWidget } from '../../../../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { createDiffEditorInstantiationService } from '../util/diffEditorServices.js';
import type { DiffZone } from '../../../../common/editCodeServiceTypes.js';
import { getBasename } from '../../../../common/pathLabels.js';
import { useAccessor, useCommandBarState } from '../util/services.js';

/** EndOfLinePreference.LF — const enum не экспортируется в рантайме. */
const EOL_LF = 1;

export const reviewFilesLabel = (count: number) => {
  if (count === 1) return '1 файл';
  if (count > 1 && count < 5) return `${count} файла`;
  return `${count} файлов`;
};

/** Подставляет в modified снимок original по DiffZone снизу вверх, чтобы диапазоны строк оставались валидными. */
const originalFromDiffZones = (modified: string, zones: DiffZone[]): string => {
  if (zones.length === 0) return modified;
  const lines = modified.split('\n');
  const sorted = [...zones].sort((a, b) => b.startLine - a.startLine);
  for (const zone of sorted) {
    const start = Math.max(0, zone.startLine - 1);
    const deleteCount =
      zone.endLine >= zone.startLine
        ? Math.min(lines.length - start, zone.endLine - zone.startLine + 1)
        : 0;
    const replacement = zone.originalCode === '' ? [] : zone.originalCode.split('\n');
    lines.splice(start, Math.max(0, deleteCount), ...replacement);
  }
  return lines.join('\n');
};

const FileDiff = ({
  uri,
  original,
  modified,
}: {
  uri: URI;
  original: string;
  modified: string;
}) => {
  const accessor = useAccessor();
  const modelService = accessor.get('IModelService');
  const instantiationService = accessor.get('IInstantiationService');
  const languageService = accessor.get('ILanguageService');
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelsRef = useRef<{
    setOriginal: (value: string) => void;
    setModified: (value: string) => void;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const languageId = languageService.guessLanguageIdByFilepathOrFirstLine(uri) ?? 'plaintext';
    const languageSelection = languageService.createById(languageId);
    const originalModel = modelService.createModel(original, languageSelection);
    const modifiedModel = modelService.createModel(modified, languageSelection);
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
    modelsRef.current = {
      setOriginal: (value) => {
        if (originalModel.getValue() !== value) originalModel.setValue(value);
      },
      setModified: (value) => {
        if (modifiedModel.getValue() !== value) modifiedModel.setValue(value);
      },
    };
    const observer = new ResizeObserver(() => editor.layout());
    observer.observe(host);

    return () => {
      observer.disconnect();
      modelsRef.current = null;
      editor.dispose();
      scopedInstantiationService.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
    // Пересоздаём виджет только при смене файла; текст обновляем через setValue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri.fsPath, instantiationService, languageService, modelService]);

  useEffect(() => {
    modelsRef.current?.setOriginal(original);
    modelsRef.current?.setModified(modified);
  }, [original, modified]);

  return <div className="h-full w-full bg-void-bg-3 @@bg-editor-style-override" ref={hostRef} />;
};

export const AgentsReviewPane = ({
  selectedFsPath,
  onClose,
}: {
  selectedFsPath: string | null;
  onClose: () => void;
}) => {
  const accessor = useAccessor();
  const editCodeService = accessor.get('IEditCodeService');
  const commandBarService = accessor.get('ISapphireCommandBarService');
  const modelService = accessor.get('IModelService');
  const sapphireModelService = accessor.get('ISapphireModelService');
  const { stateOfURI, sortedURIs } = useCommandBarState();
  const [revision, setRevision] = useState(0);
  const [modelLoad, setModelLoad] = useState<{
    path: string;
    status: 'loading' | 'missing';
  } | null>(null);

  // Сначала выбор из чата; иначе первый URI с ожидающими правками, пока панель открыта.
  const selectedUri = sortedURIs.find((uri) => uri.fsPath === selectedFsPath) ?? sortedURIs[0];
  const anyStreaming = sortedURIs.some((uri) => stateOfURI[uri.fsPath]?.isStreaming);
  const selectedStreaming = !!selectedUri && !!stateOfURI[selectedUri.fsPath]?.isStreaming;
  const resolveModel = (uri: URI) =>
    modelService.getModel(uri) ?? sapphireModelService.getModel(uri).model;
  const resolvedModel = selectedUri ? resolveModel(selectedUri) : null;
  const modelStatus = !selectedUri
    ? 'ready'
    : resolvedModel
      ? 'ready'
      : modelLoad?.path === selectedUri.fsPath
        ? modelLoad.status
        : 'loading';

  useEffect(() => {
    if (!selectedUri || resolveModel(selectedUri)) return;
    const path = selectedUri.fsPath;
    let cancelled = false;
    setModelLoad({ path, status: 'loading' });
    void sapphireModelService.getModelSafe(selectedUri).then((result) => {
      if (cancelled) return;
      if (result.model) {
        setModelLoad(null);
        setRevision((value) => value + 1);
      } else {
        setModelLoad({ path, status: 'missing' });
      }
    });
    return () => {
      cancelled = true;
    };
    // resolveModel замыкает оба сервиса моделей из deps — отдельно не указываем
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelService, selectedUri?.fsPath, sapphireModelService]);

  useEffect(() => {
    if (!selectedUri) return;
    const model = resolveModel(selectedUri);
    if (!model) return;
    const subscription = model.onDidChangeContent(() => setRevision((value) => value + 1));
    return () => subscription.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelLoad, modelService, selectedUri, sapphireModelService]);

  const pair = useMemo(() => {
    if (!selectedUri) return null;
    const model = resolveModel(selectedUri);
    if (!model) return null;
    const zones: DiffZone[] = [];
    for (const id of editCodeService.diffAreasOfURI[selectedUri.fsPath] ?? []) {
      const area = editCodeService.diffAreaOfId[id];
      if (area?.type === 'DiffZone') zones.push(area);
    }
    const modified = model.getValue(EOL_LF);
    return { original: originalFromDiffZones(modified, zones), modified };
    // revision — правки в модели без смены набора DiffZone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCodeService, modelService, revision, selectedUri, stateOfURI, sapphireModelService]);

  const acceptOrRejectFile = (behavior: 'accept' | 'reject') => {
    if (!selectedUri || selectedStreaming) return;
    editCodeService.acceptOrRejectAllDiffAreas({
      uri: selectedUri,
      removeCtrlKs: true,
      behavior,
      _addToHistory: true,
    });
  };

  const selectedLabel = selectedUri ? getBasename(selectedUri.fsPath) : '';

  return (
    <aside className="flex-1 min-w-[320px] h-full min-h-0 flex flex-col border-l border-void-border-2 bg-void-bg-3">
      <div className="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-void-border-2">
        <span
          className="text-sm text-void-fg-1 truncate flex-1 min-w-0"
          title={selectedUri?.fsPath}
        >
          {selectedLabel}
        </span>
        {selectedStreaming && <span className="text-xs text-void-fg-3 shrink-0">пишет…</span>}
        {!selectedStreaming && selectedUri && (
          <>
            <button
              type="button"
              className="px-2 py-0.5 text-xs rounded border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 shrink-0"
              onClick={() => acceptOrRejectFile('reject')}
            >
              Отменить
            </button>
            <button
              type="button"
              className="px-2 py-0.5 text-xs rounded bg-[#00b0cc] text-white hover:bg-[#0097b2] shrink-0"
              onClick={() => acceptOrRejectFile('accept')}
            >
              Оставить
            </button>
          </>
        )}
        {!anyStreaming && (
          <>
            <button
              type="button"
              className="px-2 py-0.5 text-xs text-void-fg-3 hover:text-void-fg-1 shrink-0"
              onClick={() => commandBarService.acceptOrRejectAllFiles({ behavior: 'reject' })}
            >
              Отменить все
            </button>
            <button
              type="button"
              className="px-2 py-0.5 text-xs text-void-fg-3 hover:text-void-fg-1 shrink-0"
              onClick={() => commandBarService.acceptOrRejectAllFiles({ behavior: 'accept' })}
            >
              Оставить все
            </button>
          </>
        )}
        <button
          type="button"
          title="Свернуть"
          aria-label="Свернуть"
          className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 min-w-0">
        {selectedUri && pair ? (
          <ErrorBoundary>
            <FileDiff
              key={selectedUri.fsPath}
              uri={selectedUri}
              original={pair.original}
              modified={pair.modified}
            />
          </ErrorBoundary>
        ) : (
          <div className="p-4 text-sm text-void-fg-3">
            {modelStatus === 'missing' ? 'Файл недоступен' : 'Загрузка…'}
          </div>
        )}
      </div>
    </aside>
  );
};
