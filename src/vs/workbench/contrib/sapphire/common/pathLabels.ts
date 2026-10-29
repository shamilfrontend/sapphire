/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { shorten } from '../../../../base/common/labels.js';

export const getFolderName = (pathStr: string) => {
  // «Unixify»: единые слэши
  pathStr = pathStr.replace(/[/\\]+/g, '/');
  const parts = pathStr.split('/');
  // Пустые сегменты (последний часто пустой, если путь заканчивается на /)
  const nonEmptyParts = parts.filter((part) => part.length > 0);
  if (nonEmptyParts.length === 0) {return '/';} // корень
  if (nonEmptyParts.length === 1) {return `${nonEmptyParts[0]}/`;} // одна папка
  // Последние два сегмента пути
  const lastTwo = nonEmptyParts.slice(-2);
  return `${lastTwo.join('/')}/`;
};

export const getBasename = (pathStr: string, parts: number = 1) => {
  pathStr = pathStr.replace(/[/\\]+/g, '/');
  const allParts = pathStr.split('/');
  if (allParts.length === 0) {return pathStr;}
  return allParts.slice(-parts).join('/');
};

/** Различать одинаковые basename (`src/index.ts` vs `lib/index.ts`). */
export const uniquePathLabels = (paths: string[]): string[] => {
  if (paths.length === 0) {return [];}
  const unix = paths.map((p) => p.replace(/[/\\]+/g, '/'));
  return shorten(unix, '/');
};
