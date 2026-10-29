/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ComputedDiff } from '../../common/editCodeServiceTypes.js';
import { diffLines } from '../vue/out/diff/index.js';

export function findDiffs(oldStr: string, newStr: string) {
  // Добавляем \n в конец: иначе diff E vs E\n даёт «edit», а E\n vs E\n\n — корректную вставку
  newStr += '\n';
  oldStr += '\n';

  // Построчный diff: удалённые/добавленные/без изменений (порядок однозначен)
  const lineByLineChanges = diffLines(oldStr, newStr);
  lineByLineChanges.push({ value: '', added: false, removed: false }); // dummy — сброс хвостовой серии +/-

  let oldFileLineNum: number = 1;
  let newFileLineNum: number = 1;

  let streakStartInNewFile: number | undefined;
  let streakStartInOldFile: number | undefined;

  const oldStrLines = `\n${oldStr}`.split('\n'); // ведущий \n — нумерация с 1
  const newStrLines = `\n${newStr}`.split('\n');

  const replacements: ComputedDiff[] = [];
  for (const line of lineByLineChanges) {
    // строка без изменений
    if (!line.added && !line.removed) {
      // конец серии +/- — собираем ComputedDiff
      if (streakStartInNewFile !== undefined) {
        let type: 'edit' | 'insertion' | 'deletion' = 'edit';

        const startLine = streakStartInNewFile;
        const endLine = newFileLineNum - 1; // текущая строка не входит в edit

        const originalStartLine = streakStartInOldFile!;
        const originalEndLine = oldFileLineNum - 1;

        const newContent = newStrLines.slice(startLine, endLine + 1).join('\n');
        const originalContent = oldStrLines
          .slice(originalStartLine, originalEndLine + 1)
          .join('\n');

        // пустой диапазон в новом или старом файле → deletion / insertion
        if (endLine === startLine - 1) {
          type = 'deletion';
        } else if (originalEndLine === originalStartLine - 1) {
          type = 'insertion';
        }

        const replacement: ComputedDiff = {
          type,
          startLine,
          endLine,
          originalStartLine,
          originalEndLine,
          originalCode: originalContent,
          code: newContent,
        };

        replacements.push(replacement);

        streakStartInNewFile = undefined;
        streakStartInOldFile = undefined;
      }
      oldFileLineNum += line.count ?? 0;
      newFileLineNum += line.count ?? 0;
    }

    // строка удалена из старого файла
    else if (line.removed) {
      if (streakStartInNewFile === undefined) {
        streakStartInNewFile = newFileLineNum;
        streakStartInOldFile = oldFileLineNum;
      }
      oldFileLineNum += line.count ?? 0;
    }

    // строка добавлена в новый файл
    else if (line.added) {
      if (streakStartInNewFile === undefined) {
        streakStartInNewFile = newFileLineNum;
        streakStartInOldFile = oldFileLineNum;
      }
      newFileLineNum += line.count ?? 0;
    }
  }

  return replacements;
}
