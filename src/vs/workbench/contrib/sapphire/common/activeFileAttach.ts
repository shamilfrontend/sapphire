/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { StagingSelectionItem } from './chatThreadServiceTypes.js';

/** true, если path уже есть как File или CodeSelection. */
export const uriAlreadyInSelections = (
  selns: StagingSelectionItem[] | null | undefined,
  fsPath: string,
): boolean => {
  if (!selns?.length) {
    return false;
  }
  return selns.some(
    (s) => (s.type === 'File' || s.type === 'CodeSelection') && s.uri.fsPath === fsPath,
  );
};

/** Только file / vscode-remote — без untitled и виртуальных вкладок (void://settings и т.п.). */
export const isAttachableActiveFileUri = (uri: URI | null | undefined): uri is URI => {
  if (!uri) {
    return false;
  }
  if (uri.scheme !== 'file' && uri.scheme !== 'vscode-remote') {
    return false;
  }
  return !!uri.fsPath;
};

/**
 * Добавить активный файл в staging (как @ / Ctrl+L).
 * `selns` не мутируется. No-op при disabled, omit, non-file URI или если уже есть.
 */
export const mergeActiveFileSelection = (
  selns: StagingSelectionItem[] | null | undefined,
  activeFile: { uri: URI; language: string } | null,
  opts: { enabled: boolean; omittedUriFsPath?: string | null },
): StagingSelectionItem[] => {
  const base = selns ? [...selns] : [];
  if (!opts.enabled || !activeFile || !isAttachableActiveFileUri(activeFile.uri)) {
    return base;
  }
  const fsPath = activeFile.uri.fsPath;
  if (opts.omittedUriFsPath === fsPath) {
    return base;
  }
  if (uriAlreadyInSelections(base, fsPath)) {
    return base;
  }
  return [
    ...base,
    {
      type: 'File',
      uri: activeFile.uri,
      language: activeFile.language || 'plaintext',
    },
  ];
};
