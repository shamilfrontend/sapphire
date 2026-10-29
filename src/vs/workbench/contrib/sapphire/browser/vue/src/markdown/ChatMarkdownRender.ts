/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComputedRef, type InjectionKey } from 'vue';
import { type MarkedToken, type Token } from 'marked';
import { isAbsolute } from '../../../../../../../base/common/path.js';

export type ChatMessageLocation = {
  threadId: string;
  messageIdx: number;
};

type ApplyBoxLocation = ChatMessageLocation & { tokenIdx: string };

export const getApplyBoxId = ({ threadId, messageIdx, tokenIdx }: ApplyBoxLocation) =>
  `${threadId}-${messageIdx}-${tokenIdx}`;

/** Похоже на абсолютный путь файла, а не на URL или фрагмент комментария. */
export function isValidUri(s: string): boolean {
  return s.length > 5 && isAbsolute(s) && !s.includes('//') && !s.includes('/*'); // отсекаем // и /*
}

function isPathLikeCodespan(s: string): boolean {
  return isValidUri(s) || s.includes('/') || s.includes('\\');
}

export const collectPathLikeCodespans = (tokens: Token[]): string[] => {
  const out: string[] = [];
  const walk = (toks: Token[] | undefined) => {
    if (!toks) {return;}
    for (const token of toks) {
      const t = token as MarkedToken & { items?: { tokens?: Token[] }[] };
      if (t.type === 'codespan' && isPathLikeCodespan(t.text)) {
        out.push(t.text);
      }
      if (Object.hasOwn(t, 'tokens') && Array.isArray(t.tokens)) {
        walk(t.tokens as Token[]);
      }
      if (t.type === 'list' && Array.isArray(t.items)) {
        for (const item of t.items) {
          walk(item.tokens);
        }
      }
    }
  };
  walk(tokens);
  return out;
};

export const shortenedPathKey: InjectionKey<ComputedRef<Record<string, string>>> =
  Symbol('shortenedPath');

export const inlineTokensOf = (token: MarkedToken): Token[] | undefined => {
  const nested = (token as { tokens?: Token[] }).tokens;
  return Array.isArray(nested) && nested.length > 0 ? nested : undefined;
};

export const isSafeExternalHref = (href: string): boolean => {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
};

type LinkifyPart =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'link'; key: string; href: string; label: string };

export type LinkifyResult = { kind: 'plain'; text: string } | { kind: 'rich'; parts: LinkifyPart[] };

export type LatexSegment =
  | { kind: 'text'; key: string; content: LinkifyResult }
  | { kind: 'latex'; key: string; latex: string };

// markdown-ссылки и голые URL внутри text-токена
const LINKIFY_SOURCE =
  '\\[([^\\]]+)\\]\\(((?:https?:\\/\\/|mailto:)[^\\s)]+)\\)|https?:\\/\\/[^\\s<>)\\]]+';

export const linkifyPlainText = (text: string): LinkifyResult => {
  const re = new RegExp(LINKIFY_SOURCE, 'g');
  const parts: LinkifyPart[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    const markdownLabel = match[1];
    const markdownHref = match[2];
    let end = match.index + match[0].length;
    let href: string;
    let label: string;
    if (markdownLabel !== undefined && markdownHref !== undefined) {
      href = markdownHref;
      label = markdownLabel;
    } else {
      const trimmed = match[0].replace(/[.,;:!?]+$/, '');
      href = trimmed;
      label = trimmed;
      end = match.index + trimmed.length;
      re.lastIndex = end;
    }
    if (match.index > last) {
      parts.push({ kind: 'text', key: `t-${i}`, text: text.slice(last, match.index) });
    }
    if (isSafeExternalHref(href)) {
      parts.push({ kind: 'link', key: `l-${i}`, href, label });
    } else {
      parts.push({ kind: 'text', key: `r-${i}`, text: text.slice(match.index, end) });
    }
    i += 1;
    last = end;
  }
  if (parts.length === 0) {return { kind: 'plain', text };}
  if (last < text.length) {parts.push({ kind: 'text', key: 't-end', text: text.slice(last) });}
  return { kind: 'rich', parts };
};

export const paragraphToLatexSegments = (paragraphText: string): LatexSegment[] => {
  const segments: LatexSegment[] = [];

  if (
    paragraphText &&
    !(paragraphText.includes('#') || paragraphText.includes('`')) && // не трогаем LaTeX рядом с кодом или заголовком
    !/^[\w\s.()[\]{}]+$/.test(paragraphText) // пропускаем «обычный» текст без LaTeX-маркеров
  ) {
    const rawText = paragraphText;
    // разбор $...$ и $$...$$
    const displayMathRegex = /\$\$(.*?)\$\$/g; // блочная математика $$...$$
    const inlineMathRegex = /\$((?!\$).*?)\$/g; // inline $...$ (не $$)

    // есть ли LaTeX в абзаце
    if (displayMathRegex.test(rawText) || inlineMathRegex.test(rawText)) {
      // сброс lastIndex после .test
      displayMathRegex.lastIndex = 0;
      inlineMathRegex.lastIndex = 0;

      // чередование текста и LaTeX
      let lastIndex = 0;
      let segmentId = 0;

      // сначала блочная математика
      let match;
      while ((match = displayMathRegex.exec(rawText)) !== null) {
        const [fullMatch] = match;
        const matchIndex = match.index;

        // текст до формулы
        if (matchIndex > lastIndex) {
          const textBefore = rawText.substring(lastIndex, matchIndex);
          segments.push({
            kind: 'text',
            key: `text-${segmentId++}`,
            content: linkifyPlainText(textBefore),
          });
        }

        // сегмент LaTeX
        segments.push({ kind: 'latex', key: `latex-${segmentId++}`, latex: fullMatch });

        lastIndex = matchIndex + fullMatch.length;
      }

      // хвост с возможным inline math
      if (lastIndex < rawText.length) {
        const remainingText = rawText.substring(lastIndex);

        // inline $...$ в остатке
        lastIndex = 0;
        inlineMathRegex.lastIndex = 0;

        while ((match = inlineMathRegex.exec(remainingText)) !== null) {
          const [fullMatch] = match;
          const matchIndex = match.index;

          // текст до inline LaTeX
          if (matchIndex > lastIndex) {
            const textBefore = remainingText.substring(lastIndex, matchIndex);
            segments.push({
              kind: 'text',
              key: `inline-text-${segmentId++}`,
              content: linkifyPlainText(textBefore),
            });
          }

          // inline LaTeX
          segments.push({
            kind: 'latex',
            key: `inline-latex-${segmentId++}`,
            latex: fullMatch,
          });

          lastIndex = matchIndex + fullMatch.length;
        }

        // текст после всех inline формул
        if (lastIndex < remainingText.length) {
          segments.push({
            kind: 'text',
            key: `inline-final-${segmentId++}`,
            content: linkifyPlainText(remainingText.substring(lastIndex)),
          });
        }
      }
    }
  }

  return segments;
};
