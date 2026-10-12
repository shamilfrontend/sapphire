/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';

import {
  KeybindingWeight,
  KeybindingsRegistry,
} from '../../../../platform/keybinding/common/keybindingsRegistry.js';

import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { SAPPHIRE_VIEW_CONTAINER_ID, SAPPHIRE_VIEW_ID } from './sidebarPane.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import {
  SAPPHIRE_CMD_SHIFT_L_ACTION_ID,
  SAPPHIRE_CTRL_L_ACTION_ID,
  SAPPHIRE_OPEN_SIDEBAR_ACTION_ID,
} from './actionIDs.js';
import { localize2 } from '../../../../nls.js';
import { IChatThreadService } from './chatThreadService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';

// ---------- Команды и сочетания клавиш ----------

export const roundRangeToLines = (
  range: IRange | null | undefined,
  options: { emptySelectionBehavior: 'null' | 'line' },
) => {
  if (!range) return null;

  // Пустое выделение — по опции null или вся строка
  if (range.endColumn === range.startColumn && range.endLineNumber === range.startLineNumber) {
    if (options.emptySelectionBehavior === 'null') return null;
    if (options.emptySelectionBehavior === 'line')
      return {
        startLineNumber: range.startLineNumber,
        startColumn: 1,
        endLineNumber: range.startLineNumber,
        endColumn: 1,
      };
  }

  // IRange с 1; при triple-click колонка 1 на следующей строке — берём предыдущую строку
  const endLine = range.endColumn === 1 ? range.endLineNumber - 1 : range.endLineNumber;
  const newRange: IRange = {
    startLineNumber: range.startLineNumber,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: Number.MAX_SAFE_INTEGER,
  };
  return newRange;
};

registerAction2(
  class extends Action2 {
    constructor() {
      super({
        id: SAPPHIRE_OPEN_SIDEBAR_ACTION_ID,
        title: localize2('sapphireOpenSidebar', 'Sapphire: Открыть ассистента'),
        f1: true,
      });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
      const viewsService = accessor.get(IViewsService);
      const chatThreadsService = accessor.get(IChatThreadService);
      viewsService.openViewContainer(SAPPHIRE_VIEW_CONTAINER_ID);
      await chatThreadsService.focusCurrentChat();
    }
  },
);

// Ctrl/Cmd+L
registerAction2(
  class extends Action2 {
    constructor() {
      super({
        id: SAPPHIRE_CTRL_L_ACTION_ID,
        f1: true,
        title: localize2('sapphireCmdL', 'Sapphire: Добавить выделение в чат'),
        keybinding: {
          primary: KeyMod.CtrlCmd | KeyCode.KeyL,
          weight: KeybindingWeight.SapphireExtension,
        },
      });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
      const commandService = accessor.get(ICommandService);
      const viewsService = accessor.get(IViewsService);
      const editorService = accessor.get(ICodeEditorService);
      const chatThreadService = accessor.get(IChatThreadService);

      // Зафиксировать выделение до открытия панели чата
      const editor = editorService.getActiveCodeEditor();
      const model = editor?.getModel();
      if (!model) return;

      const selectionRange = roundRangeToLines(editor?.getSelection(), {
        emptySelectionBehavior: 'null',
      });

      const wasAlreadyOpen = viewsService.isViewContainerVisible(SAPPHIRE_VIEW_CONTAINER_ID);
      if (!wasAlreadyOpen) {
        await commandService.executeCommand(SAPPHIRE_OPEN_SIDEBAR_ACTION_ID);
      }

      if (selectionRange) {
        editor?.setSelection({
          startLineNumber: selectionRange.startLineNumber,
          endLineNumber: selectionRange.endLineNumber,
          startColumn: 1,
          endColumn: Number.MAX_SAFE_INTEGER,
        });
        chatThreadService.addNewStagingSelection({
          type: 'CodeSelection',
          uri: model.uri,
          language: model.getLanguageId(),
          range: [selectionRange.startLineNumber, selectionRange.endLineNumber],
        });
      }
      else {
        chatThreadService.addNewStagingSelection({
          type: 'File',
          uri: model.uri,
          language: model.getLanguageId(),
        });
      }

      await chatThreadService.focusCurrentChat();
    }
  },
);

// Новый чат: сочетание клавиш («+» на вкладках — в React)
registerAction2(
  class extends Action2 {
    constructor() {
      super({
        id: SAPPHIRE_CMD_SHIFT_L_ACTION_ID,
        title: 'Новый чат',
        keybinding: {
          primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL,
          weight: KeybindingWeight.SapphireExtension,
        },
        icon: { id: 'add' },
      });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
      const chatThreadsService = accessor.get(IChatThreadService);
      const editorService = accessor.get(ICodeEditorService);
      const commandService = accessor.get(ICommandService);
      const viewsService = accessor.get(IViewsService);

      if (!viewsService.isViewContainerVisible(SAPPHIRE_VIEW_CONTAINER_ID)) {
        await commandService.executeCommand(SAPPHIRE_OPEN_SIDEBAR_ACTION_ID);
      }

      // Перенести черновик и selections в новый тред
      const oldThreadId = chatThreadsService.state.currentThreadId;
      const oldThread = chatThreadsService.state.allThreads[oldThreadId];

      const oldUI = await oldThread?.state.mountedInfo?.whenMounted;

      const oldSelns = oldThread?.state.stagingSelections;
      const oldDraftText =
        oldThread?.state.draftText ?? oldUI?.textAreaRef?.current?.value ?? '';
      const oldStagingImages = oldThread?.state.stagingImages ?? [];

      chatThreadsService.openNewThread();
      const newThreadId = chatThreadsService.state.currentThreadId;
      // До React restore-effect: иначе новый тред подхватит пустой draft
      chatThreadsService.setComposerDraft(newThreadId, {
        draftText: oldDraftText,
        stagingImages: oldStagingImages,
      });
      chatThreadsService.setCurrentThreadState({ stagingSelections: oldSelns ?? [] });
      if (oldThreadId) {
        chatThreadsService.setComposerDraft(oldThreadId, {
          draftText: '',
          stagingImages: [],
        });
      }

      await chatThreadsService.focusCurrentChat();

      const newThread = chatThreadsService.state.allThreads[newThreadId];
      const newUI = await newThread?.state.mountedInfo?.whenMounted;
      if (newUI?.textAreaRef?.current && oldDraftText) {
        newUI.textAreaRef.current.value = oldDraftText;
      }

      // Добавить текущее выделение в новый тред
      const editor = editorService.getActiveCodeEditor();
      const model = editor?.getModel();
      if (!model) return;
      const selectionRange = roundRangeToLines(editor?.getSelection(), {
        emptySelectionBehavior: 'null',
      });
      if (!selectionRange) return;
      editor?.setSelection({
        startLineNumber: selectionRange.startLineNumber,
        endLineNumber: selectionRange.endLineNumber,
        startColumn: 1,
        endColumn: Number.MAX_SAFE_INTEGER,
      });
      chatThreadsService.addNewStagingSelection({
        type: 'CodeSelection',
        uri: model.uri,
        language: model.getLanguageId(),
        range: [selectionRange.startLineNumber, selectionRange.endLineNumber],
      });
    }
  },
);

// История чатов: команда для React и обратной совместимости
registerAction2(
  class extends Action2 {
    constructor() {
      super({
        id: 'sapphire.historyAction',
        title: 'История чатов',
        icon: { id: 'history' },
      });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
      const chatThreadService = accessor.get(IChatThreadService);
      const viewsService = accessor.get(IViewsService);

      await viewsService.openView(SAPPHIRE_VIEW_ID, true);
      chatThreadService.requestShowHistory();
    }
  },
);

KeybindingsRegistry.registerKeybindingRule({
  id: 'git.clone',
  weight: KeybindingWeight.SapphireExtension,
  primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyA,
});
