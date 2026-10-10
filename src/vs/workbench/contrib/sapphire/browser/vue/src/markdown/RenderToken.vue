<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { type MarkedToken, type Token, type Tokens } from 'marked';
import { URI } from '../../../../../../../base/common/uri.js';
import { convertToVscodeLang, detectLanguage } from '../../../../common/helpers/languageHelpers.js';
import { separateOutFirstLine } from '../../../../common/helpers/util.js';
import { useAccessor } from '../util/services.js';
import BlockCode from '../util/BlockCode.vue';
import BlockCodeApplyWrapper from './BlockCodeApplyWrapper.vue';
import ChatMarkdownRender from './ChatMarkdownRender.vue';
import Codespan from './Codespan.vue';
import CodespanWithLink from './CodespanWithLink.vue';
import ExternalLink from './ExternalLink.vue';
import LatexRender from './LatexRender.vue';
import LinkifiedText from './LinkifiedText.vue';
import MermaidBlock from './MermaidBlock.vue';
import TokenBody from './TokenBody.vue';
import {
  getApplyBoxId,
  inlineTokensOf,
  isSafeExternalHref,
  isValidUri,
  paragraphToLatexSegments,
  type ChatMessageLocation,
  type LatexSegment,
} from './ChatMarkdownRender.js';

const props = defineProps<{
  token: Token;
  inPTag?: boolean;
  codeURI?: URI;
  chatMessageLocation?: ChatMessageLocation;
  tokenIdx: string;
  isApplyEnabled?: boolean;
  isLinkDetectionEnabled?: boolean;
  disableAutoLink?: boolean;
}>();

const accessor = useAccessor();
const languageService = accessor.get('ILanguageService');

const headingTag = (depth: number): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' => {
  if (depth === 1) return 'h1';
  if (depth === 2) return 'h2';
  if (depth === 3) return 'h3';
  if (depth === 4) return 'h4';
  if (depth === 5) return 'h5';
  return 'h6';
};

const childIdx = (index: number) => `${props.tokenIdx ? `${props.tokenIdx}-` : ''}${index}`;

type ApplyUri = URI | 'current';

type View =
  | { kind: 'empty' }
  | { kind: 'space'; raw: string }
  | { kind: 'mermaid'; contents: string }
  | {
      kind: 'apply';
      contents: string;
      language: string;
      applyBoxId: string;
      canApply: boolean;
      uri: ApplyUri;
    }
  | { kind: 'code'; contents: string; language: string }
  | { kind: 'heading'; tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; text: string }
  | {
      kind: 'table';
      header: { key: number; text: string }[];
      rows: { key: number; cells: { key: number; text: string }[] }[];
    }
  | { kind: 'hr' }
  | { kind: 'blockquote'; text: string }
  | { kind: 'list_item'; checked?: boolean; text: string }
  | {
      kind: 'list';
      ordered: boolean;
      start: number | undefined;
      items: { key: number; task: boolean; checked?: boolean; text: string }[];
    }
  | { kind: 'paragraph-latex'; segments: LatexSegment[] }
  | { kind: 'paragraph'; tokens: Token[] }
  | {
      kind: 'inline';
      tag: 'span' | 'strong' | 'em' | 'del';
      nested?: Token[];
      fallback: string;
      disableAutoLink?: boolean;
    }
  | {
      kind: 'link';
      href: string;
      title?: string;
      safe: boolean;
      nested?: Token[];
      fallback: string;
    }
  | { kind: 'image'; href: string; alt: string; title?: string }
  | { kind: 'codespan-link'; text: string; raw: string }
  | { kind: 'codespan'; text: string }
  | { kind: 'br' }
  | { kind: 'def' }
  | { kind: 'unknown' };

const view = computed((): View => {
  const t = props.token as MarkedToken;
  if (t.raw.trim() === '') return { kind: 'empty' };

  if (t.type === 'space') return { kind: 'space', raw: t.raw };

  if (t.type === 'code') {
    const code = t as Tokens.Code;
    const [firstLine, remainingContents] = separateOutFirstLine(code.text);
    const firstLineIsURI = isValidUri(firstLine) && !props.codeURI;
    const contents = firstLineIsURI ? remainingContents?.trimStart() || '' : code.text; // первая строка — URI файла, не код
    if (!contents) return { kind: 'empty' };
    if ((code.lang || '').toLowerCase() === 'mermaid') {
      return { kind: 'mermaid', contents };
    }

    let uri: URI | null;
    if (props.codeURI) {
      uri = props.codeURI;
    } else if (firstLineIsURI) {
      uri = URI.file(firstLine);
    } else {
      uri = null;
    }

    let language: string;
    if (code.lang) {
      language = convertToVscodeLang(languageService, code.lang);
    } else {
      language = detectLanguage(languageService, { uri, fileContents: contents });
    }

    if (props.isApplyEnabled && props.chatMessageLocation) {
      const isCodeblockClosed = code.raw.trimEnd().endsWith('```');
      const applyBoxId = getApplyBoxId({
        threadId: props.chatMessageLocation.threadId,
        messageIdx: props.chatMessageLocation.messageIdx,
        tokenIdx: props.tokenIdx,
      });
      return {
        kind: 'apply',
        contents,
        language,
        applyBoxId,
        canApply: isCodeblockClosed,
        uri: uri || 'current',
      };
    }
    return { kind: 'code', contents, language };
  }

  if (t.type === 'heading') {
    return { kind: 'heading', tag: headingTag(t.depth), text: t.text };
  }

  if (t.type === 'table') {
    const table = t as Tokens.Table;
    return {
      kind: 'table',
      header: table.header.map((h, hIdx) => ({ key: hIdx, text: h.text })),
      rows: table.rows.map((row, rowIdx) => ({
        key: rowIdx,
        cells: row.map((cell, rIdx) => ({ key: rIdx, text: cell.text })),
      })),
    };
  }

  if (t.type === 'hr') return { kind: 'hr' };
  if (t.type === 'blockquote') return { kind: 'blockquote', text: t.text };

  if (t.type === 'list_item') {
    const item = t as Tokens.ListItem;
    return { kind: 'list_item', checked: item.checked, text: item.text };
  }

  if (t.type === 'list') {
    const list = t as Tokens.List;
    return {
      kind: 'list',
      ordered: list.ordered,
      start: typeof list.start === 'number' && list.start > 0 ? list.start : undefined,
      items: list.items.map((item, index) => ({
        key: index,
        task: item.task,
        checked: item.checked,
        text: item.text,
      })),
    };
  }

  if (t.type === 'paragraph') {
    const latexSegments = paragraphToLatexSegments(t.raw);
    if (latexSegments.length !== 0) {
      return { kind: 'paragraph-latex', segments: latexSegments };
    }
    return { kind: 'paragraph', tokens: t.tokens };
  }

  if (t.type === 'text' || t.type === 'escape' || t.type === 'html') {
    const nested = inlineTokensOf(t);
    const text = t.type === 'html' ? t.raw : t.text;
    return {
      kind: 'inline',
      tag: 'span',
      nested,
      fallback: text,
      disableAutoLink: props.disableAutoLink,
    };
  }

  if (t.type === 'def') return { kind: 'def' };

  if (t.type === 'link') {
    return {
      kind: 'link',
      href: t.href,
      title: t.title ?? undefined,
      safe: isSafeExternalHref(t.href),
      nested: inlineTokensOf(t),
      fallback: t.text,
    };
  }

  if (t.type === 'image') {
    return { kind: 'image', href: t.href, alt: t.text, title: t.title ?? undefined };
  }

  if (t.type === 'strong') {
    return { kind: 'inline', tag: 'strong', nested: inlineTokensOf(t), fallback: t.text };
  }
  if (t.type === 'em') {
    return { kind: 'inline', tag: 'em', nested: inlineTokensOf(t), fallback: t.text };
  }

  if (t.type === 'codespan') {
    if (props.isLinkDetectionEnabled && props.chatMessageLocation) {
      return { kind: 'codespan-link', text: t.text, raw: t.raw };
    }
    return { kind: 'codespan', text: t.text };
  }

  if (t.type === 'br') return { kind: 'br' };
  if (t.type === 'del') {
    return { kind: 'inline', tag: 'del', nested: inlineTokensOf(t), fallback: t.text };
  }

  return { kind: 'unknown' };
});
</script>

<template>
  <template v-if="view.kind === 'empty' || view.kind === 'def'" />
  <span v-else-if="view.kind === 'space'">{{ view.raw }}</span>
  <MermaidBlock v-else-if="view.kind === 'mermaid'" :code="view.contents" />
  <BlockCodeApplyWrapper
    v-else-if="view.kind === 'apply' && chatMessageLocation"
    :canApply="view.canApply"
    :applyBoxId="view.applyBoxId"
    :codeStr="view.contents"
    :language="view.language"
    :uri="view.uri"
  >
    <BlockCode :initValue="view.contents.trimEnd()" :language="view.language" />
  </BlockCodeApplyWrapper>
  <BlockCode
    v-else-if="view.kind === 'code'"
    :initValue="view.contents"
    :language="view.language"
  />
  <component :is="view.tag" v-else-if="view.kind === 'heading'">
    <ChatMarkdownRender
      :chatMessageLocation="chatMessageLocation"
      :string="view.text"
      inPTag
      :codeURI="codeURI"
      :isApplyEnabled="isApplyEnabled"
      :isLinkDetectionEnabled="isLinkDetectionEnabled"
      :disableAutoLink="disableAutoLink"
    />
  </component>
  <div v-else-if="view.kind === 'table'">
    <table>
      <thead>
        <tr>
          <th v-for="h in view.header" :key="h.key">{{ h.text }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in view.rows" :key="row.key">
          <td v-for="cell in row.cells" :key="cell.key">{{ cell.text }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <hr v-else-if="view.kind === 'hr'" />
  <blockquote v-else-if="view.kind === 'blockquote'">{{ view.text }}</blockquote>
  <li v-else-if="view.kind === 'list_item'">
    <input type="checkbox" :checked="view.checked" readonly />
    <span>
      <ChatMarkdownRender
        :chatMessageLocation="chatMessageLocation"
        :string="view.text"
        inPTag
        :codeURI="codeURI"
        :isApplyEnabled="isApplyEnabled"
        :isLinkDetectionEnabled="isLinkDetectionEnabled"
        :disableAutoLink="disableAutoLink"
      />
    </span>
  </li>
  <component
    :is="view.ordered ? 'ol' : 'ul'"
    v-else-if="view.kind === 'list'"
    :start="view.start"
  >
    <li v-for="item in view.items" :key="item.key">
      <input v-if="item.task" type="checkbox" :checked="item.checked" readonly />
      <span>
        <ChatMarkdownRender
          :chatMessageLocation="chatMessageLocation"
          :string="item.text"
          inPTag
          :isApplyEnabled="isApplyEnabled"
          :isLinkDetectionEnabled="isLinkDetectionEnabled"
          :disableAutoLink="disableAutoLink"
        />
      </span>
    </li>
  </component>
  <span v-else-if="view.kind === 'paragraph-latex' && inPTag" class="block">
    <template v-for="segment in view.segments" :key="segment.key">
      <span v-if="segment.kind === 'text'">
        <LinkifiedText :result="segment.content" />
      </span>
      <LatexRender v-else :latex="segment.latex" />
    </template>
  </span>
  <p v-else-if="view.kind === 'paragraph-latex'">
    <template v-for="segment in view.segments" :key="segment.key">
      <span v-if="segment.kind === 'text'">
        <LinkifiedText :result="segment.content" />
      </span>
      <LatexRender v-else :latex="segment.latex" />
    </template>
  </p>
  <span v-else-if="view.kind === 'paragraph' && inPTag" class="block">
    <RenderToken
      v-for="(child, index) in view.tokens"
      :key="index"
      :token="child"
      :tokenIdx="childIdx(index)"
      :chatMessageLocation="chatMessageLocation"
      inPTag
      :isApplyEnabled="isApplyEnabled"
      :isLinkDetectionEnabled="isLinkDetectionEnabled"
      :disableAutoLink="disableAutoLink"
    />
  </span>
  <p v-else-if="view.kind === 'paragraph'">
    <RenderToken
      v-for="(child, index) in view.tokens"
      :key="index"
      :token="child"
      :tokenIdx="childIdx(index)"
      :chatMessageLocation="chatMessageLocation"
      inPTag
      :isApplyEnabled="isApplyEnabled"
      :isLinkDetectionEnabled="isLinkDetectionEnabled"
      :disableAutoLink="disableAutoLink"
    />
  </p>
  <component :is="view.tag" v-else-if="view.kind === 'inline'">
    <TokenBody
      :nested="view.nested"
      :fallback="view.fallback"
      :disableAutoLink="view.disableAutoLink"
      :inPTag="inPTag"
      :codeURI="codeURI"
      :chatMessageLocation="chatMessageLocation"
      :tokenIdx="tokenIdx"
      :isApplyEnabled="isApplyEnabled"
      :isLinkDetectionEnabled="isLinkDetectionEnabled"
    />
  </component>
  <span v-else-if="view.kind === 'link' && !view.safe">
    <TokenBody
      :nested="view.nested"
      :fallback="view.fallback"
      disableAutoLink
      :inPTag="inPTag"
      :codeURI="codeURI"
      :chatMessageLocation="chatMessageLocation"
      :tokenIdx="tokenIdx"
      :isApplyEnabled="isApplyEnabled"
      :isLinkDetectionEnabled="isLinkDetectionEnabled"
    />
  </span>
  <ExternalLink v-else-if="view.kind === 'link'" :href="view.href" :title="view.title">
    <TokenBody
      :nested="view.nested"
      :fallback="view.fallback"
      disableAutoLink
      :inPTag="inPTag"
      :codeURI="codeURI"
      :chatMessageLocation="chatMessageLocation"
      :tokenIdx="tokenIdx"
      :isApplyEnabled="isApplyEnabled"
      :isLinkDetectionEnabled="isLinkDetectionEnabled"
    />
  </ExternalLink>
  <img
    v-else-if="view.kind === 'image'"
    :src="view.href"
    :alt="view.alt"
    :title="view.title"
  />
  <CodespanWithLink
    v-else-if="view.kind === 'codespan-link' && chatMessageLocation"
    :text="view.text"
    :rawText="view.raw"
    :chatMessageLocation="chatMessageLocation"
  />
  <Codespan v-else-if="view.kind === 'codespan'" :text="view.text" />
  <br v-else-if="view.kind === 'br'" />
  <div v-else class="bg-orange-50 rounded-sm overflow-hidden p-2">
    <span class="text-sm text-orange-500">Unknown token rendered...</span>
  </div>
</template>
