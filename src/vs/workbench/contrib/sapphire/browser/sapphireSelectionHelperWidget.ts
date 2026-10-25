/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import {
  ICodeEditor,
  IOverlayWidget,
  IOverlayWidgetPosition,
} from '../../../../editor/browser/editorBrowser.js';
import {
  EditorContributionInstantiation,
  registerEditorContribution,
} from '../../../../editor/browser/editorExtensions.js';
import { ICursorSelectionChangedEvent } from '../../../../editor/common/cursorEvents.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import * as dom from '../../../../base/browser/dom.js';
import { mountSapphireSelectionHelper } from './vue/out/void-editor-widgets-tsx/index.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { getLengthOfTextPx } from './editCodeService.js';

const minDistanceFromRightPx = 400;
const minLeftPx = 60;

export type SapphireSelectionHelperProps = {
  rerenderKey: number; // 0/1 для принудительного rerender
};

class SelectionHelperContribution
  extends Disposable
  implements IEditorContribution, IOverlayWidget
{
  public static readonly ID = 'editor.contrib.sapphireSelectionHelper';

  // React
  private _rootHTML: HTMLElement;

  private _rerender: (props?: Record<string, unknown>) => void = () => {};

  private _rerenderKey: number = 0;

  private _reactComponentDisposable: IDisposable | null = null;

  // внутреннее состояние
  private _isVisible = false;

  private _showScheduler: RunOnceScheduler;

  private _lastSelection: Selection | null = null;

  constructor(
    private readonly _editor: ICodeEditor,
    @IInstantiationService private readonly _instantiationService: IInstantiationService,
    @ISapphireSettingsService private readonly _sapphireSettingsService: ISapphireSettingsService,
  ) {
    super();

    // контейнер React
    const { root, content } = dom.h('div@root', [dom.h('div@content', [])]);

    // стили контейнера
    root.style.position = 'absolute';
    root.style.display = 'none'; // скрыт до выделения
    root.style.pointerEvents = 'none';
    root.style.marginLeft = '16px';

    // mount SelectionHelper
    this._instantiationService.invokeFunction((accessor) => {
      if (this._reactComponentDisposable) {
        this._reactComponentDisposable.dispose();
      }
      const res = mountSapphireSelectionHelper(content, accessor);
      if (!res) {return;}

      this._reactComponentDisposable = res;
      this._rerender = res.rerender;

      this._register(this._reactComponentDisposable);
    });

    this._rootHTML = root;

    // IOverlayWidget
    this._editor.addOverlayWidget(this);

    // debounce показа
    this._showScheduler = new RunOnceScheduler(() => {
      if (this._lastSelection) {
        this._showHelperForSelection(this._lastSelection);
      }
    }, 50);

    // события редактора
    this._register(this._editor.onDidChangeCursorSelection((e) => this._onSelectionChange(e)));

    // курсор над виджетом
    let isMouseOverWidget = false;
    this._rootHTML.addEventListener('mouseenter', () => {
      isMouseOverWidget = true;
    });
    this._rootHTML.addEventListener('mouseleave', () => {
      isMouseOverWidget = false;
    });

    // скрыть при blur, если мышь не на виджете
    this._register(
      this._editor.onDidBlurEditorText(() => {
        if (!isMouseOverWidget) {
          this._hideHelper();
        }
      }),
    );

    this._register(this._editor.onDidScrollChange(() => this._updatePositionIfVisible()));
    this._register(this._editor.onDidLayoutChange(() => this._updatePositionIfVisible()));
  }

  // IOverlayWidget
  public getId(): string {
    return SelectionHelperContribution.ID;
  }

  public getDomNode(): HTMLElement {
    return this._rootHTML;
  }

  public getPosition(): IOverlayWidgetPosition | null {
    return null; // позиция задаётся вручную
  }

  private _onSelectionChange(_e: ICursorSelectionChangedEvent): void {
    if (!this._editor.hasModel()) {
      return;
    }

    if (this._editor.getModel().uri.scheme !== 'file') {
      return;
    }

    const selection = this._editor.getSelection();

    if (!selection || selection.isEmpty()) {
      this._hideHelper();
      return;
    }

    // не показывать для пустого выделения
    const text = this._editor.getModel()!.getValueInRange(selection);
    if (text.length < 3) {
      this._hideHelper();
      return;
    }

    // сохранить selection
    this._lastSelection = new Selection(
      selection.startLineNumber,
      selection.startColumn,
      selection.endLineNumber,
      selection.endColumn,
    );

    this._showScheduler.schedule();
  }

  // позиционирование для React
  private _showHelperForSelection(selection: Selection): void {
    if (!this._editor.hasModel()) {
      return;
    }

    const model = this._editor.getModel()!;

    // ширина соседних строк для offset
    const { tabSize: numSpacesInTab } = model.getFormattingOptions();
    const spaceWidth = this._editor.getOption(EditorOption.fontInfo).spaceWidth;
    const tabWidth = numSpacesInTab * spaceWidth;
    const numLinesModel = model.getLineCount();

    // правая граница видимой области
    const editorWidthPx = this._editor.getLayoutInfo().width;
    const maxLeftPx = editorWidthPx - minDistanceFromRightPx;

    // строка для overlay
    const getBoxPosition = (targetLine: number): { top: number; left: number } => {
      const targetPosition = this._editor.getScrolledVisiblePosition({
        lineNumber: targetLine,
        column: 1,
      }) ?? { left: 0, top: 0 };

      const { top: targetTop, left: targetLeft } = targetPosition;

      let targetWidth = 0;
      for (let i = targetLine; i <= targetLine + 1; i++) {
        // вне viewport — skip
        if (!(i >= 1) || !(i <= numLinesModel)) {continue;}

        const content = model.getLineContent(i);
        const currWidth = getLengthOfTextPx({
          tabWidth,
          spaceWidth,
          content,
        });

        targetWidth = Math.max(targetWidth, currWidth);
      }

      return {
        top: targetTop,
        left: targetLeft + targetWidth,
      };
    };

    // середина выделения
    const startLine = selection.startLineNumber;
    const endLine = selection.endLineNumber;
    // const middleLine = Math.floor(startLine + (endLine - startLine) / 2);
    const targetLine = endLine - startLine + 1 <= 2 ? startLine : startLine + 2;

    let boxPos = getBoxPosition(targetLine);

    // если у правого края — искать строку левее
    const lineDeltasToTry = [-1, -2, -3, 1, 2, 3];

    if (boxPos.left > maxLeftPx) {
      for (const lineDelta of lineDeltasToTry) {
        boxPos = getBoxPosition(targetLine + lineDelta);
        if (boxPos.left <= maxLeftPx) {
          break;
        }
      }
    }
    if (boxPos.left > maxLeftPx) {
      // fallback: 2 строки выше
      boxPos = getBoxPosition(targetLine - 2);
    }

    // позиция в конце строки
    const xPosition = Math.max(Math.min(boxPos.left, maxLeftPx), minLeftPx);
    const yPosition = boxPos.top;

    // props React
    this._rootHTML.style.left = `${xPosition}px`;
    this._rootHTML.style.top = `${yPosition}px`;
    this._rootHTML.style.display = 'flex'; // показать контейнер

    this._isVisible = true;

    // refresh
    const enabled =
      this._sapphireSettingsService.state.globalSettings.showInlineSuggestions &&
      // VS Code считает selection без фокуса — не rerender без фокуса редактора
      this._editor.hasTextFocus();

    if (enabled) {
      this._rerender({ rerenderKey: this._rerenderKey } satisfies SapphireSelectionHelperProps);
      this._rerenderKey = (this._rerenderKey + 1) % 2;
      // this._reactComponentRerender();
    }
  }

  private _hideHelper(): void {
    this._rootHTML.style.display = 'none';
    this._isVisible = false;
    this._lastSelection = null;
  }

  private _updatePositionIfVisible(): void {
    if (!this._isVisible || !this._lastSelection || !this._editor.hasModel()) {
      return;
    }

    this._showHelperForSelection(this._lastSelection);
  }

  override dispose(): void {
    this._hideHelper();
    if (this._reactComponentDisposable) {
      this._reactComponentDisposable.dispose();
    }
    this._editor.removeOverlayWidget(this);
    this._showScheduler.dispose();
    super.dispose();
  }
}

// регистрация contribution
registerEditorContribution(
  SelectionHelperContribution.ID,
  SelectionHelperContribution,
  EditorContributionInstantiation.Eager,
);
