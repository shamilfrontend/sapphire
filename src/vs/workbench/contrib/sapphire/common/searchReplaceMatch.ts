/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Макс. строк начала, если ORIGINAL не уникален. */
const MAX_LISTED_MATCHES = 5;

/** Строк реального файла в ошибке «не найдено». */
const EXCERPT_LINES = 20;

export type SearchReplaceBlockInput = {
  state: 'writingOriginal' | 'writingFinal' | 'done';
  orig: string;
  final: string;
};

export type SearchReplaceReplacement = {
  /** 1-индексированная включительная строка в файле с нормализованными \\n. */
  startLine: number;
  /** 1-индексированная включительная строка. */
  endLine: number;
  final: string;
};

export type SearchReplaceMatchResult =
  { ok: true; replacements: SearchReplaceReplacement[] } | { ok: false; message: string };

type LineRange = { startLine: number; endLine: number };

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripOneTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/**
 * Внешнее markdown-ограждение (``` или ```markdown), если модель скопировала
 * блок из плана. Внутренние ``` в тексте не снимаются: жадный матч до последнего.
 */
function unwrapMarkdownFence(text: string): string | undefined {
  const match = /^\s*```[^\n]*\n([\s\S]*)\n```\s*$/.exec(text);
  if (!match || match[1].length === 0) {
    return undefined;
  }
  return match[1];
}

function isEffectivelyEmptyFile(file: string): boolean {
  return file.trim().length === 0;
}

/** FINAL для записи в пустой файл: снять внешний fence, если модель скопировала из плана. */
function finalForEmptyFileWrite(rawFinal: string): string {
  const normalized = stripOneTrailingNewline(normalizeNewlines(rawFinal));
  return unwrapMarkdownFence(normalized) ?? normalized;
}

function fence(text: string): string {
  return `\`\`\`\n${text}\n\`\`\``;
}

function fail(message: string): SearchReplaceMatchResult {
  return { ok: false, message };
}

function indexToLine(file: string, index: number): number {
  let line = 1;
  const end = Math.min(index, file.length);
  for (let i = 0; i < end; i++) {
    if (file.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

function findExactRanges(file: string, needle: string): LineRange[] {
  const ranges: LineRange[] = [];
  const needleLines = needle.split('\n').length;
  let from = 0;
  while (from <= file.length) {
    const idx = file.indexOf(needle, from);
    if (idx === -1) {
      break;
    }
    const startLine = indexToLine(file, idx);
    ranges.push({ startLine, endLine: startLine + needleLines - 1 });
    from = idx + needle.length;
  }
  return ranges;
}

function stripTrailingWhitespace(line: string): string {
  return line.replace(/[ \t]+$/g, '');
}

/** Общий ведущий whitespace непустых строк — как литеральный префикс. */
function commonLeadingIndent(lines: readonly string[]): string {
  let common: string | null = null;
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (common === null) {
      common = lead;
      continue;
    }
    let i = 0;
    const limit = Math.min(common.length, lead.length);
    while (i < limit && common.charCodeAt(i) === lead.charCodeAt(i)) {
      i++;
    }
    common = common.slice(0, i);
    if (common.length === 0) {
      break;
    }
  }
  return common ?? '';
}

function normalizeRelaxedLines(lines: readonly string[]): string[] {
  const trimmed = lines.map(stripTrailingWhitespace);
  const indent = commonLeadingIndent(trimmed);
  if (!indent) {
    return trimmed;
  }
  return trimmed.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line));
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function countEqualLines(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) {
      count++;
    }
  }
  return count;
}

function findRelaxedRanges(
  fileLines: readonly string[],
  needleLines: readonly string[],
): LineRange[] {
  const needleNorm = normalizeRelaxedLines(needleLines);
  const ranges: LineRange[] = [];
  if (needleLines.length === 0 || needleLines.length > fileLines.length) {
    return ranges;
  }
  for (let i = 0; i + needleLines.length <= fileLines.length; i++) {
    const window = fileLines.slice(i, i + needleLines.length);
    if (sameLines(normalizeRelaxedLines(window), needleNorm)) {
      ranges.push({ startLine: i + 1, endLine: i + needleLines.length });
    }
  }
  return ranges;
}

function formatLineList(startLines: readonly number[]): string {
  const shown = startLines.slice(0, MAX_LISTED_MATCHES);
  const extra = startLines.length - shown.length;
  const list = shown.join(', ');
  return extra > 0 ? `${list} (+${extra} more)` : list;
}

function notUniqueMessage(orig: string, ranges: readonly LineRange[]): string {
  const lines = formatLineList(ranges.map((range) => range.startLine));
  return `The edit was not applied. ORIGINAL appears more than once (lines ${lines}). Add surrounding lines so the match is unique. Nothing was written.\n\nORIGINAL:\n${fence(orig)}`;
}

function excerptAround(fileLines: readonly string[], startLine: number, windowLen: number): string {
  const start0 = Math.max(0, startLine - 1);
  const windowEnd0 = Math.min(fileLines.length - 1, start0 + Math.max(windowLen, 1) - 1);
  let from = start0;
  let to = windowEnd0;
  const span = to - from + 1;
  if (span < EXCERPT_LINES) {
    const extra = EXCERPT_LINES - span;
    const before = Math.floor(extra / 2);
    from = Math.max(0, start0 - before);
    to = Math.min(fileLines.length - 1, from + EXCERPT_LINES - 1);
    from = Math.max(0, to - EXCERPT_LINES + 1);
  } else {
    to = Math.min(fileLines.length - 1, start0 + EXCERPT_LINES - 1);
  }
  const parts: string[] = [];
  for (let i = from; i <= to; i++) {
    parts.push(`${i + 1}|${fileLines[i]}`);
  }
  return parts.join('\n');
}

function bestExcerpt(fileLines: readonly string[], needleLines: readonly string[]): string {
  if (fileLines.length === 0) {
    return '';
  }
  const needleNorm = normalizeRelaxedLines(needleLines);
  const windowLen = Math.max(1, Math.min(needleLines.length, fileLines.length));
  let bestStart = 1;
  let bestScore = -1;
  const last = fileLines.length - windowLen;
  for (let i = 0; i <= last; i++) {
    const windowNorm = normalizeRelaxedLines(fileLines.slice(i, i + windowLen));
    const score = countEqualLines(windowNorm, needleNorm);
    if (score > bestScore) {
      bestScore = score;
      bestStart = i + 1;
    }
  }
  return excerptAround(fileLines, bestStart, windowLen);
}

function notFoundMessage(
  orig: string,
  fileLines: readonly string[],
  needleLines: readonly string[],
): string {
  const excerpt = bestExcerpt(fileLines, needleLines);
  const closest = excerpt ? `Closest lines:\n${fence(excerpt)}\n\n` : '';
  return `The edit was not applied. ORIGINAL does not match the file. Nothing was written.\n\n${closest}ORIGINAL:\n${fence(orig)}`;
}

function matchNeedle(
  file: string,
  fileLines: readonly string[],
  needle: string,
): LineRange[] | SearchReplaceMatchResult {
  const exact = findExactRanges(file, needle);
  if (exact.length === 1) {
    return exact;
  }
  if (exact.length > 1) {
    return fail(notUniqueMessage(needle, exact));
  }
  const relaxed = findRelaxedRanges(fileLines, needle.split('\n'));
  if (relaxed.length === 1) {
    return relaxed;
  }
  if (relaxed.length > 1) {
    return fail(notUniqueMessage(needle, relaxed));
  }
  return fail(notFoundMessage(needle, fileLines, needle.split('\n')));
}

/**
 * Найти готовые SEARCH/REPLACE blocks в `fileText` (без применения).
 * Переводы строк в ORIGINAL нормализованы; финальный \n игнорируется.
 * При неточном тексте строки могут совпасть после trim хвостовых пробелов и общего indent.
 * Внутренние пробелы сохраняются.
 */
export function matchSearchReplaceBlocks(
  fileText: string,
  blocks: readonly SearchReplaceBlockInput[],
): SearchReplaceMatchResult {
  if (blocks.length === 0) {
    return fail('No Search/Replace blocks were received!');
  }
  const incomplete = blocks.find((block) => block.state !== 'done');
  if (incomplete) {
    return fail(
      'The edit was not applied. A SEARCH/REPLACE block is missing >>>>>>> UPDATED. Nothing was written.',
    );
  }

  const file = normalizeNewlines(fileText);
  const fileLines = file.split('\n');
  const replacements: (SearchReplaceReplacement & { orig: string })[] = [];

  // Пустой файл + один блок: fill содержимым UPDATED (create_file_or_folder + edit_file).
  if (blocks.length === 1 && isEffectivelyEmptyFile(file)) {
    const only = blocks[0];
    const finalText = finalForEmptyFileWrite(only.final);
    if (finalText.length === 0) {
      return fail('The edit was not applied. UPDATED is empty. Nothing was written.');
    }
    return {
      ok: true,
      replacements: [
        {
          startLine: 1,
          endLine: Math.max(1, fileLines.length),
          final: finalText,
        },
      ],
    };
  }

  for (const block of blocks) {
    let needle = stripOneTrailingNewline(normalizeNewlines(block.orig));
    if (needle.length === 0) {
      return fail('The edit was not applied. ORIGINAL is empty. Nothing was written.');
    }
    let finalText = block.final;
    let matched = matchNeedle(file, fileLines, needle);
    if (!Array.isArray(matched)) {
      const unwrapped = unwrapMarkdownFence(needle);
      const retryNeedle =
        unwrapped === undefined ? '' : stripOneTrailingNewline(unwrapped);
      if (retryNeedle.length > 0) {
        const retry = matchNeedle(file, fileLines, retryNeedle);
        if (Array.isArray(retry)) {
          matched = retry;
          needle = retryNeedle;
          const unwrappedFinal = unwrapMarkdownFence(
            stripOneTrailingNewline(normalizeNewlines(block.final)),
          );
          if (unwrappedFinal !== undefined) {
            finalText = unwrappedFinal;
          }
        }
      }
    }
    if (!Array.isArray(matched)) {
      return matched;
    }
    const range = matched[0];
    replacements.push({
      startLine: range.startLine,
      endLine: range.endLine,
      final: finalText,
      orig: needle,
    });
  }

  const ordered = [...replacements].sort(
    (a, b) => a.startLine - b.startLine || a.endLine - b.endLine,
  );
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].startLine <= ordered[i - 1].endLine) {
      return fail(
        `The edit was not applied. ORIGINAL blocks overlap. Nothing was written.\n\nORIGINAL:\n${fence(ordered[i].orig)}`,
      );
    }
  }

  return {
    ok: true,
    replacements: ordered.map(({ startLine, endLine, final }) => ({ startLine, endLine, final })),
  };
}
