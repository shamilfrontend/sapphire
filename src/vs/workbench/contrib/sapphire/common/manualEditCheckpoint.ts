/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { SapphireFileSnapshot } from './editCodeServiceTypes.js';

/** Текст до первой ручной правки; последующие нажатия не перезаписывают его. */
export function rememberFirstBefore(
  store: { has(key: string): boolean; set(key: string, value: string): unknown },
  fsPath: string,
  beforeEntireFileCode: string,
): void {
  if (!store.has(fsPath)) {
    store.set(fsPath, beforeEntireFileCode);
  }
}

/**
 * Снимки файлов, отредактированных пользователем, но ещё не в истории checkpoint.
 * `entireFileCode` — текст до правки, без diff-зон.
 */
export function manualEditBaselinesForCheckpoint(
  beforeByFsPath: Iterable<[string, string]>,
  alreadyInHistory: { [fsPath: string]: unknown },
): { [fsPath: string]: SapphireFileSnapshot } {
  const out: { [fsPath: string]: SapphireFileSnapshot } = {};
  for (const [fsPath, beforeEntireFileCode] of beforeByFsPath) {
    if (fsPath in alreadyInHistory) continue;
    out[fsPath] = {
      snapshottedDiffAreaOfId: {},
      entireFileCode: beforeEntireFileCode,
    };
  }
  return out;
}
