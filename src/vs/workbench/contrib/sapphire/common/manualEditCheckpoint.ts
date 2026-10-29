/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SapphireFileSnapshot } from './editCodeServiceTypes.js';

/** Потолок текста baseline в checkpoint — полный файл не нужен для undo, раздувает stringify. */
export const MANUAL_EDIT_BASELINE_MAX_CHARS = 100_000;

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

function capBaselineText(text: string): string {
  if (text.length <= MANUAL_EDIT_BASELINE_MAX_CHARS) {
    return text;
  }
  return text.slice(0, MANUAL_EDIT_BASELINE_MAX_CHARS);
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
    if (Object.hasOwn(alreadyInHistory, fsPath)) {continue;}
    out[fsPath] = {
      snapshottedDiffAreaOfId: {},
      entireFileCode: capBaselineText(beforeEntireFileCode),
    };
  }
  return out;
}
