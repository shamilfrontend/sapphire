/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { URI } from '../../../../base/common/uri.js';
import {
  sapphirePrefixAndSuffix,
  ctrlKStream_userMessage,
  ctrlKStream_systemMessage,
  rewriteCode_systemMessage,
  rewriteCode_userMessage,
} from '../common/prompt/prompts.js';
import {
  extractCodeFromFIM,
  extractCodeFromRegular,
} from '../common/helpers/extractCodeFromResult.js';
import { LLMChatMessage, OnError, OnFinalMessage, OnText } from '../common/sendLLMMessageTypes.js';
import {
  AddCtrlKOpts,
  StartApplyingOpts,
  CallBeforeStartApplyingOpts,
} from './editCodeServiceInterface.js';
import { FeatureName } from '../common/sapphireSettingsTypes.js';
import { DiffArea, CtrlKZone, DiffZone } from '../common/editCodeServiceTypes.js';
import { StreamLocationMutable } from './editCodeText.js';
import { EditCodeCollaboratorHost } from './editCodePendingZones.js';

export class EditCodeWriteover {
  constructor(private readonly _s: EditCodeCollaboratorHost) {}

  public addCtrlKZone({ startLine, endLine, editor }: AddCtrlKOpts) {
    // await не нужен: для Ctrl+K модель уже открыта
    // await this._s._ensureModelExists(uri)

    const uri = editor.getModel()?.uri;
    if (!uri) {return;}

    // Пересечение с другой CtrlKZone — фокус на неё
    const overlappingCtrlKZone = this._findOverlappingDiffArea({
      startLine,
      endLine,
      uri,
      filter: (diffArea) => diffArea.type === 'CtrlKZone',
    });
    if (overlappingCtrlKZone) {
      editor.revealLine(overlappingCtrlKZone.startLine); // важно для UX
      setTimeout(
        () => (overlappingCtrlKZone as CtrlKZone)._mountInfo?.textAreaRef.current?.focus(),
        100,
      );
      return;
    }

    const overlappingDiffZone = this._findOverlappingDiffArea({
      startLine,
      endLine,
      uri,
      filter: (diffArea) => diffArea.type === 'DiffZone',
    });
    if (overlappingDiffZone) {return;}

    editor.revealLine(startLine);
    editor.setSelection({
      startLineNumber: startLine,
      endLineNumber: startLine,
      startColumn: 1,
      endColumn: 1,
    });

    const { onFinishEdit } = this._s._addToHistory(uri);

    const adding: Omit<CtrlKZone, 'diffareaid'> = {
      type: 'CtrlKZone',
      startLine,
      endLine,
      editorId: editor.getId(),
      _URI: uri,
      _removeStylesFns: new Set(),
      _mountInfo: null,
      _linkedStreamingDiffZone: null,
    };
    const ctrlKZone = this._s._diffZones._addDiffArea(adding);
    this._s._diffZones._refreshStylesAndDiffsInURI(uri);

    onFinishEdit();
    return ctrlKZone.diffareaid;
  }

  // remove = удаление + запись в undo-историю
  public removeCtrlKZone({ diffareaid }: { diffareaid: number }) {
    const ctrlKZone = this._s.diffAreaOfId[diffareaid];
    if (!ctrlKZone) {return;}
    if (ctrlKZone.type !== 'CtrlKZone') {return;}

    const uri = ctrlKZone._URI;
    const { onFinishEdit } = this._s._addToHistory(uri);
    this._s._diffZones._deleteCtrlKZone(ctrlKZone);
    this._s._diffZones._refreshStylesAndDiffsInURI(uri);
    onFinishEdit();
  }

  _getURIBeforeStartApplying(opts: CallBeforeStartApplyingOpts) {
    // Search/Replace (ClickApply)
    if (opts.from === 'ClickApply') {
      const uri = this._uriOfGivenURI(opts.uri);
      if (!uri) {return;}
      return uri;
    }
    if (opts.from === 'QuickEdit') {
      const { diffareaid } = opts;
      const ctrlKZone = this._s.diffAreaOfId[diffareaid];
      if (ctrlKZone?.type !== 'CtrlKZone') {return;}
      const { _URI: uri } = ctrlKZone;
      return uri;
    }
    return;
  }

  public async callBeforeApplyOrEdit(givenURI: URI | 'current') {
    const uri = this._uriOfGivenURI(givenURI);
    if (!uri) {return;}
    await this._s._sapphireModelService.initializeModel(uri);
    await this._s._sapphireModelService.saveModel(uri); // сохранить файл
  }

  // applyDonePromise может reject — обрабатывать .catch
  public startApplying(opts: StartApplyingOpts): [URI, Promise<void>] | null {
    let res: [DiffZone, Promise<void>] | undefined;

    if (opts.from === 'QuickEdit') {
      res = this._initializeWriteoverStream(opts); // rewrite
    } else if (opts.from === 'ClickApply') {
      if (this._s._settingsService.state.globalSettings.enableFastApply) {
        const numCharsInFile = this._fileLengthOfGivenURI(opts.uri);
        if (numCharsInFile === null) {return null;}
        if (numCharsInFile < 1000) {
          // Медленный apply для коротких файлов (важно для пустых)
          res = this._initializeWriteoverStream(opts);
        } else {
          res = this._s._initializeSearchAndReplaceStream(opts); // fast apply
        }
      } else {
        res = this._initializeWriteoverStream(opts); // rewrite
      }
    }

    if (!res) {return null;}
    const [diffZone, applyDonePromise] = res;
    return [diffZone._URI, applyDonePromise];
  }

  public async instantlyRewriteFile({ uri, newContent }: { uri: URI; newContent: string }) {
    // Создать DiffZone
    const res = this._startStreamingDiffZone({
      uri,
      streamRequestIdRef: { current: null },
      startBehavior: 'keep-conflicts',
      linkedCtrlKZone: null,
      onWillUndo: () => {},
    });
    if (!res) {
      throw new Error(`File does not exist or could not be loaded: ${uri.fsPath}`);
    }
    const { diffZone, onFinishEdit } = res;

    diffZone._streamState = { isStreaming: false };
    this._s._writeURIText(uri, newContent, 'wholeFileRange', { shouldRealignDiffAreas: true });
    this._s._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
    this._s._diffZones._refreshStylesAndDiffsInURI(uri);
    await onFinishEdit();

    // Автопринятие diff при включённой настройке
    if (this._s._settingsService.state.globalSettings.autoAcceptLLMChanges) {
      this._s.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: false, behavior: 'accept' });
    }
  }

  private _findOverlappingDiffArea({
    startLine,
    endLine,
    uri,
    filter,
  }: {
    startLine: number;
    endLine: number;
    uri: URI;
    filter?: (diffArea: DiffArea) => boolean;
  }): DiffArea | null {
    // Пересечение diff-областей — вернуть найденную
    for (const diffareaid of this._s.diffAreasOfURI[uri.fsPath] || []) {
      const diffArea = this._s.diffAreaOfId[diffareaid];
      if (!diffArea) {continue;}
      if (!filter?.(diffArea)) {continue;}
      const noOverlap = diffArea.startLine > endLine || diffArea.endLine < startLine;
      if (!noOverlap) {
        return diffArea;
      }
    }
    return null;
  }

  _startStreamingDiffZone({
    uri,
    startBehavior,
    streamRequestIdRef,
    linkedCtrlKZone,
    onWillUndo,
  }: {
    uri: URI;
    startBehavior: 'accept-conflicts' | 'reject-conflicts' | 'keep-conflicts';
    streamRequestIdRef: { current: string | null };
    linkedCtrlKZone: CtrlKZone | null;
    onWillUndo: () => void;
  }) {
    const { model } = this._s._sapphireModelService.getModel(uri);
    if (!model) {return;}

    // Как весь файл, либо диапазон linked CtrlKZone

    const startLine = linkedCtrlKZone ? linkedCtrlKZone.startLine : 1;
    const endLine = linkedCtrlKZone ? linkedCtrlKZone.endLine : model.getLineCount();

    const originalFileStr = model.getValue(EndOfLinePreference.LF);
    let originalCode = this._s._getModelLineRange(model, startLine, endLine);

    // Checkpoint в undo перед модификацией
    const { onFinishEdit } = this._s._addToHistory(uri, { onWillUndo });

    // Убрать конфликтующие DiffZone
    if (startBehavior === 'keep-conflicts') {
      if (linkedCtrlKZone) {
        // У CtrlKZone конфликтов быть не должно
      } else {
        // keep-conflicts: reject → oldFileStr как originalCode → вернуть файл
        this._s.acceptOrRejectAllDiffAreas({
          uri,
          removeCtrlKs: true,
          behavior: 'reject',
          _addToHistory: false,
        });
        const oldFileStr = model.getValue(EndOfLinePreference.LF); // baseline originalCode после reject
        this._s._writeURIText(uri, originalFileStr, 'wholeFileRange', {
          shouldRealignDiffAreas: true,
        }); // un-revert
        originalCode = oldFileStr;
      }
    } else if (startBehavior === 'accept-conflicts' || startBehavior === 'reject-conflicts') {
      const behavior = startBehavior === 'accept-conflicts' ? 'accept' : 'reject';
      this._s.acceptOrRejectAllDiffAreas({
        uri,
        removeCtrlKs: true,
        behavior,
        _addToHistory: false,
      });
    }

    const adding: Omit<DiffZone, 'diffareaid'> = {
      type: 'DiffZone',
      originalCode,
      startLine,
      endLine,
      _URI: uri,
      _streamState: {
        isStreaming: true,
        streamRequestIdRef,
        line: startLine,
      },
      _diffOfId: {}, // added later
      _removeStylesFns: new Set(),
    };

    const diffZone = this._s._diffZones._addDiffArea(adding);
    this._s._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
    this._s._onDidAddOrDeleteDiffZones.fire({ uri });

    // Связь CtrlKZone со стримящейся DiffZone
    if (linkedCtrlKZone) {
      const ctrlKZone = linkedCtrlKZone;
      ctrlKZone._linkedStreamingDiffZone = diffZone.diffareaid;
      this._s._onDidChangeStreamingInCtrlKZone.fire({ uri, diffareaid: ctrlKZone.diffareaid });
    }

    return { diffZone, onFinishEdit };
  }

  private _uriIsStreaming(uri: URI) {
    const diffAreas = this._s.diffAreasOfURI[uri.fsPath];
    if (!diffAreas) {return false;}
    for (const diffareaid of diffAreas) {
      const diffArea = this._s.diffAreaOfId[diffareaid];
      if (diffArea?.type !== 'DiffZone') {continue;}
      if (diffArea._streamState.isStreaming) {return true;}
    }
    return false;
  }

  private _initializeWriteoverStream(
    opts: StartApplyingOpts,
  ): [DiffZone, Promise<void>] | undefined {
    const { from } = opts;
    const featureName: FeatureName = opts.from === 'ClickApply' ? 'Apply' : 'Ctrl+K';
    const overridesOfModel = this._s._settingsService.state.overridesOfModel;
    const modelSelection = this._s._settingsService.state.modelSelectionOfFeature[featureName];
    const modelSelectionOptions = modelSelection
      ? this._s._settingsService.state.optionsOfModelSelection[featureName][
          modelSelection.providerName
        ]?.[modelSelection.modelName]
      : undefined;

    const uri = this._getURIBeforeStartApplying(opts);
    if (!uri) {return;}

    let startRange: 'fullFile' | [number, number];
    let ctrlKZoneIfQuickEdit: CtrlKZone | null = null;

    if (from === 'ClickApply') {
      startRange = 'fullFile';
    } else if (from === 'QuickEdit') {
      const { diffareaid } = opts;
      const ctrlKZone = this._s.diffAreaOfId[diffareaid];
      if (ctrlKZone?.type !== 'CtrlKZone') {return;}
      ctrlKZoneIfQuickEdit = ctrlKZone;
      const { startLine: startLine_, endLine: endLine_ } = ctrlKZone;
      startRange = [startLine_, endLine_];
    } else {
      throw new Error(`Sapphire: diff.type not recognized on: ${from}`);
    }

    const { model } = this._s._sapphireModelService.getModel(uri);
    if (!model) {return;}

    const streamRequestIdRef: { current: string | null } = { current: null }; // ref для streamRequestId DiffZone

    // Сбор сообщений LLM
    const quickEditFIMTags = this._s._getQuickEditFimTags();
    const originalFileCode = model.getValue(EndOfLinePreference.LF);
    const originalCode =
      startRange === 'fullFile'
        ? originalFileCode
        : this._s._getModelLineRange(model, startRange[0], startRange[1]);
    const language = model.getLanguageId();
    let messages: LLMChatMessage[];
    let separateSystemMessage: string | undefined;
    if (from === 'ClickApply') {
      const { messages: a, separateSystemMessage: b } =
        this._s._convertToLLMMessageService.prepareLLMSimpleMessages({
          systemMessage: rewriteCode_systemMessage,
          simpleMessages: [
            {
              role: 'user',
              content: rewriteCode_userMessage({ originalCode, applyStr: opts.applyStr, language }),
            },
          ],
          featureName,
          modelSelection,
        });
      messages = a;
      separateSystemMessage = b;
    } else if (from === 'QuickEdit') {
      if (!ctrlKZoneIfQuickEdit) {return;}
      const { _mountInfo } = ctrlKZoneIfQuickEdit;
      const instructions = _mountInfo?.textAreaRef.current?.value ?? '';

      const startLine = startRange === 'fullFile' ? 1 : startRange[0];
      const endLine = startRange === 'fullFile' ? model.getLineCount() : startRange[1];
      const { prefix, suffix } = sapphirePrefixAndSuffix({
        fullFileStr: originalFileCode,
        startLine,
        endLine,
      });
      const userContent = ctrlKStream_userMessage({
        selection: originalCode,
        instructions,
        prefix,
        suffix,
        fimTags: quickEditFIMTags,
        language,
      });

      const { messages: a, separateSystemMessage: b } =
        this._s._convertToLLMMessageService.prepareLLMSimpleMessages({
          systemMessage: ctrlKStream_systemMessage({ quickEditFIMTags }),
          simpleMessages: [{ role: 'user', content: userContent }],
          featureName,
          modelSelection,
        });
      messages = a;
      separateSystemMessage = b;
    } else {
      throw new Error(`featureName ${from} is invalid`);
    }

    // uri уже стримится — выход (проверяет вызывающий)
    if (this._uriIsStreaming(uri)) {return;}

    // Создать DiffZone
    const res = this._startStreamingDiffZone({
      uri,
      streamRequestIdRef,
      startBehavior: opts.startBehavior,
      linkedCtrlKZone: ctrlKZoneIfQuickEdit,
      onWillUndo: () => {
        if (streamRequestIdRef.current) {
          this._s._llmMessageService.abort(streamRequestIdRef.current);
        }
      },
    });
    if (!res) {return;}
    const { diffZone, onFinishEdit } = res;

    // колбэки завершения / ошибки стрима
    const onDone = () => {
      console.log('called onDone');
      diffZone._streamState = { isStreaming: false };
      this._s._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });

      if (ctrlKZoneIfQuickEdit) {
        const ctrlKZone = ctrlKZoneIfQuickEdit;

        ctrlKZone._linkedStreamingDiffZone = null;
        this._s._onDidChangeStreamingInCtrlKZone.fire({ uri, diffareaid: ctrlKZone.diffareaid });
        this._s._diffZones._deleteCtrlKZone(ctrlKZone);
      }
      this._s._diffZones._refreshStylesAndDiffsInURI(uri);
      onFinishEdit();

      // Автопринятие diff при включённой настройке
      if (this._s._settingsService.state.globalSettings.autoAcceptLLMChanges) {
        this._s.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: false, behavior: 'accept' });
      }
    };

    // onError бросает после undo
    const onError = (e: { message: string; fullError: Error | null }) => {
      this._s._notifyError(e);
      onDone();
      this._s._undoHistory(uri);
      throw e.fullError || new Error(e.message);
    };

    const extractText = (fullText: string, recentlyAddedTextLen: number) => {
      if (from === 'QuickEdit') {
        return extractCodeFromFIM({
          text: fullText,
          recentlyAddedTextLen,
          midTag: quickEditFIMTags.midTag,
        });
      }
      if (from === 'ClickApply') {
        return extractCodeFromRegular({ text: fullText, recentlyAddedTextLen });
      }
      throw new Error('Sapphire 1');
    };

    // Refresh до первого onText
    this._s._diffZones._refreshStylesAndDiffsInURI(uri);

    const latestStreamLocationMutable: StreamLocationMutable = {
      line: diffZone.startLine,
      addedSplitYet: false,
      col: 1,
      originalCodeStartLine: 1,
    };

    // Может throw — внутри promise с catch
    const runWriteover = async () => {
      let shouldSendAnotherMessage = true;
      while (shouldSendAnotherMessage) {
        shouldSendAnotherMessage = false;

        let resMessageDonePromise: () => void = () => {};
        const messageDonePromise = new Promise<void>((res_) => {
          resMessageDonePromise = res_;
        });

        // Состояние onText:
        let fullTextSoFar = ''; // включая ранее отброшенный суффикс ```
        let prevIgnoredSuffix = '';
        let aborted = false;
        const weAreAborting = false;

        streamRequestIdRef.current = this._s._llmMessageService.sendLLMMessage({
          messagesType: 'chatMessages',
          featureName,
          logging: { loggingName: `Edit (Writeover) - ${from}` },
          messages,
          modelSelection,
          modelSelectionOptions,
          overridesOfModel,
          separateSystemMessage,
          chatMode: null, // не режим чата
          onText: (params: Parameters<OnText>[0]) => {
            const { fullText: fullText_ } = params;
            const newText_ = fullText_.substring(fullTextSoFar.length, Infinity);

            const newText = prevIgnoredSuffix + newText_; // вернуть ранее игнорируемый суффикс
            fullTextSoFar += newText; // полный ответ LLM

            const [croppedText, deltaCroppedText, croppedSuffix] = extractText(
              fullTextSoFar,
              newText.length,
            );
            const { endLineInLlmTextSoFar } = this._s._writeStreamedDiffZoneLLMText(
              uri,
              originalCode,
              croppedText,
              deltaCroppedText,
              latestStreamLocationMutable,
            );
            diffZone._streamState.line = diffZone.startLine - 1 + endLineInLlmTextSoFar; // перевод координат из originalCode в файл

            this._s._diffZones._refreshStylesAndDiffsInURI(uri);

            prevIgnoredSuffix = croppedSuffix;
          },
          onFinalMessage: (params: Parameters<OnFinalMessage>[0]) => {
            const { fullText } = params;
            // console.log('DONE! FULL TEXT\n', extractText(fullText), diffZone.startLine, diffZone.endLine)
            // Финальная перезапись диапазона — сброс рассинхрона стрима
            const [croppedText, _1, _2] = extractText(fullText, 0);
            this._s._writeURIText(
              uri,
              croppedText,
              {
                startLineNumber: diffZone.startLine,
                startColumn: 1,
                endLineNumber: diffZone.endLine,
                endColumn: Number.MAX_SAFE_INTEGER,
              }, // нумерация с 1
              { shouldRealignDiffAreas: true },
            );

            onDone();
            resMessageDonePromise();
          },
          onError: (e: Parameters<OnError>[0]) => {
            onError(e);
          },
          onAbort: () => {
            if (weAreAborting) {return;}
            // Выход из цикла без смены state (abort уже обработан)
            aborted = true;
            resMessageDonePromise();
          },
        });
        // Защита от null requestId
        if (streamRequestIdRef.current === null) {
          return;
        }

        await messageDonePromise;
        if (aborted) {
          throw new Error(`Edit was interrupted by the user.`);
        }
      } // конец while
    }; // конец writeover

    const applyDonePromise = new Promise<void>((res, rej) => {
      runWriteover().then(res).catch(rej);
    });
    return [diffZone, applyDonePromise];
  }

  _uriOfGivenURI(givenURI: URI | 'current') {
    if (givenURI === 'current') {
      const uri_ = this._s._getActiveEditorURI();
      if (!uri_) {return;}
      return uri_;
    }
    return givenURI;
  }

  _fileLengthOfGivenURI(givenURI: URI | 'current') {
    const uri = this._uriOfGivenURI(givenURI);
    if (!uri) {return null;}
    const { model } = this._s._sapphireModelService.getModel(uri);
    if (!model) {return null;}
    const numCharsInFile = model.getValueLength(EndOfLinePreference.LF);
    return numCharsInFile;
  }
}
