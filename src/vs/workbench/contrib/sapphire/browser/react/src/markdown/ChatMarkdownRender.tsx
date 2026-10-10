/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { createContext, JSX, useContext, useState } from 'react';
import { marked, MarkedToken, Token } from 'marked';

import { convertToVscodeLang, detectLanguage } from '../../../../common/helpers/languageHelpers.js';
import { BlockCodeApplyWrapper } from './ApplyBlockHoverButtons.js';
import { MermaidBlock } from './MermaidBlock.js';
import { useAccessor } from '../util/services.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { isAbsolute } from '../../../../../../../base/common/path.js';
import { separateOutFirstLine } from '../../../../common/helpers/util.js';
import { BlockCode } from '../util/inputs.js';
import { CodespanLocationLink } from '../../../../common/chatThreadServiceTypes.js';
import { getBasename, uniquePathLabels } from '../../../../common/pathLabels.js';
import { getRelative, sapphireOpenFileFn } from '../sidebar-tsx/chatFileUtils.js';
import { isPlanFilePath } from '../../../../common/prompt/planFileHelpers.js';
import { useAgentsPlan } from '../agents-window-tsx/AgentsPlanContext.js';

export type ChatMessageLocation = {
  threadId: string;
  messageIdx: number;
};

type ApplyBoxLocation = ChatMessageLocation & { tokenIdx: string };

export const getApplyBoxId = ({ threadId, messageIdx, tokenIdx }: ApplyBoxLocation) =>
  `${threadId}-${messageIdx}-${tokenIdx}`;

/** Похоже на абсолютный путь файла, а не на URL или фрагмент комментария. */
function isValidUri(s: string): boolean {
  return s.length > 5 && isAbsolute(s) && !s.includes('//') && !s.includes('/*'); // отсекаем // и /*
}

function isPathLikeCodespan(s: string): boolean {
  return isValidUri(s) || s.includes('/') || s.includes('\\');
}

const collectPathLikeCodespans = (tokens: Token[]): string[] => {
  const out: string[] = [];
  const walk = (toks: Token[] | undefined) => {
    if (!toks) return;
    for (const token of toks) {
      const t = token as MarkedToken & { items?: { tokens?: Token[] }[] };
      if (t.type === 'codespan' && isPathLikeCodespan(t.text)) {
        out.push(t.text);
      }
      if ('tokens' in t && Array.isArray(t.tokens)) {
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

const ShortenedPathContext = createContext<Record<string, string> | null>(null);

// LaTeX без KaTeX — показываем как текст/ошибку
const LatexRender = ({ latex }: { latex: string }) => (
  <span className="katex-error text-red-500">{latex}</span>
);

const Codespan = ({
  text,
  className,
  onClick,
  tooltip,
}: {
  text: string;
  className?: string;
  onClick?: () => void;
  tooltip?: string;
}) => (
  <code
    className={`font-mono font-medium rounded-sm bg-void-bg-1 px-1 ${className}`}
    onClick={onClick}
    {...(tooltip
      ? {
          'data-tooltip-id': 'sapphire-tooltip',
          'data-tooltip-content': tooltip,
          'data-tooltip-place': 'top',
        }
      : {})}
  >
    {text}
  </code>
);

const CodespanWithLink = ({
  text,
  rawText,
  chatMessageLocation,
}: {
  text: string;
  rawText: string;
  chatMessageLocation: ChatMessageLocation;
}) => {
  const accessor = useAccessor();
  const agentsPlan = useAgentsPlan();
  const shortenedByOriginal = useContext(ShortenedPathContext) ?? {};

  const chatThreadService = accessor.get('IChatThreadService');

  const { messageIdx, threadId } = chatMessageLocation;

  const [_didComputeCodespanLink, setDidComputeCodespanLink] = useState<boolean>(false);

  let link: CodespanLocationLink | undefined;
  let tooltip: string | undefined;
  let displayText = shortenedByOriginal[text] ?? text;

  if (rawText.endsWith('`')) {
    // ссылка на файл из кэша треда
    link = chatThreadService.getCodespanLink({ codespanStr: text, messageIdx, threadId });

    if (link === undefined) {
      // асинхронно резолвим путь и кладём в кэш
      chatThreadService.generateCodespanLink({ codespanStr: text, threadId }).then((link) => {
        chatThreadService.addCodespanLink({
          newLinkText: text,
          newLinkLocation: link,
          messageIdx,
          threadId,
        });
        setDidComputeCodespanLink(true); // перерисовка после resolve
      });
    }

    if (link?.displayText) {
      displayText =
        shortenedByOriginal[link.displayText] ?? shortenedByOriginal[text] ?? link.displayText;
      if (isValidUri(link.displayText)) {
        tooltip = getRelative(URI.file(link.displayText), accessor);
      }
    } else if (isValidUri(text)) {
      tooltip = getRelative(URI.file(text), accessor); // полный путь во всплывающей подсказке
      displayText = shortenedByOriginal[text] ?? getBasename(text);
    }
  }

  const onClick = () => {
    if (!link) return;
    if (agentsPlan && isPlanFilePath(link.uri.fsPath)) {
      agentsPlan.openPlan(link.uri.fsPath);
      return;
    }
    if (link.selection)
      sapphireOpenFileFn(link.uri, accessor, [
        link.selection.startLineNumber,
        link.selection.endLineNumber,
      ]);
    else sapphireOpenFileFn(link.uri, accessor);
  };

  return (
    <Codespan
      text={displayText}
      onClick={onClick}
      className={
        link ? 'underline hover:brightness-90 transition-all duration-200 cursor-pointer' : ''
      }
      tooltip={tooltip || undefined}
    />
  );
};

const externalLinkStyle: React.CSSProperties = {
  color: 'var(--vscode-textLink-foreground)',
  textDecoration: 'underline',
  cursor: 'pointer',
};

const isSafeExternalHref = (href: string): boolean => {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
};

const ExternalLink = ({
  href,
  title,
  children,
}: {
  href: string;
  title?: string;
  children: React.ReactNode;
}) => {
  const accessor = useAccessor();
  return (
    <a
      href={href}
      title={title ?? href}
      style={externalLinkStyle}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isSafeExternalHref(href)) return;
        void accessor.get('INativeHostService').openExternal(href);
      }}
    >
      {children}
    </a>
  );
};

// markdown-ссылки и голые URL внутри text-токена
const LINKIFY_SOURCE =
  '\\[([^\\]]+)\\]\\(((?:https?:\\/\\/|mailto:)[^\\s)]+)\\)|https?:\\/\\/[^\\s<>)\\]]+';

const linkifyPlainText = (text: string): React.ReactNode => {
  const re = new RegExp(LINKIFY_SOURCE, 'g');
  const nodes: React.ReactNode[] = [];
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
      nodes.push(<span key={`t-${i}`}>{text.slice(last, match.index)}</span>);
    }
    if (isSafeExternalHref(href)) {
      nodes.push(
        <ExternalLink key={`l-${i}`} href={href}>
          {label}
        </ExternalLink>,
      );
    } else {
      nodes.push(<span key={`r-${i}`}>{text.slice(match.index, end)}</span>);
    }
    i += 1;
    last = end;
  }
  if (nodes.length === 0) return text;
  if (last < text.length) nodes.push(<span key="t-end">{text.slice(last)}</span>);
  return <>{nodes}</>;
};

const inlineTokensOf = (token: MarkedToken): Token[] | undefined => {
  const nested = (token as { tokens?: Token[] }).tokens;
  return Array.isArray(nested) && nested.length > 0 ? nested : undefined;
};

const paragraphToLatexSegments = (paragraphText: string) => {
  const segments: React.ReactNode[] = [];

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
        const [fullMatch, _formula] = match;
        const matchIndex = match.index;

        // текст до формулы
        if (matchIndex > lastIndex) {
          const textBefore = rawText.substring(lastIndex, matchIndex);
          segments.push(<span key={`text-${segmentId++}`}>{linkifyPlainText(textBefore)}</span>);
        }

        // сегмент LaTeX
        segments.push(<LatexRender key={`latex-${segmentId++}`} latex={fullMatch} />);

        lastIndex = matchIndex + fullMatch.length;
      }

      // хвост с возможным inline math
      if (lastIndex < rawText.length) {
        const remainingText = rawText.substring(lastIndex);

        // inline $...$ в остатке
        lastIndex = 0;
        inlineMathRegex.lastIndex = 0;
        const inlineSegments: React.ReactNode[] = [];

        while ((match = inlineMathRegex.exec(remainingText)) !== null) {
          const [fullMatch] = match;
          const matchIndex = match.index;

          // текст до inline LaTeX
          if (matchIndex > lastIndex) {
            const textBefore = remainingText.substring(lastIndex, matchIndex);
            inlineSegments.push(
              <span key={`inline-text-${segmentId++}`}>{linkifyPlainText(textBefore)}</span>,
            );
          }

          // inline LaTeX
          inlineSegments.push(
            <LatexRender key={`inline-latex-${segmentId++}`} latex={fullMatch} />,
          );

          lastIndex = matchIndex + fullMatch.length;
        }

        // текст после всех inline формул
        if (lastIndex < remainingText.length) {
          inlineSegments.push(
            <span key={`inline-final-${segmentId++}`}>
              {linkifyPlainText(remainingText.substring(lastIndex))}
            </span>,
          );
        }

        segments.push(...inlineSegments);
      }
    }
  }

  return segments;
};

export type RenderTokenOptions = {
  isApplyEnabled?: boolean;
  isLinkDetectionEnabled?: boolean;
  /** При рендере текста ссылки — не linkify-ить URL повторно. */
  disableAutoLink?: boolean;
};
const RenderToken = ({
  token,
  inPTag,
  codeURI,
  chatMessageLocation,
  tokenIdx,
  ...options
}: {
  token: Token | string;
  inPTag?: boolean;
  codeURI?: URI;
  chatMessageLocation?: ChatMessageLocation;
  tokenIdx: string;
} & RenderTokenOptions): React.ReactNode => {
  const accessor = useAccessor();
  const languageService = accessor.get('ILanguageService');

  // встроенные типы токенов marked
  const t = token as MarkedToken;

  const renderInline = (
    nested: Token[] | undefined,
    fallbackText: string,
    childOptions?: RenderTokenOptions,
  ) => {
    const nextOptions = childOptions ? { ...options, ...childOptions } : options;
    if (!nested?.length) {
      return nextOptions.disableAutoLink ? fallbackText : linkifyPlainText(fallbackText);
    }
    return nested.map((child, index) => (
      <RenderToken
        key={index}
        token={child}
        inPTag={inPTag}
        codeURI={codeURI}
        chatMessageLocation={chatMessageLocation}
        tokenIdx={`${tokenIdx ? `${tokenIdx}-` : ''}${index}`}
        {...nextOptions}
      />
    ));
  };

  if (t.raw.trim() === '') {
    return null;
  }

  if (t.type === 'space') {
    return <span>{t.raw}</span>;
  }

  if (t.type === 'code') {
    const [firstLine, remainingContents] = separateOutFirstLine(t.text);
    const firstLineIsURI = isValidUri(firstLine) && !codeURI;
    const contents = firstLineIsURI ? remainingContents?.trimStart() || '' : t.text; // первая строка — URI файла, не код

    if (!contents) return null;

    if ((t.lang || '').toLowerCase() === 'mermaid') {
      return <MermaidBlock code={contents} />;
    }

    // язык подсветки и URI файла
    let uri: URI | null;
    let language: string;
    if (codeURI) {
      uri = codeURI;
    } else if (firstLineIsURI) {
      // язык из пути в первой строке блока
      uri = URI.file(firstLine);
    } else {
      uri = null;
    }

    if (t.lang) {
      // lang из fenced block (пустая строка — частый случай)
      language = convertToVscodeLang(languageService, t.lang); // имя языка marked → id для VS Code
    } else {
      // fallback: detectLanguage по URI и тексту
      language = detectLanguage(languageService, { uri, fileContents: contents });
    }

    if (options.isApplyEnabled && chatMessageLocation) {
      const isCodeblockClosed = t.raw.trimEnd().endsWith('```'); // Apply только после закрытия ```

      const applyBoxId = getApplyBoxId({
        threadId: chatMessageLocation.threadId,
        messageIdx: chatMessageLocation.messageIdx,
        tokenIdx,
      });
      return (
        <BlockCodeApplyWrapper
          canApply={isCodeblockClosed}
          applyBoxId={applyBoxId}
          codeStr={contents}
          language={language}
          uri={uri || 'current'}
        >
          <BlockCode
            initValue={contents.trimEnd()} // trimEnd без лишнего переноса — иначе мигание
            language={language}
          />
        </BlockCodeApplyWrapper>
      );
    }

    return <BlockCode initValue={contents} language={language} />;
  }

  if (t.type === 'heading') {
    const HeadingTag = `h${t.depth}` as keyof JSX.IntrinsicElements;

    return (
      <HeadingTag>
        <ChatMarkdownRender
          chatMessageLocation={chatMessageLocation}
          string={t.text}
          inPTag
          codeURI={codeURI}
          {...options}
        />
      </HeadingTag>
    );
  }

  if (t.type === 'table') {
    return (
      <div>
        <table>
          <thead>
            <tr>
              {t.header.map((h, hIdx: number) => (
                <th key={hIdx}>{h.text}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, rowIdx: number) => (
              <tr key={rowIdx}>
                {row.map((r, rIdx: number) => (
                  <td key={rIdx}>{r.text}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (t.type === 'hr') {
    return <hr />;
  }

  if (t.type === 'blockquote') {
    return <blockquote>{t.text}</blockquote>;
  }

  if (t.type === 'list_item') {
    return (
      <li>
        <input type="checkbox" checked={t.checked} readOnly />
        <span>
          <ChatMarkdownRender
            chatMessageLocation={chatMessageLocation}
            string={t.text}
            inPTag
            codeURI={codeURI}
            {...options}
          />
        </span>
      </li>
    );
  }

  if (t.type === 'list') {
    const ListTag = t.ordered ? 'ol' : 'ul';

    return (
      <ListTag start={t.start ? t.start : undefined}>
        {t.items.map((item, index) => (
          <li key={index}>
            {item.task && <input type="checkbox" checked={item.checked} readOnly />}
            <span>
              <ChatMarkdownRender
                chatMessageLocation={chatMessageLocation}
                string={item.text}
                inPTag
                {...options}
              />
            </span>
          </li>
        ))}
      </ListTag>
    );
  }

  if (t.type === 'paragraph') {
    // ветка с LaTeX в параграфе
    const latexSegments = paragraphToLatexSegments(t.raw);
    if (latexSegments.length !== 0) {
      if (inPTag) {
        return <span className="block">{latexSegments}</span>;
      }
      return <p>{latexSegments}</p>;
    }

    // обычный рендер вложенных токенов
    const contents = (
      <>
        {t.tokens.map((token, index) => (
          <RenderToken
            key={index}
            token={token}
            tokenIdx={`${tokenIdx ? `${tokenIdx}-` : ''}${index}`} // уникальный tokenIdx для вложенных RenderToken
            chatMessageLocation={chatMessageLocation}
            inPTag
            {...options}
          />
        ))}
      </>
    );

    if (inPTag) return <span className="block">{contents}</span>;
    return <p>{contents}</p>;
  }

  if (t.type === 'text' || t.type === 'escape' || t.type === 'html') {
    const nested = inlineTokensOf(t);
    if (nested) return <span>{renderInline(nested, t.text)}</span>;
    const text = t.type === 'html' ? t.raw : t.text;
    return <span>{options.disableAutoLink ? text : linkifyPlainText(text)}</span>;
  }

  if (t.type === 'def') {
    return <></>; // def-токены marked не показываем
  }

  if (t.type === 'link') {
    const label = renderInline(inlineTokensOf(t), t.text, { disableAutoLink: true });
    if (!isSafeExternalHref(t.href)) return <span>{label}</span>;
    return (
      <ExternalLink href={t.href} title={t.title ?? undefined}>
        {label}
      </ExternalLink>
    );
  }

  if (t.type === 'image') {
    return <img src={t.href} alt={t.text} title={t.title ?? undefined} />;
  }

  if (t.type === 'strong') {
    return <strong>{renderInline(inlineTokensOf(t), t.text)}</strong>;
  }

  if (t.type === 'em') {
    return <em>{renderInline(inlineTokensOf(t), t.text)}</em>;
  }

  // inline codespan
  if (t.type === 'codespan') {
    if (options.isLinkDetectionEnabled && chatMessageLocation) {
      return (
        <CodespanWithLink text={t.text} rawText={t.raw} chatMessageLocation={chatMessageLocation} />
      );
    }

    return <Codespan text={t.text} />;
  }

  if (t.type === 'br') {
    return <br />;
  }

  // зачёркнутый текст
  if (t.type === 'del') {
    return <del>{renderInline(inlineTokensOf(t), t.text)}</del>;
  }
  // неизвестный тип токена
  return (
    <div className="bg-orange-50 rounded-sm overflow-hidden p-2">
      <span className="text-sm text-orange-500">Unknown token rendered...</span>
    </div>
  );
};

export const ChatMarkdownRender = ({
  string,
  inPTag = false,
  chatMessageLocation,
  ...options
}: {
  string: string;
  inPTag?: boolean;
  codeURI?: URI;
  chatMessageLocation: ChatMessageLocation | undefined;
} & RenderTokenOptions) => {
  const parentShortened = useContext(ShortenedPathContext);
  string = string.replaceAll('\n•', '\n\n•');
  const tokens = marked.lexer(string); // lexer marked
  let shortenedByOriginal = parentShortened;
  if (shortenedByOriginal === null) {
    const pathCodespans = collectPathLikeCodespans(tokens);
    const unique = uniquePathLabels(pathCodespans);
    shortenedByOriginal = Object.fromEntries(pathCodespans.map((p, i) => [p, unique[i] ?? p]));
  }
  return (
    <ShortenedPathContext.Provider value={shortenedByOriginal}>
      {tokens.map((token, index) => (
        <RenderToken
          key={index}
          token={token}
          inPTag={inPTag}
          chatMessageLocation={chatMessageLocation}
          tokenIdx={`${index}`}
          {...options}
        />
      ))}
    </ShortenedPathContext.Provider>
  );
};
