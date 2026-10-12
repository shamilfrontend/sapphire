/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';

// import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
// import { throttle } from '../../../../base/common/decorators.js';
import { findDiffs } from './helpers/findDiffs.js';
import { EndOfLinePreference, ITextModel } from '../../../../editor/common/model.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import {
  IUndoRedoElement,
  IUndoRedoService,
  UndoRedoElementType,
} from '../../../../platform/undoRedo/common/undoRedo.js';
// import { IModelService } from '../../../../editor/common/services/model.js';

import { URI } from '../../../../base/common/uri.js';
import {
  IConsistentEditorItemService,
  IConsistentItemService,
} from './helperServices/consistentItemService.js';
import { defaultQuickEditFimTags } from '../common/prompt/prompts.js';
import type { QuickEditFimTagsType } from '../common/prompt/prompts.js';
import { IModelContentChangedEvent } from '../../../../editor/common/textModelEvents.js';
import {
  INotificationService,
  Severity,
} from '../../../../platform/notification/common/notification.js';
import { Emitter } from '../../../../base/common/event.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { OnError, errorDetails } from '../common/sendLLMMessageTypes.js';
import { IEditCodeService, AddCtrlKOpts, StartApplyingOpts } from './editCodeServiceInterface.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import { deepClone } from '../../../../base/common/objects.js';
import {
  DiffArea,
  Diff,
  CtrlKZone,
  SapphireFileSnapshot,
  DiffAreaSnapshotEntry,
  diffAreaSnapshotKeys,
  DiffZone,
} from '../common/editCodeServiceTypes.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { SAPPHIRE_OPEN_SETTINGS_ACTION_ID } from './sapphireSettingsPane.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { EditCodeDiffZones } from './editCodeDiffZones.js';
import { EditCodeAcceptReject } from './editCodeAcceptReject.js';
import { EditCodeCollaboratorHost, EditCodePendingZones } from './editCodePendingZones.js';
import { EditCodeSearchReplace } from './editCodeSearchReplace.js';
import { EditCodeWriteover } from './editCodeWriteover.js';
import { StreamLocationMutable } from './editCodeText.js';
export { getLengthOfTextPx } from './editCodeText.js';

class EditCodeService extends Disposable implements IEditCodeService {
  _serviceBrand: undefined;

  // URI ↔ модель
  diffAreasOfURI: Record<string, Set<string> | undefined> = {}; // uri → diffareaId

  diffAreaOfId: Record<string, DiffArea> = {}; // diffareaId → diffArea

  diffOfId: Record<string, Diff> = {}; // diffid → diff (дублирует diffArea._diffOfId)

  private readonly _diffZones: EditCodeDiffZones;
  private readonly _pending: EditCodePendingZones;
  private readonly _writeover: EditCodeWriteover;
  private readonly _searchReplace: EditCodeSearchReplace;
  private readonly _acceptReject: EditCodeAcceptReject;

  // события

  // uri: diffZones — подписка на добавление/удаление
  private readonly _onDidAddOrDeleteDiffZones = new Emitter<{ uri: URI }>();

  onDidAddOrDeleteDiffZones = this._onDidAddOrDeleteDiffZones.event;

  // diffZone: [uri], diffs, isStreaming — смена diff и стриминга (uri постоянен)
  private readonly _onDidChangeDiffsInDiffZoneNotStreaming = new Emitter<{
    uri: URI;
    diffareaid: number;
  }>();

  private readonly _onDidChangeStreamingInDiffZone = new Emitter<{
    uri: URI;
    diffareaid: number;
  }>();

  onDidChangeDiffsInDiffZoneNotStreaming = this._onDidChangeDiffsInDiffZoneNotStreaming.event;

  onDidChangeStreamingInDiffZone = this._onDidChangeStreamingInDiffZone.event;

  // ctrlKZone: [uri], isStreaming — смена стриминга
  private readonly _onDidChangeStreamingInCtrlKZone = new Emitter<{
    uri: URI;
    diffareaid: number;
  }>();

  onDidChangeStreamingInCtrlKZone = this._onDidChangeStreamingInCtrlKZone.event;

  private readonly _onDidUserChangeContent = new Emitter<{
    uri: URI;
    beforeEntireFileCode: string;
  }>();
  onDidUserChangeContent = this._onDidUserChangeContent.event;

  /** Последний известный текст файла — для события «до ручной правки». */
  private readonly _lastKnownFileCode = new Map<string, string>();

  private _rehydratingPendingDiffZones = false;
  private readonly _persistPendingDiffZonesScheduler: RunOnceScheduler;

  constructor(
    // @IHistoryService — история Alt+←/→
    @ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
    @IModelService private readonly _modelService: IModelService,
    @IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo — история Ctrl+Z
    @ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
    @IConsistentItemService private readonly _consistentItemService: IConsistentItemService,
    @IInstantiationService private readonly _instantiationService: IInstantiationService,
    @IConsistentEditorItemService
    private readonly _consistentEditorItemService: IConsistentEditorItemService,
    @INotificationService private readonly _notificationService: INotificationService,
    @ICommandService private readonly _commandService: ICommandService,
    @ISapphireSettingsService private readonly _settingsService: ISapphireSettingsService,
    // @IFileService private readonly _fileService: IFileService,
    @ISapphireModelService private readonly _sapphireModelService: ISapphireModelService,
    @IConvertToLLMMessageService
    private readonly _convertToLLMMessageService: IConvertToLLMMessageService,
    @IStorageService private readonly _storageService: IStorageService,
  ) {
    super();

    const host = this as unknown as EditCodeCollaboratorHost;
    this._pending = new EditCodePendingZones(host);
    this._writeover = new EditCodeWriteover(host);
    this._searchReplace = new EditCodeSearchReplace(host);
    this._acceptReject = new EditCodeAcceptReject(host);
    // Коллабораторы читают host; void-ссылки для noUnusedLocals.
    void this._rehydratingPendingDiffZones;
    void this._llmMessageService;
    void this._settingsService;
    void this._convertToLLMMessageService;
    void this._storageService;
    void this._getQuickEditFimTags;
    void this._notifyError;
    void this._getActiveEditorURI;
    void this._writeStreamedDiffZoneLLMText;
    void this._getURIBeforeStartApplying;
    void this._startStreamingDiffZone;
    void this._initializeSearchAndReplaceStream;

    const service = this;
    this._diffZones = new EditCodeDiffZones({
      diffAreasOfURI: this.diffAreasOfURI,
      diffAreaOfId: this.diffAreaOfId,
      diffOfId: this.diffOfId,
      mostRecentTextOfCtrlKZoneId: this.mostRecentTextOfCtrlKZoneId,
      get _diffareaidPool() {
        return service._diffareaidPool;
      },
      set _diffareaidPool(value: number) {
        service._diffareaidPool = value;
      },
      get _diffidPool() {
        return service._diffidPool;
      },
      set _diffidPool(value: number) {
        service._diffidPool = value;
      },
      _sapphireModelService: this._sapphireModelService,
      _codeEditorService: this._codeEditorService,
      _consistentEditorItemService: this._consistentEditorItemService,
      _consistentItemService: this._consistentItemService,
      _instantiationService: this._instantiationService,
      _onDidAddOrDeleteDiffZones: this._onDidAddOrDeleteDiffZones,
      _onDidChangeDiffsInDiffZoneNotStreaming: this._onDidChangeDiffsInDiffZoneNotStreaming,
      _getModelLineRange: (model, startLine, endLine) =>
        this._getModelLineRange(model, startLine, endLine),
      _schedulePersistPendingDiffZones: () => this._schedulePersistPendingDiffZones(),
      acceptDiff: (opts) => {
        void this.acceptDiff(opts);
      },
      rejectDiff: (opts) => {
        void this.rejectDiff(opts);
      },
    });

    this._persistPendingDiffZonesScheduler = this._register(
      new RunOnceScheduler(() => this._persistAllPendingDiffZones(), 300),
    );
    void this._persistPendingDiffZonesScheduler;

    // Инициализация структур и подписки на изменения моделей
    const registeredModelURIs = new Set<string>();
    const initializeModel = async (model: ITextModel) => {
      await this._sapphireModelService.initializeModel(model.uri);

      // Модель могла dispose-иться во время await (краткоживущие/inmemory).
      if (model.isDisposed()) {
        return;
      }

      // Не вешать слушатели дважды — иначе дубликаты
      if (registeredModelURIs.has(model.uri.fsPath)) return;
      registeredModelURIs.add(model.uri.fsPath);

      if (!(model.uri.fsPath in this.diffAreasOfURI)) {
        this.diffAreasOfURI[model.uri.fsPath] = new Set();
      }

      this._lastKnownFileCode.set(model.uri.fsPath, model.getValue(EndOfLinePreference.LF));

      // При вводе пользователя — realign diff-областей и перерисовка
      this._register(
        model.onDidChangeContent((e) => {
          if (model.isDisposed()) {
            return;
          }
          const beforeEntireFileCode = this._noteModelText(model);
          // Запись агента обновляет baseline, но не считается ручной правкой.
          if (this.weAreWriting) return;
          this._onUserChangeContent(model.uri, e, beforeEntireFileCode);
        }),
      );

      // При монтировании модели — обновить diff, добавленные в фоне
      this._diffZones._refreshStylesAndDiffsInURI(model.uri);
    };
    // Все текущие модели + onModelAdded
    for (let model of this._modelService.getModels()) {
      initializeModel(model);
    }
    this._register(
      this._modelService.onModelAdded((model) => {
        initializeModel(model);
      }),
    );

    // Обновление стилей при смене вкладки редактора
    let initializeEditor = (editor: ICodeEditor) => {
      const uri = editor.getModel()?.uri ?? null;
      if (uri) this._diffZones._refreshStylesAndDiffsInURI(uri);
    };

    // Существующие редакторы + onCodeEditorAdd
    for (let editor of this._codeEditorService.listCodeEditors()) {
      initializeEditor(editor);
    }
    this._register(
      this._codeEditorService.onCodeEditorAdd((editor) => {
        initializeEditor(editor);
      }),
    );

    void this._rehydratePendingDiffZones();
  }

  /** Запомнить текст и вернуть значение до этого изменения. */
  private _noteModelText(model: ITextModel): string {
    const fsPath = model.uri.fsPath;
    if (model.isDisposed()) {
      return this._lastKnownFileCode.get(fsPath) ?? '';
    }
    const before = this._lastKnownFileCode.get(fsPath) ?? model.getValue(EndOfLinePreference.LF);
    this._lastKnownFileCode.set(fsPath, model.getValue(EndOfLinePreference.LF));
    return before;
  }

  private _onUserChangeContent(
    uri: URI,
    e: IModelContentChangedEvent,
    beforeEntireFileCode: string,
  ) {
    this._onDidUserChangeContent.fire({ uri, beforeEntireFileCode });
    for (const change of e.changes) {
      this._diffZones._realignAllDiffAreasLines(uri, change.text, change.range);
    }
    this._diffZones._refreshStylesAndDiffsInURI(uri);

    // Пустая DiffZone после правки пользователя — удалить
    const diffAreasToDelete: DiffZone[] = [];
    for (const diffareaid of this.diffAreasOfURI[uri.fsPath] ?? []) {
      const diffArea = this.diffAreaOfId[diffareaid] ?? null;
      const shouldDelete =
        diffArea?.type === 'DiffZone' && Object.keys(diffArea._diffOfId).length === 0;
      if (shouldDelete) {
        diffAreasToDelete.push(diffArea);
      }
    }
    if (diffAreasToDelete.length !== 0) {
      const { onFinishEdit } = this._addToHistory(uri);
      diffAreasToDelete.forEach((da) => this._diffZones._deleteDiffZone(da));
      onFinishEdit();
    }
  }

  public processRawKeybindingText(keybindingStr: string): string {
    return keybindingStr
      .replace(/Enter/g, '↵') // ⏎
      .replace(/Backspace/g, '⌫');
  }

  /** FIM-теги Ctrl+K; при необходимости — из настроек. */
  private _getQuickEditFimTags(): QuickEditFimTagsType {
    return defaultQuickEditFimTags;
  }

  private _getModelLineRange(model: ITextModel, startLine: number, endLine: number): string {
    return model.getValueInRange(
      {
        startLineNumber: startLine,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn: Number.MAX_SAFE_INTEGER,
      },
      EndOfLinePreference.LF,
    );
  }

  private _notifyError = (e: Parameters<OnError>[0]) => {
    const details = errorDetails(e.fullError);
    this._notificationService.notify({
      severity: Severity.Warning,
      message: `Sapphire: ${e.message}`,
      actions: {
        secondary: [
          {
            id: 'sapphire.onerror.opensettings',
            enabled: true,
            label: `Open Sapphire settings`,
            tooltip: '',
            class: undefined,
            run: () => {
              this._commandService.executeCommand(SAPPHIRE_OPEN_SETTINGS_ACTION_ID);
            },
          },
        ],
      },
      source: details
        ? `(Hold ${isMacintosh ? 'Option' : 'Alt'} to hover) - ${details}`
        : undefined,
    });
  };

  mostRecentTextOfCtrlKZoneId: Record<string, string | undefined> = {};

  private _getActiveEditorURI(): URI | null {
    const editor = this._codeEditorService.getActiveCodeEditor();
    if (!editor) return null;
    const uri = editor.getModel()?.uri;
    if (!uri) return null;
    return uri;
  }

  weAreWriting = false;

  private _writeURIText(
    uri: URI,
    text: string,
    range_: IRange | 'wholeFileRange',
    { shouldRealignDiffAreas }: { shouldRealignDiffAreas: boolean },
  ) {
    const { model } = this._sapphireModelService.getModel(uri);
    if (!model) {
      this._diffZones._refreshStylesAndDiffsInURI(uri); // После write всё равно refresh стилей (в т.ч. если applyEdits не менял текст)
      return;
    }

    const range: IRange =
      range_ === 'wholeFileRange'
        ? {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: model.getLineCount(),
            endColumn: Number.MAX_SAFE_INTEGER,
          } // весь файл
        : range_;

    // Realign не зависит от текста записи (diff-области «виртуальны») — можно до applyEdits
    if (shouldRealignDiffAreas) {
      const newText = text;
      const oldRange = range;
      this._diffZones._realignAllDiffAreasLines(uri, newText, oldRange);
    }

    const uriStr = model.getValue(EndOfLinePreference.LF);

    // Эвристика: пропуск записи, если текст не изменился
    const dontNeedToWrite = uriStr === text;
    if (dontNeedToWrite) {
      this._diffZones._refreshStylesAndDiffsInURI(uri); // После write всё равно refresh стилей (в т.ч. если applyEdits не менял текст)
      return;
    }

    this.weAreWriting = true;
    model.applyEdits([{ range, text }]);
    this.weAreWriting = false;

    this._diffZones._refreshStylesAndDiffsInURI(uri);
  }

  private _getCurrentVoidFileSnapshot = (uri: URI): SapphireFileSnapshot => {
    const { model } = this._sapphireModelService.getModel(uri);
    const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshotEntry> = {};

    for (const diffareaid in this.diffAreaOfId) {
      const diffArea = this.diffAreaOfId[diffareaid];

      if (diffArea._URI.fsPath !== uri.fsPath) continue;

      snapshottedDiffAreaOfId[diffareaid] = deepClone(
        Object.fromEntries(diffAreaSnapshotKeys.map((key) => [key, diffArea[key]])),
      ) as DiffAreaSnapshotEntry;
    }

    const entireFileCode = model ? model.getValue(EndOfLinePreference.LF) : '';

    // this._noLongerNeedModelReference(uri)
    return {
      snapshottedDiffAreaOfId,
      entireFileCode, // код всего файла
    };
  };

  private _restoreVoidFileSnapshot = async (uri: URI, snapshot: SapphireFileSnapshot) => {
    // Остановить стрим всех DiffZone на uri
    for (const diffareaid in this.diffAreaOfId) {
      const diffArea = this.diffAreaOfId[diffareaid];
      if (diffArea.type === 'DiffZone') this._stopIfStreaming(diffArea);
    }

    // Удалить все diff-области на uri (со стилями)
    this._diffZones._deleteAllDiffAreas(uri);

    const { snapshottedDiffAreaOfId, entireFileCode: entireModelCode } = deepClone(snapshot); // не мутировать переданный snapshot

    // Восстановить diffAreaOfId и diffAreasOfURI
    for (const diffareaid in snapshottedDiffAreaOfId) {
      const snapshottedDiffArea = snapshottedDiffAreaOfId[diffareaid];

      if (snapshottedDiffArea.type === 'DiffZone') {
        this.diffAreaOfId[diffareaid] = {
          ...(snapshottedDiffArea as DiffAreaSnapshotEntry<DiffZone>),
          type: 'DiffZone',
          _diffOfId: {},
          _URI: uri,
          _streamState: { isStreaming: false }, // после restore стриминга не будет
          _removeStylesFns: new Set(),
        };
      } else if (snapshottedDiffArea.type === 'CtrlKZone') {
        this.diffAreaOfId[diffareaid] = {
          ...(snapshottedDiffArea as DiffAreaSnapshotEntry<CtrlKZone>),
          _URI: uri,
          _removeStylesFns: new Set<Function>(),
          _mountInfo: null,
          _linkedStreamingDiffZone: null, // после restore стриминга не будет
        };
      }
      this._diffZones._addOrInitializeDiffAreaAtURI(uri, diffareaid);
    }
    this._pending._bumpDiffAreaIdPoolFromRestoredIds(snapshottedDiffAreaOfId);
    this._onDidAddOrDeleteDiffZones.fire({ uri });

    // Восстановить содержимое файла
    this._writeURIText(uri, entireModelCode, 'wholeFileRange', { shouldRealignDiffAreas: false });
    // this._noLongerNeedModelReference(uri)
  };

  private _addToHistory(uri: URI, opts?: { onWillUndo?: () => void }) {
    const beforeSnapshot: SapphireFileSnapshot = this._getCurrentVoidFileSnapshot(uri);
    let afterSnapshot: SapphireFileSnapshot | null = null;

    const elt: IUndoRedoElement = {
      type: UndoRedoElementType.Resource,
      resource: uri,
      label: 'Sapphire Agent',
      code: 'undoredo.editCode',
      undo: async () => {
        opts?.onWillUndo?.();
        await this._restoreVoidFileSnapshot(uri, beforeSnapshot);
      },
      redo: async () => {
        if (afterSnapshot) await this._restoreVoidFileSnapshot(uri, afterSnapshot);
      },
    };
    this._undoRedoService.pushElement(elt);

    const onFinishEdit = async () => {
      afterSnapshot = this._getCurrentVoidFileSnapshot(uri);
      await this._sapphireModelService.saveModel(uri);
    };
    return { onFinishEdit };
  }

  public getVoidFileSnapshot(uri: URI) {
    return this._getCurrentVoidFileSnapshot(uri);
  }

  public restoreVoidFileSnapshot(uri: URI, snapshot: SapphireFileSnapshot): void {
    this._restoreVoidFileSnapshot(uri, snapshot);
  }
  private _diffareaidPool = 0; // id diff-области

  private _diffidPool = 0; // id diff

  // @throttle(100)
  private _writeStreamedDiffZoneLLMText(
    uri: URI,
    originalCode: string,
    llmTextSoFar: string,
    deltaText: string,
    latestMutable: StreamLocationMutable,
  ) {
    let numNewLines = 0;

    // --- 1. Запись нового кода в документ ---
    // Позиция подсветки по последнему diff в потоке LLM
    const computedDiffs = findDiffs(originalCode, llmTextSoFar);

    // При стриме — через diff определяем, куда писать
    // Две системы координат: строки в LLM-тексте и в originalCode
    let endLineInLlmTextSoFar: number; // строка подсветки стрима в координатах LLM-текста
    let startLineInOriginalCode: number; // якорь в originalCode (1-based)

    const lastDiff = computedDiffs.pop();

    if (!lastDiff) {
      // console.log('!lastDiff')
      // Пока текст совпадает с original — без видимых изменений
      startLineInOriginalCode = 1;
      endLineInLlmTextSoFar = 1;
    } else {
      startLineInOriginalCode = lastDiff.originalStartLine;
      if (lastDiff.type === 'insertion' || lastDiff.type === 'edit')
        endLineInLlmTextSoFar = lastDiff.endLine;
      else if (lastDiff.type === 'deletion') endLineInLlmTextSoFar = lastDiff.startLine;
      else throw new Error(`Sapphire: diff.type not recognized on: ${lastDiff}`);
    }

    // В начале — разделитель \n между потоком и originalCode для алгоритма
    if (!latestMutable.addedSplitYet) {
      this._writeURIText(
        uri,
        '\n',
        {
          startLineNumber: latestMutable.line,
          startColumn: latestMutable.col,
          endLineNumber: latestMutable.line,
          endColumn: latestMutable.col,
        },
        { shouldRealignDiffAreas: true },
      );
      latestMutable.addedSplitYet = true;
      numNewLines += 1;
    }

    // Вставка deltaText в текущую line/col
    this._writeURIText(
      uri,
      deltaText,
      {
        startLineNumber: latestMutable.line,
        startColumn: latestMutable.col,
        endLineNumber: latestMutable.line,
        endColumn: latestMutable.col,
      },
      { shouldRealignDiffAreas: true },
    );
    const deltaNumNewLines = deltaText.split('\n').length - 1;
    latestMutable.line += deltaNumNewLines;
    const lastNewlineIdx = deltaText.lastIndexOf('\n');
    latestMutable.col =
      lastNewlineIdx === -1
        ? latestMutable.col + deltaText.length
        : deltaText.length - lastNewlineIdx;
    numNewLines += deltaNumNewLines;

    // Удаление/вставка, чтобы синхронизировать originalCode
    if (latestMutable.originalCodeStartLine < startLineInOriginalCode) {
      // Курсор «поднялся» по original — удаляем лишние строки
      const numLinesDeleted = startLineInOriginalCode - latestMutable.originalCodeStartLine;
      this._writeURIText(
        uri,
        '',
        {
          startLineNumber: latestMutable.line,
          startColumn: latestMutable.col,
          endLineNumber: latestMutable.line + numLinesDeleted,
          endColumn: Number.MAX_SAFE_INTEGER,
        },
        { shouldRealignDiffAreas: true },
      );
      numNewLines -= numLinesDeleted;
    } else if (latestMutable.originalCodeStartLine > startLineInOriginalCode) {
      const newText = `\n${originalCode
        .split('\n')
        .slice(startLineInOriginalCode - 1, latestMutable.originalCodeStartLine - 1 - 1 + 1)
        .join('\n')}`;
      this._writeURIText(
        uri,
        newText,
        {
          startLineNumber: latestMutable.line,
          startColumn: latestMutable.col,
          endLineNumber: latestMutable.line,
          endColumn: latestMutable.col,
        },
        { shouldRealignDiffAreas: true },
      );
      numNewLines += newText.split('\n').length - 1;
    }
    latestMutable.originalCodeStartLine = startLineInOriginalCode;

    return { endLineInLlmTextSoFar, numNewLines }; // numNewLines может быть неточным
  }
  _undoHistory(uri: URI) {
    this._undoRedoService.undo(uri);
  }

  isCtrlKZoneStreaming({ diffareaid }: { diffareaid: number }) {
    const ctrlKZone = this.diffAreaOfId[diffareaid];
    if (!ctrlKZone) return false;
    if (ctrlKZone.type !== 'CtrlKZone') return false;
    return !!ctrlKZone._linkedStreamingDiffZone;
  }

  private _schedulePersistPendingDiffZones() {
    this._pending._schedulePersistPendingDiffZones();
  }
  private _persistAllPendingDiffZones() {
    this._pending._persistAllPendingDiffZones();
  }
  private _rehydratePendingDiffZones() {
    return this._pending._rehydratePendingDiffZones();
  }
  private _getURIBeforeStartApplying(
    ...args: Parameters<EditCodeWriteover['_getURIBeforeStartApplying']>
  ) {
    return this._writeover._getURIBeforeStartApplying(...args);
  }
  private _startStreamingDiffZone(
    ...args: Parameters<EditCodeWriteover['_startStreamingDiffZone']>
  ) {
    return this._writeover._startStreamingDiffZone(...args);
  }
  public addCtrlKZone(opts: AddCtrlKOpts) {
    return this._writeover.addCtrlKZone(opts);
  }
  public removeCtrlKZone(opts: { diffareaid: number }) {
    return this._writeover.removeCtrlKZone(opts);
  }
  public callBeforeApplyOrEdit(givenURI: URI | 'current') {
    return this._writeover.callBeforeApplyOrEdit(givenURI);
  }
  public startApplying(opts: StartApplyingOpts): [URI, Promise<void>] | null {
    return this._writeover.startApplying(opts);
  }
  public instantlyRewriteFile(opts: { uri: URI; newContent: string }) {
    return this._writeover.instantlyRewriteFile(opts);
  }
  public instantlyApplySearchReplaceBlocks(opts: { uri: URI; searchReplaceBlocks: string }) {
    return this._searchReplace.instantlyApplySearchReplaceBlocks(opts);
  }
  private _initializeSearchAndReplaceStream(
    ...args: Parameters<EditCodeSearchReplace['_initializeSearchAndReplaceStream']>
  ) {
    return this._searchReplace._initializeSearchAndReplaceStream(...args);
  }
  private _stopIfStreaming(diffZone: DiffZone) {
    this._acceptReject._stopIfStreaming(diffZone);
  }
  interruptCtrlKStreaming(opts: { diffareaid: number }) {
    this._acceptReject.interruptCtrlKStreaming(opts);
  }
  interruptURIStreaming(opts: { uri: URI }) {
    this._acceptReject.interruptURIStreaming(opts);
  }
  public acceptOrRejectAllDiffAreas: IEditCodeService['acceptOrRejectAllDiffAreas'] = async (
    opts,
  ) => {
    return this._acceptReject.acceptOrRejectAllDiffAreas(opts);
  };
  public acceptDiff(opts: { diffid: number }) {
    return this._acceptReject.acceptDiff(opts);
  }
  public rejectDiff(opts: { diffid: number }) {
    return this._acceptReject.rejectDiff(opts);
  }
}

registerSingleton(IEditCodeService, EditCodeService, InstantiationType.Eager);
