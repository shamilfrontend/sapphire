/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { basename } from '../../../../base/common/path.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { InlineCompletion } from '../../../../editor/common/languages.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import { FeatureName } from '../common/sapphireSettingsTypes.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { LRUCache } from './autocomplete/lruCache.js';
import {
  _ln,
  Autocompletion,
  AutocompletionMatchupBounds,
  DEBOUNCE_TIME,
  TIMEOUT_TIME,
  MAX_CACHE_SIZE,
  MAX_PENDING_REQUESTS,
  HOVER_CONTEXT_TIMEOUT_MS,
  fimInsertTextFromFullText,
  shouldShowFimEarly,
  plaintextFromHover,
  rememberShownText,
  toInlineCompletions,
  getPrefixAndSuffixInfo,
  getAutocompletionMatchup,
  getCompletionOptions,
  removeAllWhitespace,
} from './autocomplete/fimPostprocess.js';

interface IAutocompleteService {
  readonly _serviceBrand: undefined;
}

const IAutocompleteService = createDecorator<IAutocompleteService>('AutocompleteService');

class AutocompleteService extends Disposable implements IAutocompleteService {
  static readonly ID = 'sapphire.autocompleteService';

  _serviceBrand: undefined;

  private _autocompletionId: number = 0;

  private _autocompletionsOfDocument: { [docUriStr: string]: LRUCache<number, Autocompletion> } =
    {};

  private _lastCompletionStart = 0;

  private _lastCompletionAccept = 0;
  // private _lastPrefix: string = ''

  // вызывается провайдером inline completions VS Code
  // после каждого keystroke — ghost completion
  async _provideInlineCompletionItems(
    model: ITextModel,
    position: Position,
    token: CancellationToken,
  ): Promise<InlineCompletion[]> {
    const isEnabled = this._settingsService.state.globalSettings.enableAutocomplete;
    if (!isEnabled) return [];

    const docUriStr = model.uri.fsPath;

    const prefixAndSuffix = getPrefixAndSuffixInfo(model, position);
    const { prefix, suffix } = prefixAndSuffix;

    // LRU на документ
    // accept удаляет запись из кеша
    if (!this._autocompletionsOfDocument[docUriStr]) {
      this._autocompletionsOfDocument[docUriStr] = new LRUCache<number, Autocompletion>(
        MAX_CACHE_SIZE,
        (autocompletion: Autocompletion) => {
          if (autocompletion.requestId) this._llmMessageService.abort(autocompletion.requestId);
        },
      );
    }
    // this._lastPrefix = prefix

    // вывести все ожидающие autocompletion'ы
    // let _numPending = 0
    // this._autocompletionsOfDocument[docUriStr].items.forEach((a: Autocompletion) => { if (a.status === 'pending') _numPending += 1 })
    // console.log('@numPending: ' + _numPending)

    // поиск совпадения prefix с кешем
    let cachedAutocompletion: Autocompletion | undefined;
    let autocompletionMatchup: AutocompletionMatchupBounds | undefined;
    for (const autocompletion of this._autocompletionsOfDocument[docUriStr].items.values()) {
      // prefix продолжает cached completion
      autocompletionMatchup = getAutocompletionMatchup({ prefix, autocompletion });
      if (autocompletionMatchup !== undefined) {
        cachedAutocompletion = autocompletion;
        break;
      }
    }

    // отдать из кеша
    if (cachedAutocompletion && autocompletionMatchup) {
      if (cachedAutocompletion.status === 'finished') {
        const inlineCompletions = toInlineCompletions({
          autocompletionMatchup,
          autocompletion: cachedAutocompletion,
          prefixAndSuffix,
          position,
          debug: true,
        });
        rememberShownText(cachedAutocompletion, inlineCompletions);
        return inlineCompletions;
      }
      if (cachedAutocompletion.status === 'pending') {
        try {
          await cachedAutocompletion.llmPromise;
          const inlineCompletions = toInlineCompletions({
            autocompletionMatchup,
            autocompletion: cachedAutocompletion,
            prefixAndSuffix,
            position,
          });
          rememberShownText(cachedAutocompletion, inlineCompletions);
          return inlineCompletions;
        } catch (e) {
          this._autocompletionsOfDocument[docUriStr].delete(cachedAutocompletion.id);
          console.error(`Error creating autocompletion (1): ${e}`);
        }
      }

      return [];
    }

    // иначе — новый запрос после debounce

    // debounce ввода
    const thisTime = Date.now();

    const justAcceptedAutocompletion = thisTime - this._lastCompletionAccept < 500;

    this._lastCompletionStart = thisTime;
    const didTypingHappenDuringDebounce = await new Promise((resolve, _reject) =>
      setTimeout(() => {
        if (this._lastCompletionStart === thisTime) {
          resolve(false);
        } else {
          resolve(true);
        }
      }, DEBOUNCE_TIME),
    );

    // debounce сброшен — не запрашивать LLM
    if (didTypingHappenDuringDebounce || token.isCancellationRequested) {
      return [];
    }

    // лимит pending — abort старейшего
    let numPending = 0;
    let oldestPending: Autocompletion | undefined;
    for (const autocompletion of this._autocompletionsOfDocument[docUriStr].items.values()) {
      if (autocompletion.status === 'pending') {
        numPending += 1;
        if (oldestPending === undefined) {
          oldestPending = autocompletion;
        }
        if (numPending >= MAX_PENDING_REQUESTS) {
          // удалить из LRU
          this._autocompletionsOfDocument[docUriStr].delete(oldestPending.id);
          break;
        }
      }
    }

    const relevantContext =
      (await raceTimeout(
        this._getHoverTypeLine(model, position, token),
        HOVER_CONTEXT_TIMEOUT_MS,
      )) ?? '';
    if (token.isCancellationRequested) {
      return [];
    }
    const fileLabel = `${basename(model.uri.fsPath)} (${model.getLanguageId()})`;

    const { shouldGenerate, predictionType, llmPrefix, llmSuffix, stopTokens } =
      getCompletionOptions(prefixAndSuffix, relevantContext, justAcceptedAutocompletion, fileLabel);

    if (!shouldGenerate) return [];

    // новый Autocompletion
    const newAutocompletion: Autocompletion = {
      id: this._autocompletionId++,
      prefix, // реальный prefix/suffix в файле
      suffix,
      llmPrefix, // prefix/suffix для FIM-промпта
      llmSuffix,
      startTime: Date.now(),
      endTime: undefined,
      type: predictionType,
      status: 'pending',
      llmPromise: undefined,
      insertText: '',
      requestId: null,
      _newlineCount: 0,
    };

    const featureName: FeatureName = 'Autocomplete';
    const overridesOfModel = this._settingsService.state.overridesOfModel;
    const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName];
    const modelSelectionOptions = modelSelection
      ? this._settingsService.state.optionsOfModelSelection[featureName][
          modelSelection.providerName
        ]?.[modelSelection.modelName]
      : undefined;

    // llmPromise и requestId
    newAutocompletion.llmPromise = new Promise((resolve, reject) => {
      let settled = false;
      const settleResolve = (text: string) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(text);
      };
      const settleReject = (reason: string) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(reason);
      };

      const requestId = this._llmMessageService.sendLLMMessage({
        messagesType: 'FIMMessage',
        featureName,
        messages: this._convertToLLMMessageService.prepareFIMMessage({
          messages: {
            prefix: llmPrefix,
            suffix: llmSuffix,
            stopTokens,
          },
        }),
        modelSelection,
        modelSelectionOptions,
        overridesOfModel,
        logging: { loggingName: 'Autocomplete' },
        onText: ({ fullText }) => {
          const insertText = fimInsertTextFromFullText(fullText, newAutocompletion.type);
          newAutocompletion.insertText = insertText;
          if (shouldShowFimEarly(insertText)) {
            settleResolve(insertText);
          }
        },
        onFinalMessage: ({ fullText }) => {
          newAutocompletion.endTime = Date.now();
          newAutocompletion.status = 'finished';
          const insertText = fimInsertTextFromFullText(fullText, newAutocompletion.type);
          newAutocompletion.insertText = insertText;
          settleResolve(insertText);
        },
        onError: ({ message }) => {
          newAutocompletion.endTime = Date.now();
          newAutocompletion.status = 'error';
          settleReject(message);
        },
        onAbort: () => {
          settleReject('Aborted autocomplete');
        },
      });
      newAutocompletion.requestId = requestId;

      // таймаут pending
      setTimeout(() => {
        if (newAutocompletion.status === 'pending') {
          if (newAutocompletion.requestId) {
            this._llmMessageService.abort(newAutocompletion.requestId);
          }
          settleReject('Timeout receiving message to LLM.');
        }
      }, TIMEOUT_TIME);
    });

    // в LRU
    this._autocompletionsOfDocument[docUriStr].set(newAutocompletion.id, newAutocompletion);

    const cancelListener = token.onCancellationRequested(() => {
      if (newAutocompletion.requestId) {
        this._llmMessageService.abort(newAutocompletion.requestId);
      }
    });

    // await и inline items
    try {
      if (token.isCancellationRequested) {
        if (newAutocompletion.requestId) {
          this._llmMessageService.abort(newAutocompletion.requestId);
        }
        this._autocompletionsOfDocument[docUriStr].delete(newAutocompletion.id);
        return [];
      }
      await newAutocompletion.llmPromise;
      // console.log('id: ' + newAutocompletion.id)

      const autocompletionMatchup: AutocompletionMatchupBounds = {
        startIdx: 0,
        startLine: 0,
        startCharacter: 0,
      };
      const inlineCompletions = toInlineCompletions({
        autocompletionMatchup,
        autocompletion: newAutocompletion,
        prefixAndSuffix,
        position,
      });
      rememberShownText(newAutocompletion, inlineCompletions);
      return inlineCompletions;
    } catch (e) {
      this._autocompletionsOfDocument[docUriStr].delete(newAutocompletion.id);
      console.error(`Error creating autocompletion (2): ${e}`);
      return [];
    } finally {
      cancelListener.dispose();
    }
  }

  private async _getHoverTypeLine(
    model: ITextModel,
    position: Position,
    token: CancellationToken,
  ): Promise<string> {
    const providers = this._langFeatureService.hoverProvider.ordered(model);
    for (const provider of providers) {
      if (token.isCancellationRequested) {
        return '';
      }
      try {
        const hover = await provider.provideHover(model, position, token);
        const line = plaintextFromHover(hover);
        if (line) {
          return line;
        }
      } catch {
        // hover — best-effort (ошибки игнорируем)
      }
    }
    return '';
  }

  constructor(
    @ILanguageFeaturesService private _langFeatureService: ILanguageFeaturesService,
    @ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
    @IEditorService private readonly _editorService: IEditorService,
    @IModelService private readonly _modelService: IModelService,
    @ISapphireSettingsService private readonly _settingsService: ISapphireSettingsService,
    @IConvertToLLMMessageService
    private readonly _convertToLLMMessageService: IConvertToLLMMessageService,
  ) {
    super();

    this._register(
      this._langFeatureService.inlineCompletionsProvider.register('*', {
        provideInlineCompletions: async (model, position, _context, token) => {
          const items = await this._provideInlineCompletionItems(model, position, token);

          // console.log('item: ', items?.[0]?.insertText)
          return { items };
        },
        freeInlineCompletions: (_completions) => {
          // uri и позиция для freeInlineCompletions
          const activePane = this._editorService.activeEditorPane;
          if (!activePane) return;
          const control = activePane.getControl();
          if (!control || !isCodeEditor(control)) return;
          const position = control.getPosition();
          if (!position) return;
          const resource = EditorResourceAccessor.getCanonicalUri(this._editorService.activeEditor);
          if (!resource) return;
          const model = this._modelService.getModel(resource);
          if (!model) return;
          const docUriStr = resource.fsPath;
          if (!this._autocompletionsOfDocument[docUriStr]) return;

          const { prefix } = getPrefixAndSuffixInfo(model, position);

          // Tab accept — follow-up из остатка insertText
          this._autocompletionsOfDocument[docUriStr].items.forEach(
            (autocompletion: Autocompletion) => {
              const acceptedText = autocompletion.shownText ?? autocompletion.insertText;
              const matchup =
                removeAllWhitespace(prefix) ===
                removeAllWhitespace(autocompletion.prefix + acceptedText);

              if (matchup) {
                this._lastCompletionAccept = Date.now();
                this._autocompletionsOfDocument[docUriStr].delete(autocompletion.id);

                // предзагрузка следующего абзаца
                const full = autocompletion.insertText;
                const acceptedRaw = acceptedText;
                let remaining = '';
                if (full.startsWith(acceptedRaw)) {
                  remaining = full.slice(acceptedRaw.length);
                } else {
                  // shownText ≠ insertText — эвристика по абзацам
                  const fullNoWs = removeAllWhitespace(full);
                  const accNoWs = removeAllWhitespace(acceptedRaw);
                  if (fullNoWs.startsWith(accNoWs)) {
                    // грубо: пропустить первый абзац
                    const parts = full.split(new RegExp(`${_ln}${_ln}+`));
                    remaining = parts.slice(1).join(`${_ln}${_ln}`);
                  }
                }
                remaining = remaining.replace(new RegExp(`^${_ln}+`), '');
                const nextChunk = remaining.split(new RegExp(`${_ln}${_ln}+`))[0]?.trimEnd();
                if (nextChunk && nextChunk.trim()) {
                  const followup: Autocompletion = {
                    ...autocompletion,
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    prefix: prefix,
                    insertText: _ln + nextChunk,
                    shownText: undefined,
                    status: 'finished',
                    type: 'multi-line-start-on-next-line',
                    llmPromise: undefined,
                    startTime: Date.now(),
                    endTime: Date.now(),
                    requestId: null,
                    _newlineCount: (nextChunk.match(new RegExp(_ln, 'g')) || []).length,
                  };
                  this._autocompletionsOfDocument[docUriStr].set(followup.id, followup);
                }
              }
            },
          );
        },
      }),
    );
  }
}

registerWorkbenchContribution2(
  AutocompleteService.ID,
  AutocompleteService,
  WorkbenchPhase.BlockRestore,
);
