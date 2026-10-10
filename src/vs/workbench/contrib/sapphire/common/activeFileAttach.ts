/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

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

/** Без untitled — только URI, читаемые через fileService. */
export const isAttachableActiveFileUri = (uri: URI | null | undefined): uri is URI => {
  if (!uri) {
    return false;
  }
  if (uri.scheme === 'untitled') {
    return false;
  }
  return !!uri.fsPath;
};

/**
 * Добавить активный файл в staging (как @ / Ctrl+L).
 * `selns` не мутируется. No-op при disabled, omit, untitled или если уже есть.
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
