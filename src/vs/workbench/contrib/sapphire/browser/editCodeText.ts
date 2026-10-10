/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';

export const numLinesOfStr = (str: string) => str.split('\n').length;

export const getLengthOfTextPx = ({
  tabWidth,
  spaceWidth,
  content,
}: {
  tabWidth: number;
  spaceWidth: number;
  content: string;
}) => {
  let lengthOfTextPx = 0;
  for (const char of content) {
    if (char === '\t') {
      lengthOfTextPx += tabWidth;
    } else {
      lengthOfTextPx += spaceWidth;
    }
  }

  return lengthOfTextPx;
};

export const getLeadingWhitespacePx = (editor: ICodeEditor, startLine: number): number => {
  const model = editor.getModel();
  if (!model) {
    return 0;
  }

  // содержимое строки или ''
  const lineContent = model.getLineContent(startLine) || '';

  // первый непробельный символ
  const firstNonWhitespaceIndex = lineContent.search(/\S/);

  // ведущие пробелы/табы
  const leadingWhitespace =
    firstNonWhitespaceIndex === -1 ? lineContent : lineContent.slice(0, firstNonWhitespaceIndex);

  // tabSize и ширина пробела из редактора
  const { tabSize: numSpacesInTab } = model.getFormattingOptions();
  const spaceWidth = editor.getOption(EditorOption.fontInfo).spaceWidth;
  const tabWidth = numSpacesInTab * spaceWidth;

  const leftWhitespacePx = getLengthOfTextPx({
    tabWidth,
    spaceWidth,
    content: leadingWhitespace,
  });

  return leftWhitespacePx;
};

// убрать пробелы, сохранить \n
const removeWhitespaceExceptNewlines = (str: string): string => str.replace(/[^\S\n]+/g, '');

// найти text в fileContents → [startLine, endLine]
// startingAtLine — с 1, включительно
// строки с 1
export const findTextInCode = (
  text: string,
  fileContents: string,
  canFallbackToRemoveWhitespace: boolean,
  opts: { startingAtLine?: number; returnType: 'lines' },
) => {
  const returnAns = (fileContents: string, idx: number) => {
    const startLine = numLinesOfStr(fileContents.substring(0, idx + 1));
    const numLines = numLinesOfStr(text);
    const endLine = startLine + numLines - 1;

    return [startLine, endLine] as const;
  };

  const startingAtLineIdx = (fileContents: string) =>
    opts?.startingAtLine !== undefined
      ? fileContents.split('\n').slice(0, opts.startingAtLine).join('\n').length // символов до startingAtLine
      : 0;

  // idx — индекс в fileContents
  let idx = fileContents.indexOf(text, startingAtLineIdx(fileContents));

  // точное совпадение
  if (idx !== -1) {
    return returnAns(fileContents, idx);
  }

  if (!canFallbackToRemoveWhitespace) return 'Not found' as const;

  // fallback: без пробелов
  text = removeWhitespaceExceptNewlines(text);
  fileContents = removeWhitespaceExceptNewlines(fileContents);
  idx = fileContents.indexOf(text, startingAtLineIdx(fileContents));

  if (idx === -1) return 'Not found' as const;
  const lastIdx = fileContents.lastIndexOf(text);
  if (lastIdx !== idx) return 'Not unique' as const;

  return returnAns(fileContents, idx);
};

// line/col в файле; originalCodeStartLine — начало original в diff
export type StreamLocationMutable = {
  line: number;
  col: number;
  addedSplitYet: boolean;
  originalCodeStartLine: number;
};
