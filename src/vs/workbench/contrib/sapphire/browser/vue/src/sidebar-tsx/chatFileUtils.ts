/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ScrollType } from '../../../../../../../editor/common/editorCommon.js';
import { IRange } from '../../../../../../../editor/common/core/range.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { openAgentsFile } from '../agents-window-tsx/agentsFileBridge.js';
import { useAccessor } from '../util/services.js';

export const getRelative = (uri: URI, accessor: ReturnType<typeof useAccessor>) => {
  const workspaceContextService = accessor.get('IWorkspaceContextService');
  let path: string;
  const isInside = workspaceContextService.isInsideWorkspace(uri);
  if (isInside) {
    const f = workspaceContextService
      .getWorkspace()
      .folders.find((f) => uri.fsPath?.startsWith(f.uri.fsPath));
    if (f) {
      path = uri.fsPath.replace(f.uri.fsPath, '');
    } else {
      path = uri.fsPath;
    }
  } else {
    path = uri.fsPath;
  }
  return path || undefined;
};

export const sapphireOpenFileFn = (
  uri: URI,
  accessor: ReturnType<typeof useAccessor>,
  range?: [number, number],
) => {
  if (uri.fsPath && openAgentsFile({ fsPath: uri.fsPath, range })) {
    return;
  }

  const commandService = accessor.get('ICommandService');
  const editorService = accessor.get('ICodeEditorService');

  // IRange из диапазона CodeSelection
  let editorSelection: IRange | undefined;

  // строим выделение редактора из range
  if (range) {
    editorSelection = {
      startLineNumber: range[0],
      startColumn: 1,
      endLineNumber: range[1],
      endColumn: Number.MAX_SAFE_INTEGER,
    };
  }

  // открываем файл
  commandService.executeCommand('vscode.open', uri).then(() => {
    // выделяем строки в редакторе
    setTimeout(() => {
      if (!editorSelection) {return;}

      const editor = editorService.getActiveCodeEditor();
      if (!editor) {return;}

      editor.setSelection(editorSelection);
      editor.revealRange(editorSelection, ScrollType.Immediate);
    }, 50); // документ только открылся — даём время на инициализацию
  });
};
