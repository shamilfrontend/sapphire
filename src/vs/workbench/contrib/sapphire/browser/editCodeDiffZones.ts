/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IViewZone } from '../../../../editor/browser/editorBrowser.js';
import { IModelDecorationOptions, ITextModel } from '../../../../editor/common/model.js';
import { RenderOptions } from '../../../../editor/browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter } from '../../../../base/common/event.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { findDiffs } from './helpers/findDiffs.js';
import {
  IConsistentEditorItemService,
  IConsistentItemService,
} from './helperServices/consistentItemService.js';
import { mountCtrlK } from './vue/out/quick-edit-tsx/index.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import {
  DiffArea,
  Diff,
  CtrlKZone,
  DiffZone,
  TrackingZone,
  ComputedDiff,
} from '../common/editCodeServiceTypes.js';
import { AcceptRejectInlineWidget } from './acceptRejectInlineWidget.js';
import { getLeadingWhitespacePx } from './editCodeText.js';
import { QuickEditPropsType } from './quickEditActions.js';

export interface EditCodeDiffZoneHost {
  diffAreasOfURI: Record<string, Set<string> | undefined>;
  diffAreaOfId: Record<string, DiffArea>;
  diffOfId: Record<string, Diff>;
  mostRecentTextOfCtrlKZoneId: Record<string, string | undefined>;
  _diffareaidPool: number;
  _diffidPool: number;
  _sapphireModelService: ISapphireModelService;
  _codeEditorService: ICodeEditorService;
  _consistentEditorItemService: IConsistentEditorItemService;
  _consistentItemService: IConsistentItemService;
  _instantiationService: IInstantiationService;
  _onDidAddOrDeleteDiffZones: Emitter<{ uri: URI }>;
  _onDidChangeDiffsInDiffZoneNotStreaming: Emitter<{ uri: URI; diffareaid: number }>;
  _getModelLineRange(model: ITextModel, startLine: number, endLine: number): string;
  _schedulePersistPendingDiffZones(): void;
  acceptDiff(opts: { diffid: number }): void;
  rejectDiff(opts: { diffid: number }): void;
}

/** Декорации, realign, удаление и refresh стилей DiffZone и Ctrl+K. */
export class EditCodeDiffZones {
  constructor(private readonly _s: EditCodeDiffZoneHost) {}

  // Подсветка диапазона строк
  _addLineDecoration = (
    model: ITextModel | null,
    startLine: number,
    endLine: number,
    className: string,
    options?: Partial<IModelDecorationOptions>,
  ) => {
    if (model === null) return;
    const id = model.changeDecorations((accessor) =>
      accessor.addDecoration(
        {
          startLineNumber: startLine,
          startColumn: 1,
          endLineNumber: endLine,
          endColumn: Number.MAX_SAFE_INTEGER,
        },
        {
          className,
          description: className,
          isWholeLine: true,
          ...options,
        },
      ),
    );
    const disposeHighlight = () => {
      if (id && !model.isDisposed())
        model.changeDecorations((accessor) => accessor.removeDecoration(id));
    };
    return disposeHighlight;
  };

  _addDiffAreaStylesToURI = (uri: URI) => {
    const { model } = this._s._sapphireModelService.getModel(uri);

    for (const diffareaid of this._s.diffAreasOfURI[uri.fsPath] || []) {
      const diffArea = this._s.diffAreaOfId[diffareaid];

      if (diffArea.type === 'DiffZone') {
        // «Sweep»-стили при стриминге
        if (diffArea._streamState.isStreaming) {
          // текущая строка стрима
          const fn1 = this._addLineDecoration(
            model,
            diffArea._streamState.line,
            diffArea._streamState.line,
            'sapphire-sweepIdxBG',
          );
          // хвост зоны до endLine
          const fn2 =
            diffArea._streamState.line + 1 <= diffArea.endLine
              ? this._addLineDecoration(
                  model,
                  diffArea._streamState.line + 1,
                  diffArea.endLine,
                  'sapphire-sweepBG',
                )
              : null;
          diffArea._removeStylesFns.add(() => {
            fn1?.();
            fn2?.();
          });
        }
      } else if (diffArea.type === 'CtrlKZone' && diffArea._linkedStreamingDiffZone === null) {
        // подсветка CtrlKZone
        const fn = this._addLineDecoration(
          model,
          diffArea.startLine,
          diffArea.endLine,
          'sapphire-highlightBG',
        );
        diffArea._removeStylesFns.add(() => fn?.());
      }
    }
  };

  _computeDiffsAndAddStylesToURI = (uri: URI) => {
    const { model } = this._s._sapphireModelService.getModel(uri);
    if (model === null) return;

    for (const diffareaid of this._s.diffAreasOfURI[uri.fsPath] || []) {
      const diffArea = this._s.diffAreaOfId[diffareaid];
      if (diffArea.type !== 'DiffZone') continue;

      const newDiffAreaCode = this._s._getModelLineRange(
        model,
        diffArea.startLine,
        diffArea.endLine,
      );
      const computedDiffs = findDiffs(diffArea.originalCode, newDiffAreaCode);
      for (let computedDiff of computedDiffs) {
        if (computedDiff.type === 'deletion') {
          computedDiff.startLine += diffArea.startLine - 1;
        }
        if (computedDiff.type === 'edit' || computedDiff.type === 'insertion') {
          computedDiff.startLine += diffArea.startLine - 1;
          computedDiff.endLine += diffArea.startLine - 1;
        }
        this._addDiff(computedDiff, diffArea);
      }
    }
  };

  _addCtrlKZoneInput = (ctrlKZone: CtrlKZone) => {
    const { editorId } = ctrlKZone;
    const editor = this._s._codeEditorService.listCodeEditors().find((e) => e.getId() === editorId);
    if (!editor) {
      return null;
    }

    let zoneId: string | null = null;
    let viewZone_: IViewZone | null = null;
    const textAreaRef: { current: HTMLTextAreaElement | null } = { current: null };

    const paddingLeft = getLeadingWhitespacePx(editor, ctrlKZone.startLine);

    const itemId = this._s._consistentEditorItemService.addToEditor(editor, () => {
      const domNode = document.createElement('div');
      domNode.style.zIndex = '1';
      domNode.style.height = 'auto';
      domNode.style.paddingLeft = `${paddingLeft}px`;
      const viewZone: IViewZone = {
        afterLineNumber: ctrlKZone.startLine - 1,
        domNode,
        // heightInPx: 80,
        suppressMouseDown: false,
        showInHiddenAreas: true,
      };
      viewZone_ = viewZone;

      // view zone Monaco для подсветки diff
      editor.changeViewZones((accessor) => {
        zoneId = accessor.addZone(viewZone);
      });

      // монтирование Quick Edit (React)
      let disposeFn: (() => void) | undefined;
      this._s._instantiationService.invokeFunction((accessor) => {
        disposeFn = mountCtrlK(domNode, accessor, {
          diffareaid: ctrlKZone.diffareaid,

          textAreaRef: (r) => {
            textAreaRef.current = r;
            if (!textAreaRef.current) return;

            if (!(ctrlKZone.diffareaid in this._s.mostRecentTextOfCtrlKZoneId)) {
              // Первый mount — автофокус (хак)
              this._s.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] = undefined;
              setTimeout(() => textAreaRef.current?.focus(), 100);
            }
          },
          onChangeHeight(height) {
            if (height === 0) return; // height=0 когда зона вне viewport — игнор
            viewZone.heightInPx = height;
            // layoutZone после смены высоты
            editor.changeViewZones((accessor) => {
              if (zoneId) accessor.layoutZone(zoneId);
            });
          },
          onChangeText: (text) => {
            this._s.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] = text;
          },
          initText: this._s.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] ?? null,
        } satisfies QuickEditPropsType)?.dispose;
      });

      // снятие view zone
      return () => {
        editor.changeViewZones((accessor) => {
          if (zoneId) accessor.removeZone(zoneId);
        });
        disposeFn?.();
      };
    });

    return {
      textAreaRef,
      refresh: () =>
        editor.changeViewZones((accessor) => {
          if (zoneId && viewZone_) {
            viewZone_.afterLineNumber = ctrlKZone.startLine - 1;
            accessor.layoutZone(zoneId);
          }
        }),
      dispose: () => {
        this._s._consistentEditorItemService.removeFromEditor(itemId);
      },
    } satisfies CtrlKZone['_mountInfo'];
  };

  _refreshCtrlKInputs = async (uri: URI) => {
    for (const diffareaid of this._s.diffAreasOfURI[uri.fsPath] || []) {
      const diffArea = this._s.diffAreaOfId[diffareaid];
      if (diffArea.type !== 'CtrlKZone') continue;
      if (!diffArea._mountInfo) {
        diffArea._mountInfo = this._addCtrlKZoneInput(diffArea);
        console.log('MOUNTED CTRLK', diffArea.diffareaid);
      } else {
        diffArea._mountInfo.refresh();
      }
    }
  };

  _addDiffStylesToURI = (uri: URI, diff: Diff) => {
    const { type, diffid } = diff;

    const disposeInThisEditorFns: (() => void)[] = [];

    const { model } = this._s._sapphireModelService.getModel(uri);

    // зелёная подсветка вставок
    if (type !== 'deletion') {
      const fn = this._addLineDecoration(model, diff.startLine, diff.endLine, 'sapphire-greenBG', {
        minimap: { color: { id: 'minimapGutter.addedBackground' }, position: 2 },
        overviewRuler: { color: { id: 'editorOverviewRuler.addedForeground' }, position: 7 },
      });
      disposeInThisEditorFns.push(() => {
        fn?.();
      });
    }

    // удалённый код — view zone с красным фоном
    if (type !== 'insertion') {
      const consistentZoneId = this._s._consistentItemService.addConsistentItemToURI({
        uri,
        fn: (editor) => {
          const domNode = document.createElement('div');
          domNode.className = 'sapphire-redBG';

          const renderOptions = RenderOptions.fromEditor(editor);

          const processedText = diff.originalCode.replace(/\t/g, ' '.repeat(renderOptions.tabSize));

          const lines = processedText.split('\n');

          const linesContainer = document.createElement('div');
          linesContainer.style.fontFamily = renderOptions.fontInfo.fontFamily;
          linesContainer.style.fontSize = `${renderOptions.fontInfo.fontSize}px`;
          linesContainer.style.lineHeight = `${renderOptions.fontInfo.lineHeight}px`;
          // linesContainer.style.tabSize = `${tabWidth}px` // \t
          linesContainer.style.whiteSpace = 'pre';
          linesContainer.style.position = 'relative';
          linesContainer.style.width = '100%';

          lines.forEach((line) => {
            // строка удалённого фрагмента
            const lineDiv = document.createElement('div');
            lineDiv.className = 'view-line';
            lineDiv.style.whiteSpace = 'pre';
            lineDiv.style.position = 'relative';
            lineDiv.style.height = `${renderOptions.fontInfo.lineHeight}px`;

            // span как во view-line VS Code
            const span = document.createElement('span');
            span.textContent = line || '\u00a0';
            span.style.whiteSpace = 'pre';
            span.style.display = 'inline-block';

            lineDiv.appendChild(span);
            linesContainer.appendChild(lineDiv);
          });

          domNode.appendChild(linesContainer);

          // heightInLines по числу строк
          const heightInLines = lines.length;
          const minWidthInPx = Math.max(
            ...lines.map((line) =>
              Math.ceil(renderOptions.fontInfo.typicalFullwidthCharacterWidth * line.length),
            ),
          );

          const viewZone: IViewZone = {
            afterLineNumber: diff.startLine - 1,
            heightInLines,
            minWidthInPx,
            domNode,
            marginDomNode: document.createElement('div'),
            suppressMouseDown: false,
            showInHiddenAreas: false,
          };

          let zoneId: string | null = null;
          editor.changeViewZones((accessor) => {
            zoneId = accessor.addZone(viewZone);
          });
          return () =>
            editor.changeViewZones((accessor) => {
              if (zoneId) accessor.removeZone(zoneId);
            });
        },
      });

      disposeInThisEditorFns.push(() => {
        this._s._consistentItemService.removeConsistentItemFromURI(consistentZoneId);
      });
    }

    const diffZone = this._s.diffAreaOfId[diff.diffareaid];
    if (diffZone.type === 'DiffZone' && !diffZone._streamState.isStreaming) {
      // виджет Принять/Отклонить
      const consistentWidgetId = this._s._consistentItemService.addConsistentItemToURI({
        uri,
        fn: (editor) => {
          let startLine: number;
          let offsetLines: number;
          if (diff.type === 'insertion' || diff.type === 'edit') {
            startLine = diff.startLine; // начало вставки/правки
            offsetLines = 0;
          } else if (diff.type === 'deletion') {
            // deletion: startLine на границе зоны
            if (diff.startLine === 1) {
              const numRedLines = diff.originalEndLine - diff.originalStartLine + 1;
              startLine = diff.startLine;
              offsetLines = -numRedLines;
            } else {
              startLine = diff.startLine - 1;
              offsetLines = 1;
            }
          } else {
            throw new Error('Sapphire 1');
          }

          const buttonsWidget = this._s._instantiationService.createInstance(
            AcceptRejectInlineWidget,
            {
              editor,
              onAccept: () => {
                this._s.acceptDiff({ diffid });
              },
              onReject: () => {
                this._s.rejectDiff({ diffid });
              },
              diffid: diffid.toString(),
              startLine,
              offsetLines,
            },
          );
          return () => {
            buttonsWidget.dispose();
          };
        },
      });
      disposeInThisEditorFns.push(() => {
        this._s._consistentItemService.removeConsistentItemFromURI(consistentWidgetId);
      });
    }

    const disposeInEditor = () => {
      disposeInThisEditorFns.forEach((f) => f());
    };
    return disposeInEditor;
  };

  // удалить из diffOfId и diffArea._diffOfId
  _deleteDiff(diff: Diff) {
    const diffArea = this._s.diffAreaOfId[diff.diffareaid];
    if (diffArea.type !== 'DiffZone') return;
    delete diffArea._diffOfId[diff.diffid];
    delete this._s.diffOfId[diff.diffid];
  }

  _deleteDiffs(diffZone: DiffZone) {
    for (const diffid in diffZone._diffOfId) {
      const diff = diffZone._diffOfId[diffid];
      this._deleteDiff(diff);
    }
  }

  _clearAllDiffAreaEffects(diffArea: DiffArea) {
    // очистить diff и стили DiffZone
    if (diffArea.type === 'DiffZone') this._deleteDiffs(diffArea);

    diffArea._removeStylesFns?.forEach((removeStyles) => removeStyles());
    diffArea._removeStylesFns?.clear();
  }

  // все diff и стили на uri
  _clearAllEffects(uri: URI) {
    for (let diffareaid of this._s.diffAreasOfURI[uri.fsPath] || []) {
      const diffArea = this._s.diffAreaOfId[diffareaid];
      this._clearAllDiffAreaEffects(diffArea);
    }
  }

  // удалить DiffZone из реестров
  _deleteDiffZone(diffZone: DiffZone) {
    this._clearAllDiffAreaEffects(diffZone);
    delete this._s.diffAreaOfId[diffZone.diffareaid];
    this._s.diffAreasOfURI[diffZone._URI.fsPath]?.delete(diffZone.diffareaid.toString());
    this._s._onDidAddOrDeleteDiffZones.fire({ uri: diffZone._URI });
  }

  _deleteTrackingZone(trackingZone: TrackingZone<unknown>) {
    delete this._s.diffAreaOfId[trackingZone.diffareaid];
    this._s.diffAreasOfURI[trackingZone._URI.fsPath]?.delete(trackingZone.diffareaid.toString());
  }

  _deleteCtrlKZone(ctrlKZone: CtrlKZone) {
    this._clearAllEffects(ctrlKZone._URI);
    ctrlKZone._mountInfo?.dispose();
    delete this._s.diffAreaOfId[ctrlKZone.diffareaid];
    this._s.diffAreasOfURI[ctrlKZone._URI.fsPath]?.delete(ctrlKZone.diffareaid.toString());
  }

  _deleteAllDiffAreas(uri: URI) {
    const diffAreas = this._s.diffAreasOfURI[uri.fsPath];
    diffAreas?.forEach((diffareaid) => {
      const diffArea = this._s.diffAreaOfId[diffareaid];
      if (diffArea.type === 'DiffZone') this._deleteDiffZone(diffArea);
      else if (diffArea.type === 'CtrlKZone') this._deleteCtrlKZone(diffArea);
    });
    this._s.diffAreasOfURI[uri.fsPath]?.clear();
  }

  _addOrInitializeDiffAreaAtURI = (uri: URI, diffareaid: string | number) => {
    if (!(uri.fsPath in this._s.diffAreasOfURI)) this._s.diffAreasOfURI[uri.fsPath] = new Set();
    this._s.diffAreasOfURI[uri.fsPath]?.add(diffareaid.toString());
  };

  _addDiffArea<T extends DiffArea>(diffArea: Omit<T, 'diffareaid'>): T {
    const diffareaid = this._s._diffareaidPool++;
    const diffArea2 = { ...diffArea, diffareaid } as T;
    this._addOrInitializeDiffAreaAtURI(diffArea._URI, diffareaid);
    this._s.diffAreaOfId[diffareaid] = diffArea2;
    return diffArea2;
  }

  _addDiff(computedDiff: ComputedDiff, diffZone: DiffZone): Diff {
    const uri = diffZone._URI;
    const diffid = this._s._diffidPool++;

    // материализовать Diff
    const newDiff: Diff = {
      ...computedDiff,
      diffid,
      diffareaid: diffZone.diffareaid,
    };

    const fn = this._addDiffStylesToURI(uri, newDiff);
    if (fn) diffZone._removeStylesFns.add(fn);

    this._s.diffOfId[diffid] = newDiff;
    diffZone._diffOfId[diffid] = newDiff;

    return newDiff;
  }

  /** Сдвигает startLine/endLine diff-областей после правки текста в модели. */
  _realignAllDiffAreasLines(
    uri: URI,
    text: string,
    recentChange: { startLineNumber: number; endLineNumber: number },
  ) {
    // console.log('recent change', recentChange)

    // Δ числа строк после изменения
    const startLine = recentChange.startLineNumber;
    const endLine = recentChange.endLineNumber;

    const newTextHeight = (text.match(/\n/g) || []).length + 1; // строк = \n + 1

    // пересечение правки с каждой diff-областью
    for (const diffareaid of this._s.diffAreasOfURI[uri.fsPath] || []) {
      const diffArea = this._s.diffAreaOfId[diffareaid];

      // область полностью выше — без изменений
      if (diffArea.endLine < startLine) {
        // console.log('CHANGE FULLY BELOW DA (doing nothing)')
        continue;
      }
      // область ниже — сдвиг на Δ строк
      else if (endLine < diffArea.startLine) {
        // console.log('CHANGE FULLY ABOVE DA')
        const changedRangeHeight = endLine - startLine + 1;
        const deltaNewlines = newTextHeight - changedRangeHeight;
        diffArea.startLine += deltaNewlines;
        diffArea.endLine += deltaNewlines;
      }
      // правка внутри области — расширить endLine
      else if (startLine >= diffArea.startLine && endLine <= diffArea.endLine) {
        // console.log('DA FULLY CONTAINS CHANGE')
        const changedRangeHeight = endLine - startLine + 1;
        const deltaNewlines = newTextHeight - changedRangeHeight;
        diffArea.endLine += deltaNewlines;
      }
      // правка поглощает область — выровнять границы
      else if (diffArea.startLine > startLine && diffArea.endLine < endLine) {
        // console.log('CHANGE FULLY CONTAINS DA')
        diffArea.startLine = startLine;
        diffArea.endLine = startLine + newTextHeight;
      }
      // правка задевает верх области
      else if (startLine < diffArea.startLine && diffArea.startLine <= endLine) {
        // console.log('CHANGE CONTAINS TOP OF DA ONLY')
        const numOverlappingLines = endLine - diffArea.startLine + 1;
        const numRemainingLinesInDA =
          diffArea.endLine - diffArea.startLine + 1 - numOverlappingLines;
        const newHeight = numRemainingLinesInDA - 1 + (newTextHeight - 1) + 1;
        diffArea.startLine = startLine;
        diffArea.endLine = startLine + newHeight;
      }
      // правка задевает низ области
      else if (startLine <= diffArea.endLine && diffArea.endLine < endLine) {
        // console.log('CHANGE CONTAINS BOTTOM OF DA ONLY')
        const numOverlappingLines = diffArea.endLine - startLine + 1;
        diffArea.endLine += newTextHeight - numOverlappingLines;
      }
    }
  }

  _fireChangeDiffsIfNotStreaming(uri: URI) {
    for (const diffareaid of this._s.diffAreasOfURI[uri.fsPath] || []) {
      const diffArea = this._s.diffAreaOfId[diffareaid];
      if (diffArea?.type !== 'DiffZone') continue;
      // единственное место добавления Diff — событие для UI
      if (!diffArea._streamState.isStreaming) {
        this._s._onDidChangeDiffsInDiffZoneNotStreaming.fire({
          uri,
          diffareaid: diffArea.diffareaid,
        });
      }
    }
  }

  _refreshStylesAndDiffsInURI(uri: URI) {
    // 1. сброс стилей и diff
    this._clearAllEffects(uri);

    // 2. стили областей
    this._addDiffAreaStylesToURI(uri);

    // 3. пересчёт diff
    this._computeDiffsAndAddStylesToURI(uri);

    // 4. Ctrl+K inputs
    this._refreshCtrlKInputs(uri);

    // 5. событие not-streaming
    this._fireChangeDiffsIfNotStreaming(uri);

    // 6. persist pending DiffZone
    this._s._schedulePersistPendingDiffZones();
  }
}
