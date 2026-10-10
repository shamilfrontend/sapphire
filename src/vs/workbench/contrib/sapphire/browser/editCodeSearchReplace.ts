/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { URI } from '../../../../base/common/uri.js';
import {
  searchReplaceGivenDescription_systemMessage,
  searchReplaceGivenDescription_userMessage,
  tripleTick,
  ORIGINAL,
  DIVIDER,
  FINAL,
} from '../common/prompt/prompts.js';
import {
  ExtractedSearchReplaceBlock,
  extractSearchReplaceBlocks,
} from '../common/helpers/extractCodeFromResult.js';
import { StartApplyingOpts } from './editCodeServiceInterface.js';
import { FeatureName } from '../common/sapphireSettingsTypes.js';
import { DiffZone, TrackingZone } from '../common/editCodeServiceTypes.js';
import { findTextInCode, StreamLocationMutable } from './editCodeText.js';
import { matchSearchReplaceBlocks } from '../common/searchReplaceMatch.js';
import { OnError, OnFinalMessage, OnText } from '../common/sendLLMMessageTypes.js';
import { EditCodeCollaboratorHost } from './editCodePendingZones.js';

export class EditCodeSearchReplace {
  constructor(private readonly _s: EditCodeCollaboratorHost) {}

  public instantlyApplySearchReplaceBlocks({
    uri,
    searchReplaceBlocks,
  }: {
    uri: URI;
    searchReplaceBlocks: string;
  }) {
    // Создать DiffZone
    const res = this._s._startStreamingDiffZone({
      uri,
      streamRequestIdRef: { current: null },
      startBehavior: 'keep-conflicts',
      linkedCtrlKZone: null,
      onWillUndo: () => {},
    });
    if (!res) return;
    const { diffZone, onFinishEdit } = res;

    const onDone = () => {
      diffZone._streamState = { isStreaming: false };
      this._s._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
      this._s._diffZones._refreshStylesAndDiffsInURI(uri);
      onFinishEdit();

      // Автопринятие diff при включённой настройке
      if (this._s._settingsService.state.globalSettings.autoAcceptLLMChanges) {
        this._s.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: false, behavior: 'accept' });
      }
    };

    // Промах ORIGINAL — ожидаемый отказ инструмента, не тост.
    // Полный текст (Closest lines) уходит в tool_error и модели.
    const onError = (e: { message: string; fullError: Error | null }) => {
      onDone();
      this._s._undoHistory(uri);
      throw e.fullError || new Error(e.message);
    };

    try {
      this._instantlyApplySRBlocks(uri, searchReplaceBlocks);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      onError({ message, fullError: null });
    }

    onDone();
  }

  /** Сообщение об ошибке для невалидного блока ORIGINAL (для LLM). */
  private _errContentOfInvalidStr = (
    str: 'Not found' | 'Not unique' | 'Has overlap',
    blockOrig: string,
  ): string => {
    const problematicCode = `${tripleTick[0]}\n${JSON.stringify(blockOrig)}\n${tripleTick[1]}`;

    // switch для exhaustiveness
    let descStr: string;
    switch (str) {
      case 'Not found':
        descStr = `The edit was not applied. The text in ORIGINAL must EXACTLY match lines of code in the file, but there was no match for:\n${problematicCode}. Ensure you have the latest version of the file, and ensure the ORIGINAL code matches a code excerpt exactly.`;
        break;
      case 'Not unique':
        descStr = `The edit was not applied. The text in ORIGINAL must be unique in the file being edited, but the following ORIGINAL code appears multiple times in the file:\n${problematicCode}. Ensure you have the latest version of the file, and ensure the ORIGINAL code is unique.`;
        break;
      case 'Has overlap':
        descStr = `The edit was not applied. The text in the ORIGINAL blocks must not overlap, but the following ORIGINAL code had overlap with another ORIGINAL string:\n${problematicCode}. Ensure you have the latest version of the file, and ensure the ORIGINAL code blocks do not overlap.`;
        break;
      default:
        descStr = '';
    }
    return descStr;
  };

  private _instantlyApplySRBlocks(uri: URI, blocksStr: string) {
    const blocks = extractSearchReplaceBlocks(blocksStr);
    const { model } = this._s._sapphireModelService.getModel(uri);
    if (!model) throw new Error(`Error applying Search/Replace blocks: File does not exist.`);
    const modelStr = model.getValue(EndOfLinePreference.LF);
    const matched = matchSearchReplaceBlocks(modelStr, blocks);
    if (!matched.ok) throw new Error(matched.message);

    const modelStrLines = modelStr.split('\n');
    const replacements = matched.replacements.map((block) => {
      const startLine = block.startLine - 1;
      const endLine = block.endLine - 1;
      // с переводом строки перед start
      const origStart = (startLine !== 0 ? `${modelStrLines.slice(0, startLine).join('\n')}\n` : '')
        .length;
      // включая конец последней строки
      const origEnd = modelStrLines.slice(0, endLine + 1).join('\n').length - 1;
      return { origStart, origEnd, final: block.final };
    });
    replacements.sort((a, b) => a.origStart - b.origStart);

    // Замены справа налево — индексы не сдвигаются
    let newCode: string = modelStr;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { origStart, origEnd, final } = replacements[i];
      newCode = newCode.slice(0, origStart) + final + newCode.slice(origEnd + 1, Infinity);
    }

    this._s._writeURIText(uri, newCode, 'wholeFileRange', { shouldRealignDiffAreas: true });
  }

  _initializeSearchAndReplaceStream(
    opts: StartApplyingOpts & { from: 'ClickApply' },
  ): [DiffZone, Promise<void>] | undefined {
    const { from, applyStr } = opts;
    const featureName: FeatureName = 'Apply';
    const overridesOfModel = this._s._settingsService.state.overridesOfModel;
    const modelSelection = this._s._settingsService.state.modelSelectionOfFeature[featureName];
    const modelSelectionOptions = modelSelection
      ? this._s._settingsService.state.optionsOfModelSelection[featureName][
          modelSelection.providerName
        ]?.[modelSelection.modelName]
      : undefined;

    const uri = this._s._getURIBeforeStartApplying(opts);
    if (!uri) return;

    const { model } = this._s._sapphireModelService.getModel(uri);
    if (!model) return;

    let streamRequestIdRef: { current: string | null } = { current: null }; // ref для streamRequestId DiffZone

    // Сбор сообщений LLM - ask LLM to generate search/replace block text
    const originalFileCode = model.getValue(EndOfLinePreference.LF);
    const userMessageContent = searchReplaceGivenDescription_userMessage({
      originalCode: originalFileCode,
      applyStr,
    });

    const { messages, separateSystemMessage } =
      this._s._convertToLLMMessageService.prepareLLMSimpleMessages({
        systemMessage: searchReplaceGivenDescription_systemMessage,
        simpleMessages: [{ role: 'user', content: userMessageContent }],
        featureName,
        modelSelection,
      });

    // uri уже стримится — выход (проверяет вызывающий)
    if (this._s._uriIsStreaming(uri)) return;

    // Создать DiffZone
    const res = this._s._startStreamingDiffZone({
      uri,
      streamRequestIdRef,
      startBehavior: opts.startBehavior,
      linkedCtrlKZone: null,
      onWillUndo: () => {
        if (streamRequestIdRef.current) {
          this._s._llmMessageService.abort(streamRequestIdRef.current); // вызывает onAbort()
        }
      },
    });
    if (!res) return;
    const { diffZone, onFinishEdit } = res;

    // колбэки завершения / ошибки стрима
    type SearchReplaceDiffAreaMetadata = {
      originalBounds: [number, number]; // нумерация с 1
      originalCode: string;
    };
    const convertOriginalRangeToFinalRange = (
      originalRange: readonly [number, number],
    ): [number, number] => {
      // Смещение строк с учётом уже применённых блоков
      const [originalStart, originalEnd] = originalRange;
      let lineOffset = 0;
      for (const blockDiffArea of addedTrackingZoneOfBlockNum) {
        const {
          startLine,
          endLine,
          metadata: {
            originalBounds: [originalStart2, originalEnd2],
          },
        } = blockDiffArea;
        if (originalStart2 >= originalEnd) continue;
        const numNewLines = endLine - startLine + 1;
        const numOldLines = originalEnd2 - originalStart2 + 1;
        lineOffset += numNewLines - numOldLines;
      }
      return [originalStart + lineOffset, originalEnd + lineOffset];
    };

    const onDone = () => {
      diffZone._streamState = { isStreaming: false };
      this._s._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
      this._s._diffZones._refreshStylesAndDiffsInURI(uri);

      // Удалить TrackingZone
      for (const trackingZone of addedTrackingZoneOfBlockNum)
        this._s._diffZones._deleteTrackingZone(trackingZone);

      onFinishEdit();

      // Автопринятие diff при включённой настройке
      if (this._s._settingsService.state.globalSettings.autoAcceptLLMChanges) {
        this._s.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: false, behavior: 'accept' });
      }
    };

    const onError = (e: { message: string; fullError: Error | null }) => {
      this._s._notifyError(e);
      onDone();
      this._s._undoHistory(uri);
      throw e.fullError || new Error(e.message);
    };

    // Refresh до первого onText
    this._s._diffZones._refreshStylesAndDiffsInURI(uri);

    // Стрим S/R: кеш готовых блоков для retry без полного отката
    let latestStreamLocationMutable: StreamLocationMutable | null = null;
    let shouldUpdateOrigStreamStyle = true;
    let oldBlocks: ExtractedSearchReplaceBlock[] = [];
    const addedTrackingZoneOfBlockNum: TrackingZone<SearchReplaceDiffAreaMetadata>[] = [];
    const completedSRBlocksCache: { orig: string; final: string }[] = [];
    diffZone._streamState.line = 1;

    const N_RETRIES = 4;

    // Может throw — внутри promise с catch
    const runSearchReplace = async () => {
      // Генерация ORIGINAL/DIVIDER/FINAL и потоковое применение
      let shouldSendAnotherMessage = true;
      let nMessagesSent = 0;
      let currStreamingBlockNum = completedSRBlocksCache.length;
      let aborted = false;
      let weAreAborting = false;
      while (shouldSendAnotherMessage) {
        shouldSendAnotherMessage = false;
        nMessagesSent += 1;
        if (nMessagesSent >= N_RETRIES) {
          const e = {
            message: `Tried to Fast Apply ${N_RETRIES} times but failed. This may be related to model intelligence, or it may an edit that's too complex. Please retry or disable Fast Apply.`,
            fullError: null,
          };
          onError(e);
          break;
        }

        let resMessageDonePromise: () => void = () => {};
        const messageDonePromise = new Promise<void>((res, _rej) => {
          resMessageDonePromise = res;
        });

        const onText = (params: { fullText: string; fullReasoning: string }) => {
          const { fullText } = params;
          // blocks: [done … | writingOriginal | writingFinal]
          //               ^
          //              currStreamingBlockNum

          let blocks = extractSearchReplaceBlocks(fullText);

          // Retry: дополнить кешем, чтобы индексы совпали
          if (
            completedSRBlocksCache.length > 0 &&
            currStreamingBlockNum === completedSRBlocksCache.length &&
            blocks.length > 0 &&
            blocks[0].orig !== completedSRBlocksCache[0].orig
          ) {
            blocks = [
              ...completedSRBlocksCache.map((b) => ({
                orig: b.orig,
                final: b.final,
                state: 'done' as const,
              })),
              ...blocks,
            ];
          }

          for (let blockNum = currStreamingBlockNum; blockNum < blocks.length; blockNum += 1) {
            const block = blocks[blockNum];

            if (block.state === 'writingOriginal') {
              // Подсветка: найти ORIGINAL в файле (≥20 символов)
              if (shouldUpdateOrigStreamStyle && block.orig.trim().length >= 20) {
                const startingAtLine = diffZone._streamState.line ?? 1; // не уменьшать line стрима
                const originalRange = findTextInCode(block.orig, originalFileCode, false, {
                  startingAtLine,
                  returnType: 'lines',
                });
                if (typeof originalRange !== 'string') {
                  const [startLine, _] = convertOriginalRangeToFinalRange(originalRange);
                  diffZone._streamState.line = startLine;
                  shouldUpdateOrigStreamStyle = false;
                }
              }

              // // starting line is at least the number of lines in the generated code minus 1
              // const numLinesInOrig = numLinesOfStr(block.orig)
              // const newLine = Math.max(numLinesInOrig - 1, 1, diffZone._streamState.line ?? 1)
              // if (newLine !== diffZone._streamState.line) {
              // 	diffZone._streamState.line = newLine
              // 	this._s._diffZones._refreshStylesAndDiffsInURI(uri)
              // }

              // Ждём завершения ORIGINAL перед FINAL
              continue;
            }
            shouldUpdateOrigStreamStyle = true;

            // Новый блок — TrackingZone для стрим-записи
            if (!(blockNum in addedTrackingZoneOfBlockNum)) {
              const originalBounds = findTextInCode(block.orig, originalFileCode, true, {
                returnType: 'lines',
              });
              // Пересечение с уже изменёнными диапазонами
              const hasOverlap =
                typeof originalBounds !== 'string' &&
                addedTrackingZoneOfBlockNum.some((trackingZone) => {
                  const [existingStart, existingEnd] = trackingZone.metadata.originalBounds;
                  const [candStart, candEnd] = originalBounds;
                  const hasNoOverlap = candEnd < existingStart || candStart > existingEnd;
                  return !hasNoOverlap;
                });

              if (typeof originalBounds === 'string' || hasOverlap) {
                const errorMessage =
                  typeof originalBounds === 'string' ? originalBounds : ('Has overlap' as const);

                console.log('--------------Error finding text in code:');
                console.log('originalFileCode', { originalFileCode });
                console.log('fullText', { fullText });
                console.log('error:', errorMessage);
                console.log('block.orig:', block.orig);
                console.log('---------');
                const content = this._errContentOfInvalidStr(errorMessage, block.orig);
                const resumeFrom = completedSRBlocksCache.length;
                const retryMsg =
                  resumeFrom > 0
                    ? `Previous SEARCH/REPLACE blocks 1–${resumeFrom} were applied successfully and must NOT be repeated. Re-output ONLY the remaining blocks starting from block ${resumeFrom + 1}, and avoid the error this time.`
                    : 'All of your previous outputs have been ignored. Please re-output ALL SEARCH/REPLACE blocks starting from the first one, and avoid the error this time.';
                messages.push(
                  { role: 'assistant', content: fullText }, // последний ответ модели
                  { role: 'user', content: `${content}\n${retryMsg}` }, // пояснение ошибки + retry
                );

                // Сохранить готовые блоки; сбросить незавершённые зоны
                latestStreamLocationMutable = null;
                shouldUpdateOrigStreamStyle = true;
                oldBlocks = [];
                for (let z = resumeFrom; z < addedTrackingZoneOfBlockNum.length; z++) {
                  this._s._diffZones._deleteTrackingZone(addedTrackingZoneOfBlockNum[z]);
                }
                addedTrackingZoneOfBlockNum.splice(resumeFrom, Infinity);
                currStreamingBlockNum = resumeFrom;

                // abort LLM и следующий retry
                shouldSendAnotherMessage = true;
                if (streamRequestIdRef.current) {
                  weAreAborting = true;
                  this._s._llmMessageService.abort(streamRequestIdRef.current);
                  weAreAborting = false;
                }
                resMessageDonePromise();
                this._s._diffZones._refreshStylesAndDiffsInURI(uri);
                return;
              }

              const [startLine, endLine] = convertOriginalRangeToFinalRange(originalBounds);

              // console.log('---------adding-------')
              // console.log('CURRENT TEXT!!!', { current: model?.getValue(EndOfLinePreference.LF) })
              // console.log('block', deepClone(block))
              // console.log('origBounds', originalBounds)
              // console.log('start end', startLine, endLine)

              // Без ошибки — TrackingZone
              const adding: Omit<TrackingZone<SearchReplaceDiffAreaMetadata>, 'diffareaid'> = {
                type: 'TrackingZone',
                startLine,
                endLine,
                _URI: uri,
                metadata: {
                  originalBounds: [...originalBounds],
                  originalCode: block.orig,
                },
              };
              const trackingZone = this._s._diffZones._addDiffArea(adding);
              addedTrackingZoneOfBlockNum.push(trackingZone);
              latestStreamLocationMutable = {
                line: startLine,
                addedSplitYet: false,
                col: 1,
                originalCodeStartLine: 1,
              };
            } // конец добавления зоны

            // Здесь DiffZone должна стримиться
            if (!diffZone._streamState.isStreaming) {
              console.error(
                'DiffZone was not in streaming state in _initializeSearchAndReplaceStream',
              );
              continue;
            }

            // Блок done — записать final целиком
            if (block.state === 'done') {
              const { startLine: finalStartLine, endLine: finalEndLine } =
                addedTrackingZoneOfBlockNum[blockNum];
              this._s._writeURIText(
                uri,
                block.final,
                {
                  startLineNumber: finalStartLine,
                  startColumn: 1,
                  endLineNumber: finalEndLine,
                  endColumn: Number.MAX_SAFE_INTEGER,
                }, // нумерация с 1
                { shouldRealignDiffAreas: true },
              );
              diffZone._streamState.line = finalEndLine + 1;
              currStreamingBlockNum = blockNum + 1;
              if (completedSRBlocksCache.length === blockNum) {
                completedSRBlocksCache.push({ orig: block.orig, final: block.final });
              }
              continue;
            }

            // Потоковая запись delta final
            if (!latestStreamLocationMutable) continue;
            const oldBlock = oldBlocks[blockNum];
            const oldFinalLen = (oldBlock?.final ?? '').length;
            const deltaFinalText = block.final.substring(oldFinalLen, Infinity);

            this._s._writeStreamedDiffZoneLLMText(
              uri,
              block.orig,
              block.final,
              deltaFinalText,
              latestStreamLocationMutable,
            );
            oldBlocks = blocks; // oldBlocks для delta при writingFinal

            // const { endLine: currentEndLine } = addedTrackingZoneOfBlockNum[blockNum] // would be bad to do this because a lot of the bottom lines might be the same. more accurate to go with latestStreamLocationMutable
            // diffZone._streamState.line = currentEndLine
            diffZone._streamState.line = latestStreamLocationMutable.line;
          } // end for

          this._s._diffZones._refreshStylesAndDiffsInURI(uri);
        };

        streamRequestIdRef.current = this._s._llmMessageService.sendLLMMessage({
          messagesType: 'chatMessages',
          featureName,
          logging: { loggingName: `Edit (Search/Replace) - ${from}` },
          messages,
          modelSelection,
          modelSelectionOptions,
          overridesOfModel,
          separateSystemMessage,
          chatMode: null, // не режим чата
          onText: (params: Parameters<OnText>[0]) => {
            onText(params);
          },
          onFinalMessage: async (params: Parameters<OnFinalMessage>[0]) => {
            const { fullText } = params;
            onText(params);

            const blocks = extractSearchReplaceBlocks(fullText);
            if (blocks.length === 0 && completedSRBlocksCache.length === 0) {
              this._s._notificationService.info(
                `Sapphire: We ran Fast Apply, but the LLM didn't output any changes.`,
              );
            }

            // Собрать полный текст S/R: кеш + новые блоки
            const cachedAsText = completedSRBlocksCache
              .map((b) => `${ORIGINAL}\n${b.orig}\n${DIVIDER}\n${b.final}\n${FINAL}`)
              .join('\n');
            // Re-emit с начала vs только хвост
            const mergedText =
              completedSRBlocksCache.length > 0 &&
              blocks.length > 0 &&
              blocks[0]?.orig !== completedSRBlocksCache[0]?.orig
                ? `${cachedAsText}\n${fullText}`
                : fullText || cachedAsText;

            this._s._writeURIText(uri, originalFileCode, 'wholeFileRange', {
              shouldRealignDiffAreas: true,
            });

            try {
              this._instantlyApplySRBlocks(uri, mergedText);
              onDone();
              resMessageDonePromise();
            } catch (e) {
              onError(e);
            }
          },
          onError: (e: Parameters<OnError>[0]) => {
            onError(e);
          },
          onAbort: () => {
            if (weAreAborting) return;
            // Выход из цикла без смены state (abort уже обработан)
            aborted = true;
            resMessageDonePromise();
          },
        });

        // Защита от null requestId
        if (streamRequestIdRef.current === null) {
          break;
        }

        await messageDonePromise;
        if (aborted) {
          throw new Error(`Edit was interrupted by the user.`);
        }
      } // конец while
    }; // конец retryLoop

    const applyDonePromise = new Promise<void>((res, rej) => {
      runSearchReplace().then(res).catch(rej);
    });
    return [diffZone, applyDonePromise];
  }
}
