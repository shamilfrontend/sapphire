/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ICodeEditor, IOverlayWidget } from '../../../../editor/browser/editorBrowser.js';
import { Widget } from '../../../../base/browser/ui/widget.js';
import * as dom from '../../../../base/browser/dom.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { ISapphireCommandBarService } from './sapphireCommandBarService.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { SAPPHIRE_ACCEPT_DIFF_ACTION_ID, SAPPHIRE_REJECT_DIFF_ACTION_ID } from './actionIDs.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import {
  acceptBg,
  acceptBorder,
  buttonFontSize,
  buttonTextColor,
  rejectBg,
  rejectBorder,
} from '../common/helpers/colors.js';

export class AcceptRejectInlineWidget extends Widget implements IOverlayWidget {
  public getId(): string {
    return this.ID || ''; // IOverlayWidget требует string
  }

  public getDomNode(): HTMLElement {
    return this._domNode;
  }

  public getPosition() {
    return null;
  }

  private readonly _domNode: HTMLElement; // definite assignment

  private readonly editor: ICodeEditor;

  private readonly ID: string;

  private readonly startLine: number;

  constructor(
    {
      editor,
      onAccept,
      onReject,
      diffid,
      startLine,
      offsetLines,
    }: {
      editor: ICodeEditor;
      onAccept: () => void;
      onReject: () => void;
      diffid: string;
      startLine: number;
      offsetLines: number;
    },
    @ISapphireCommandBarService private readonly _sapphireCommandBarService: ISapphireCommandBarService,
    @IKeybindingService private readonly _keybindingService: IKeybindingService,
    @IEditCodeService private readonly _editCodeService: IEditCodeService,
  ) {
    super();

    const uri = editor.getModel()?.uri;
    // значения по умолчанию до uri
    this.ID = '';
    this.editor = editor;
    this.startLine = startLine;

    if (!uri) {
      const { dummyDiv } = dom.h('div@dummyDiv');
      this._domNode = dummyDiv;
      return;
    }

    this.ID = uri.fsPath + diffid;

    const lineHeight = editor.getOption(EditorOption.lineHeight);

    const getAcceptRejectText = () => {
      const acceptKeybinding = this._keybindingService.lookupKeybinding(SAPPHIRE_ACCEPT_DIFF_ACTION_ID);
      const rejectKeybinding = this._keybindingService.lookupKeybinding(SAPPHIRE_REJECT_DIFF_ACTION_ID);

      // processRawKeybindingText через DI — не метод nested class
      const acceptKeybindLabel = this._editCodeService.processRawKeybindingText(
        (acceptKeybinding && acceptKeybinding.getLabel()) || '',
      );
      const rejectKeybindLabel = this._editCodeService.processRawKeybindingText(
        (rejectKeybinding && rejectKeybinding.getLabel()) || '',
      );

      const commandBarStateAtUri = this._sapphireCommandBarService.stateOfURI[uri.fsPath];
      const selectedDiffIdx = commandBarStateAtUri?.diffIdx ?? 0; // по умолчанию первый diff
      const thisDiffIdx = commandBarStateAtUri?.sortedDiffIds.indexOf(diffid) ?? null;

      const showLabel = thisDiffIdx === selectedDiffIdx;

      const acceptText = `Принять${showLabel ? ` ${acceptKeybindLabel}` : ''}`;
      const rejectText = `Отклонить${showLabel ? ` ${rejectKeybindLabel}` : ''}`;

      return { acceptText, rejectText };
    };

    const { acceptText, rejectText } = getAcceptRejectText();

    // контейнер кнопок
    const { acceptButton, rejectButton, buttons } = dom.h('div@buttons', [
      dom.h('button@acceptButton', []),
      dom.h('button@rejectButton', []),
    ]);

    // стили контейнера
    buttons.style.display = 'flex';
    buttons.style.position = 'absolute';
    buttons.style.gap = '4px';
    buttons.style.paddingRight = '4px';
    buttons.style.zIndex = '1';
    buttons.style.transform = `translateY(${offsetLines * lineHeight}px)`;
    buttons.style.justifyContent = 'flex-end';
    buttons.style.width = 'auto';
    buttons.style.pointerEvents = 'none';

    // стиль «Принять»
    acceptButton.onclick = onAccept;
    acceptButton.textContent = acceptText;
    acceptButton.style.backgroundColor = acceptBg;
    acceptButton.style.border = acceptBorder;
    acceptButton.style.color = buttonTextColor;
    acceptButton.style.fontSize = buttonFontSize;
    acceptButton.style.borderTop = 'none';
    acceptButton.style.padding = '1px 4px';
    acceptButton.style.borderBottomLeftRadius = '6px';
    acceptButton.style.borderBottomRightRadius = '6px';
    acceptButton.style.borderTopLeftRadius = '0';
    acceptButton.style.borderTopRightRadius = '0';
    acceptButton.style.cursor = 'pointer';
    acceptButton.style.height = '100%';
    acceptButton.style.boxShadow = '0 2px 3px rgba(0,0,0,0.2)';
    acceptButton.style.pointerEvents = 'auto';

    // стиль «Отклонить»
    rejectButton.onclick = onReject;
    rejectButton.textContent = rejectText;
    rejectButton.style.backgroundColor = rejectBg;
    rejectButton.style.border = rejectBorder;
    rejectButton.style.color = buttonTextColor;
    rejectButton.style.fontSize = buttonFontSize;
    rejectButton.style.borderTop = 'none';
    rejectButton.style.padding = '1px 4px';
    rejectButton.style.borderBottomLeftRadius = '6px';
    rejectButton.style.borderBottomRightRadius = '6px';
    rejectButton.style.borderTopLeftRadius = '0';
    rejectButton.style.borderTopRightRadius = '0';
    rejectButton.style.cursor = 'pointer';
    rejectButton.style.height = '100%';
    rejectButton.style.boxShadow = '0 2px 3px rgba(0,0,0,0.2)';
    rejectButton.style.pointerEvents = 'auto';

    this._domNode = buttons;

    const updateTop = () => {
      const topPx = editor.getTopForLineNumber(this.startLine) - editor.getScrollTop();
      this._domNode.style.top = `${topPx}px`;
    };
    // Привязка через right — offsetWidth отстаёт до rAF overlay
    const updateHorizontal = () => {
      const layoutInfo = editor.getLayoutInfo();
      const rightPx = layoutInfo.minimap.minimapWidth + layoutInfo.verticalScrollbarWidth;
      this._domNode.style.left = 'auto';
      this._domNode.style.right = `${rightPx}px`;
    };

    // mount, затем позиция
    setTimeout(() => {
      updateTop();
      updateHorizontal();
    }, 0);

    this._register(
      editor.onDidScrollChange((_e) => {
        updateTop();
      }),
    );
    this._register(
      editor.onDidChangeModelContent((_e) => {
        updateTop();
      }),
    );
    this._register(
      editor.onDidLayoutChange((_e) => {
        updateTop();
        updateHorizontal();
      }),
    );

    // подписка на command bar
    this._register(
      this._sapphireCommandBarService.onDidChangeState((e) => {
        if (uri && e.uri.fsPath === uri.fsPath) {
          const { acceptText, rejectText } = getAcceptRejectText();

          acceptButton.textContent = acceptText;
          rejectButton.textContent = rejectText;
        }
      }),
    );

    // overlay widget

    editor.addOverlayWidget(this);
    // console.log('created elt', this._domNode)
  }

  public override dispose(): void {
    this.editor.removeOverlayWidget(this);
    super.dispose();
  }
}
