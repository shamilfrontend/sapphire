/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { EndOfLinePreference, ITextModel } from '../../../../../editor/common/model.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Hover } from '../../../../../editor/common/languages.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { extractCodeFromRegular } from '../../common/helpers/extractCodeFromResult.js';
import { isWindows } from '../../../../../base/common/platform.js';

const allLinebreakSymbols = ['\r\n', '\n'];
export const _ln = isWindows ? allLinebreakSymbols[0] : allLinebreakSymbols[1];

// Исторически — voideditor/void extension (autocomplete)

/*
Кратко об autotab (Tab-автодополнение):

Постобработка
- модели часто выдают лишние закрывающие скобки — обрезаем хвост до первой «лишней»
- дополнение середины строки (FIM) — пока до первого совпадения с suffix; цель — целая строка/блок
- UX: обычно одна строка ghost + предзагрузка следующего абзаца (кеш, разбиение по \\n\\n)

Предобработка (getCompletionOptions)
- не генерировать на пустых краях строки без контекста
- одна строка при тексте справа / коротком suffix / fill-middle

Состояние
- LRU по prefix (нормализация пробелов)
- после Tab — follow-up из остатка insertText; показ до завершения LLM
- accept сравнивает shownText, не сырой insertText
- prefix LLM: файл, язык, строка из hover

Детали
- trim результата: один ведущий/хвостовой пробел
- ключ кеша: до одного trailing \\n
*/

export type AutocompletionPredictionType =
  | 'single-line-fill-middle'
  | 'single-line-redo-suffix'
  // | 'multi-line-start-here'
  | 'multi-line-start-on-next-line'
  | 'do-not-predict';

export type Autocompletion = {
  id: number;
  prefix: string;
  suffix: string;
  llmPrefix: string;
  llmSuffix: string;
  startTime: number;
  endTime: number | undefined;
  status: 'pending' | 'finished' | 'error';
  type: AutocompletionPredictionType;
  llmPromise: Promise<string> | undefined;
  insertText: string;
  /** Текст ghost после постобработки; для Tab accept. */
  shownText?: string;
  requestId: string | null;
  _newlineCount: number;
};

export const DEBOUNCE_TIME = 500;
export const TIMEOUT_TIME = 60000;
export const MAX_CACHE_SIZE = 20;
export const MAX_PENDING_REQUESTS = 2;
export const HOVER_CONTEXT_TIMEOUT_MS = 200;
const HOVER_CONTEXT_MAX_CHARS = 200;
const FIM_EARLY_MIN_CHARS = 8;

// постобработка FIM-ответа
const processStartAndEndSpaces = (result: string) => {
  // один ведущий/хвостовой пробел
  // return result.trim()

  [result] = extractCodeFromRegular({ text: result, recentlyAddedTextLen: result.length });

  const hasLeadingSpace = result.startsWith(' ');
  const hasTrailingSpace = result.endsWith(' ');

  return (hasLeadingSpace ? ' ' : '') + result.trim() + (hasTrailingSpace ? ' ' : '');
};

export const fimInsertTextFromFullText = (
  fullText: string,
  type: Autocompletion['type'],
): string => {
  const [text] = extractCodeFromRegular({ text: fullText, recentlyAddedTextLen: 0 });
  let insertText = processStartAndEndSpaces(text);
  if (type === 'multi-line-start-on-next-line') {
    insertText = _ln + insertText;
  }
  return insertText;
};

export const shouldShowFimEarly = (insertText: string): boolean => {
  // trim — синт. \n не в счёт FIM_EARLY
  const trimmed = insertText.trim();
  return trimmed.length >= FIM_EARLY_MIN_CHARS || trimmed.includes('\n');
};

// нормализация prefix для кеша
const removeLeftTabsAndTrimEnds = (s: string): string => {
  const trimmedString = s.trimEnd();
  const trailingEnd = s.slice(trimmedString.length);

  // один trailing \n
  if (trailingEnd.includes(_ln)) {
    s = trimmedString + _ln;
  }

  s = s.replace(/^\s+/gm, ''); // убрать leading whitespace на строках

  return s;
};

export const removeAllWhitespace = (str: string): string => str.replace(/\s+/g, '');

export const plaintextFromHover = (hover: Hover | undefined | null): string => {
  if (!hover?.contents?.length) return '';
  for (const part of hover.contents) {
    const raw = typeof part === 'string' ? part : part.value;
    if (!raw) continue;
    const withoutFences = raw.replace(/```[\s\S]*?```/g, ' ').replace(/[`*_]/g, ' ');
    const line = withoutFences
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (line) {
      return line.slice(0, HOVER_CONTEXT_MAX_CHARS);
    }
  }
  return '';
};

export const rememberShownText = (
  autocompletion: Autocompletion,
  items: { insertText: string }[],
): void => {
  const shown = items[0]?.insertText;
  if (typeof shown === 'string') {
    autocompletion.shownText = shown;
  }
};

function getIsSubsequence({
  of,
  subsequence,
}: {
  of: string;
  subsequence: string;
}): [boolean, string] {
  if (subsequence.length === 0) return [true, ''];
  if (of.length === 0) return [false, ''];

  let subsequenceIndex = 0;
  let lastMatchChar = '';

  for (let i = 0; i < of.length; i++) {
    if (of[i] === subsequence[subsequenceIndex]) {
      lastMatchChar = of[i];
      subsequenceIndex++;
    }
    if (subsequenceIndex === subsequence.length) {
      return [true, lastMatchChar];
    }
  }

  return [false, lastMatchChar];
}

function getStringUpToUnbalancedClosingParenthesis(s: string, prefix: string): string {
  const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };

  // стек скобок prefix (строки/шаблоны)
  let stack: string[] = [];
  const pushBracketsFrom = (text: string, startStack: string[]): string[] => {
    const st = [...startStack];
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\' && (inSingle || inDouble || inTemplate)) {
        escape = true;
        continue;
      }
      if (!inDouble && !inTemplate && char === "'") {
        inSingle = !inSingle;
        continue;
      }
      if (!inSingle && !inTemplate && char === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble && char === '`') {
        inTemplate = !inTemplate;
        continue;
      }
      if (inSingle || inDouble || inTemplate) continue;

      if (char === '(' || char === '{' || char === '[') {
        st.push(char);
      } else if (char === ')' || char === '}' || char === ']') {
        if (st.length > 0 && st[st.length - 1] === pairs[char]) {
          st.pop();
        } else {
          st.push(char);
        }
      }
    }
    return st;
  };

  const firstOpenIdx = prefix.search(/[[({]/);
  if (firstOpenIdx !== -1) {
    stack = pushBracketsFrom(prefix.slice(firstOpenIdx), []);
  }

  // обход completion до лишней закрывающей скобки
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\' && (inSingle || inDouble || inTemplate)) {
      escape = true;
      continue;
    }
    if (!inDouble && !inTemplate && char === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && char === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && char === '`') {
      inTemplate = !inTemplate;
      continue;
    }
    if (inSingle || inDouble || inTemplate) continue;

    if (char === '(' || char === '{' || char === '[') {
      stack.push(char);
    } else if (char === ')' || char === '}' || char === ']') {
      if (stack.length === 0 || stack.pop() !== pairs[char]) {
        return s.substring(0, i);
      }
    }
  }
  return s;
}

// UX-постобработка inline completion
const postprocessAutocompletion = ({
  autocompletionMatchup,
  autocompletion,
  prefixAndSuffix,
}: {
  autocompletionMatchup: AutocompletionMatchupBounds;
  autocompletion: Autocompletion;
  prefixAndSuffix: PrefixAndSuffixInfo;
}) => {
  const { prefix, prefixToTheLeftOfCursor, suffixToTheRightOfCursor } = prefixAndSuffix;

  const generatedMiddle = autocompletion.insertText;

  let startIdx = autocompletionMatchup.startIdx;
  let endIdx = generatedMiddle.length; // exclusive

  // const naiveReturnValue = generatedMiddle.slice(startIdx)
  // console.log('naiveReturnValue: ', JSON.stringify(naiveReturnValue))
  // return [{ insertText: naiveReturnValue, }]

  // эвристики отображения
  // временные эвристики

  // дублирующий пробел у курсора
  const charToLeftOfCursor = prefixToTheLeftOfCursor.slice(-1)[0] || '';
  const userHasAddedASpace = charToLeftOfCursor === ' ' || charToLeftOfCursor === '\t';
  const rawFirstNonspaceIdx = generatedMiddle.slice(startIdx).search(/[^\t ]/);
  if (rawFirstNonspaceIdx > -1 && userHasAddedASpace) {
    const firstNonspaceIdx = rawFirstNonspaceIdx + startIdx;
    // console.log('p0', startIdx, rawFirstNonspaceIdx)
    startIdx = Math.max(startIdx, firstNonspaceIdx);
  }

  // пустая строка — убрать leading \n
  const numStartingNewlines =
    generatedMiddle.slice(startIdx).match(new RegExp(`^${_ln}+`))?.[0].length || 0;
  if (
    !prefixToTheLeftOfCursor.trim() &&
    !suffixToTheRightOfCursor.trim() &&
    numStartingNewlines > 0
  ) {
    // console.log('p1', numStartingNewlines)
    startIdx += numStartingNewlines;
  }

  // совпадение с suffix на строке
  // простой suffix — до конца строки generation
  if (autocompletion.type === 'single-line-fill-middle' && suffixToTheRightOfCursor.trim()) {
    const suffixTrim = suffixToTheRightOfCursor.trim();
    const simpleSuffix = /^[\w$)\]}>'"`,.;:]+$/.test(suffixTrim);
    if (simpleSuffix) {
      // до \n в generation
      const rawNewlineIdx = generatedMiddle.slice(startIdx).indexOf(_ln);
      if (rawNewlineIdx > -1) {
        endIdx = Math.min(endIdx, rawNewlineIdx + startIdx);
      }
    } else {
      // до символа как в suffix
      const rawMatchIndex = generatedMiddle.slice(startIdx).lastIndexOf(suffixTrim[0]);
      if (rawMatchIndex > -1) {
        const matchIdx = rawMatchIndex + startIdx;
        const matchChar = generatedMiddle[matchIdx];
        if (`{}()[]<>\`'"`.includes(matchChar)) {
          endIdx = Math.min(endIdx, matchIdx);
        }
      }
    }
  }

  const restOfLineToGenerate = generatedMiddle.slice(startIdx).split(_ln)[0] ?? '';
  // однострочное дополнение
  if (
    prefixToTheLeftOfCursor.trim() &&
    !suffixToTheRightOfCursor.trim() &&
    restOfLineToGenerate.trim()
  ) {
    const rawNewlineIdx = generatedMiddle.slice(startIdx).indexOf(_ln);
    if (rawNewlineIdx > -1) {
      // console.log('p3', startIdx, rawNewlineIdx)
      const newlineIdx = rawNewlineIdx + startIdx;
      endIdx = Math.min(endIdx, newlineIdx);
    }
  }

  // // if a generated line matches with a suffix line, stop
  // if (suffixLines.length > 1) {
  // 	console.log('4')
  // 	const lines = []
  // 	for (const generatedLine of generatedLines) {
  // 		if (suffixLines.slice(0, 10).some(suffixLine =>
  // 			generatedLine.trim() !== '' && suffixLine.trim() !== ''
  // 			&& generatedLine.trim().startsWith(suffixLine.trim())
  // 		)) break;
  // 		lines.push(generatedLine)
  // 	}
  // 	endIdx = lines.join('\n').length // this is hacky, remove or refactor in future
  // }

  // console.log('pFinal', startIdx, endIdx)
  let completionStr = generatedMiddle.slice(startIdx, endIdx);

  // обрезка по несбалансированным скобкам
  completionStr = getStringUpToUnbalancedClosingParenthesis(completionStr, prefix);
  // console.log('originalCompletionStr: ', JSON.stringify(generatedMiddle.slice(startIdx)))
  // console.log('finalCompletionStr: ', JSON.stringify(completionStr))

  return completionStr;
};

// inline completion после match prefix
export const toInlineCompletions = ({
  autocompletionMatchup,
  autocompletion,
  prefixAndSuffix,
  position,
}: {
  autocompletionMatchup: AutocompletionMatchupBounds;
  autocompletion: Autocompletion;
  prefixAndSuffix: PrefixAndSuffixInfo;
  position: Position;
  debug?: boolean;
}): { insertText: string; range: Range }[] => {
  let trimmedInsertText = postprocessAutocompletion({
    autocompletionMatchup,
    autocompletion,
    prefixAndSuffix,
  });
  let rangeToReplace: Range = new Range(
    position.lineNumber,
    position.column,
    position.lineNumber,
    position.column,
  );

  // однострочный redo-suffix

  // заменить suffix на generation
  if (autocompletion.type === 'single-line-redo-suffix') {
    const oldSuffix = prefixAndSuffix.suffixToTheRightOfCursor;
    const newSuffix = autocompletion.insertText;

    const [isSubsequence, lastMatchingChar] = getIsSubsequence({
      // subsequence по символам без пробелов
      subsequence: removeAllWhitespace(oldSuffix), // старый suffix
      of: removeAllWhitespace(newSuffix), // новый suffix
    });
    if (isSubsequence) {
      rangeToReplace = new Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        Number.MAX_SAFE_INTEGER,
      );
    } else {
      const lastMatchupIdx = trimmedInsertText.lastIndexOf(lastMatchingChar);
      trimmedInsertText = trimmedInsertText.slice(0, lastMatchupIdx + 1);
      const numCharsToReplace = oldSuffix.lastIndexOf(lastMatchingChar) + 1;
      rangeToReplace = new Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column + numCharsToReplace,
      );
      // console.log('show____', trimmedInsertText, rangeToReplace)
    }
  }

  return [
    {
      insertText: trimmedInsertText,
      range: rangeToReplace,
    },
  ];
};

export type PrefixAndSuffixInfo = {
  prefix: string;
  suffix: string;
  prefixLines: string[];
  suffixLines: string[];
  prefixToTheLeftOfCursor: string;
  suffixToTheRightOfCursor: string;
};
export const getPrefixAndSuffixInfo = (
  model: ITextModel,
  position: Position,
): PrefixAndSuffixInfo => {
  const fullText = model.getValue(EndOfLinePreference.LF);

  const cursorOffset = model.getOffsetAt(position);
  const prefix = fullText.substring(0, cursorOffset);
  const suffix = fullText.substring(cursorOffset);

  const prefixLines = prefix.split(_ln);
  const suffixLines = suffix.split(_ln);

  const prefixToTheLeftOfCursor = prefixLines.slice(-1)[0] ?? '';
  const suffixToTheRightOfCursor = suffixLines[0] ?? '';

  return {
    prefix,
    suffix,
    prefixLines,
    suffixLines,
    prefixToTheLeftOfCursor,
    suffixToTheRightOfCursor,
  };
};

const getIndex = (str: string, line: number, char: number) =>
  str.split(_ln).slice(0, line).join(_ln).length + (line > 0 ? 1 : 0) + char;
const getLastLine = (s: string): string => {
  const matches = s.match(new RegExp(`[^${_ln}]*$`));
  return matches ? matches[0] : '';
};

export type AutocompletionMatchupBounds = {
  startLine: number;
  startCharacter: number;
  startIdx: number;
};
// startIdx в insertText или undefined
// координаты в insertText
export const getAutocompletionMatchup = ({
  prefix,
  autocompletion,
}: {
  prefix: string;
  autocompletion: Autocompletion;
}): AutocompletionMatchupBounds | undefined => {
  const trimmedCurrentPrefix = removeLeftTabsAndTrimEnds(prefix);
  const trimmedCompletionPrefix = removeLeftTabsAndTrimEnds(autocompletion.prefix);
  const trimmedCompletionMiddle = removeLeftTabsAndTrimEnds(autocompletion.insertText);

  // console.log('@result: ', JSON.stringify(autocompletion.insertText))
  // console.log('@trimmedCurrentPrefix: ', JSON.stringify(trimmedCurrentPrefix))
  // console.log('@trimmedCompletionPrefix: ', JSON.stringify(trimmedCompletionPrefix))
  // console.log('@trimmedCompletionMiddle: ', JSON.stringify(trimmedCompletionMiddle))

  if (trimmedCurrentPrefix.length < trimmedCompletionPrefix.length) {
    // prefix должен продолжать cached prefix
    // console.log('@undefined1')
    return undefined;
  }

  if (
    // completion покрывает current prefix
    !(trimmedCompletionPrefix + trimmedCompletionMiddle).startsWith(trimmedCurrentPrefix)
  ) {
    // console.log('@undefined2')
    return undefined;
  }

  // обратное отображение строки/колонки
  const lineStart =
    trimmedCurrentPrefix.split(_ln).length - trimmedCompletionPrefix.split(_ln).length;

  if (lineStart < 0) {
    // console.log('@undefined3')

    console.error('Error: No line found.');
    return undefined;
  }
  const currentPrefixLine = getLastLine(trimmedCurrentPrefix);
  const completionPrefixLine = lineStart === 0 ? getLastLine(trimmedCompletionPrefix) : '';
  const completionMiddleLine = autocompletion.insertText.split(_ln)[lineStart];
  const fullCompletionLine = completionPrefixLine + completionMiddleLine;

  // console.log('currentPrefixLine', currentPrefixLine)
  // console.log('completionPrefixLine', completionPrefixLine)
  // console.log('completionMiddleLine', completionMiddleLine)

  const charMatchIdx = fullCompletionLine.indexOf(currentPrefixLine);
  if (charMatchIdx < 0) {
    // console.log('@undefined4', charMatchIdx)

    console.error('Warning: Found character with negative index. This should never happen.');
    return undefined;
  }

  const character = charMatchIdx + currentPrefixLine.length - completionPrefixLine.length;

  const startIdx = getIndex(autocompletion.insertText, lineStart, character);

  return {
    startLine: lineStart,
    startCharacter: character,
    startIdx,
  };
};

type CompletionOptions = {
  predictionType: AutocompletionPredictionType;
  shouldGenerate: boolean;
  llmPrefix: string;
  llmSuffix: string;
  stopTokens: string[];
};
export const getCompletionOptions = (
  prefixAndSuffix: PrefixAndSuffixInfo,
  relevantContext: string,
  justAcceptedAutocompletion: boolean,
  fileLabel: string,
): CompletionOptions => {
  let {
    prefix,
    suffix,
    prefixToTheLeftOfCursor,
    suffixToTheRightOfCursor,
    suffixLines,
    prefixLines,
  } = prefixAndSuffix;

  // обрезка context для LLM
  suffixLines = suffix.split(_ln).slice(0, 25);
  prefixLines = prefix.split(_ln).slice(-25);
  prefix = prefixLines.join(_ln);
  suffix = suffixLines.join(_ln);

  let completionOptions: CompletionOptions;

  // пустая строка
  const isLineEmpty = !prefixToTheLeftOfCursor.trim() && !suffixToTheRightOfCursor.trim();
  const isLinePrefixEmpty = removeAllWhitespace(prefixToTheLeftOfCursor).length === 0;
  const isLineSuffixEmpty = removeAllWhitespace(suffixToTheRightOfCursor).length === 0;

  // после Tab — multiline на следующей строке
  if (justAcceptedAutocompletion && isLineSuffixEmpty) {
    const prefixWithNewline = prefix + _ln;
    completionOptions = {
      predictionType: 'multi-line-start-on-next-line',
      shouldGenerate: true,
      llmPrefix: prefixWithNewline,
      llmSuffix: suffix,
      stopTokens: [`${_ln}${_ln}`], // двойной перевод строки
    };
  }
  // пустая строка — single-line
  else if (isLineEmpty) {
    completionOptions = {
      predictionType: 'single-line-fill-middle',
      shouldGenerate: true,
      llmPrefix: prefix,
      llmSuffix: suffix,
      stopTokens: allLinebreakSymbols,
    };
  }
  // короткий suffix — redo-suffix
  else if (removeAllWhitespace(suffixToTheRightOfCursor).length <= 3) {
    const suffixLinesIgnoringThisLine = suffixLines.slice(1);
    const suffixStringIgnoringThisLine =
      suffixLinesIgnoringThisLine.length === 0 ? '' : _ln + suffixLinesIgnoringThisLine.join(_ln);
    completionOptions = {
      predictionType: 'single-line-redo-suffix',
      shouldGenerate: true,
      llmPrefix: prefix,
      llmSuffix: suffixStringIgnoringThisLine,
      stopTokens: allLinebreakSymbols,
    };
  }
  // fill-middle при непустом prefix
  else if (!isLinePrefixEmpty) {
    completionOptions = {
      predictionType: 'single-line-fill-middle',
      shouldGenerate: true,
      llmPrefix: prefix,
      llmSuffix: suffix,
      stopTokens: allLinebreakSymbols,
    };
  } else {
    completionOptions = {
      predictionType: 'do-not-predict',
      shouldGenerate: false,
      llmPrefix: prefix,
      llmSuffix: suffix,
      stopTokens: [],
    };
  }

  const header: string[] = [];
  if (fileLabel) {
    header.push(`// File: ${fileLabel}`);
  }
  if (relevantContext) {
    header.push(`/* Relevant context: ${relevantContext} */`);
  }
  if (header.length) {
    completionOptions.llmPrefix = `${header.join('\n')}\n${completionOptions.llmPrefix}`;
  }

  return completionOptions;
};
