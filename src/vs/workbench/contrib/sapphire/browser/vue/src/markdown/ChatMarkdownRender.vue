<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, inject, provide } from 'vue';
import { marked, type Token } from 'marked';
import { URI } from '../../../../../../../base/common/uri.js';
import { uniquePathLabels } from '../../../../common/pathLabels.js';
import {
  collectPathLikeCodespans,
  shortenedPathKey,
  type ChatMessageLocation,
} from './ChatMarkdownRender.js';
import RenderToken from './RenderToken.vue';

const props = withDefaults(
  defineProps<{
    string: string;
    inPTag?: boolean;
    codeURI?: URI;
    chatMessageLocation?: ChatMessageLocation;
    isApplyEnabled?: boolean;
    isLinkDetectionEnabled?: boolean;
    disableAutoLink?: boolean;
  }>(),
  { inPTag: false },
);

const parentShortened = inject(shortenedPathKey, null);

const normalized = computed(() => props.string.replaceAll('\n•', '\n\n•'));
const tokens = computed(() => marked.lexer(normalized.value) as Token[]);

const shortenedByOriginal = computed(() => {
  if (parentShortened) return parentShortened.value;
  const pathCodespans = collectPathLikeCodespans(tokens.value);
  const unique = uniquePathLabels(pathCodespans);
  return Object.fromEntries(pathCodespans.map((p, i) => [p, unique[i] ?? p]));
});

provide(shortenedPathKey, shortenedByOriginal);
</script>

<template>
  <RenderToken
    v-for="(token, index) in tokens"
    :key="index"
    :token="token"
    :inPTag="inPTag"
    :codeURI="codeURI"
    :chatMessageLocation="chatMessageLocation"
    :tokenIdx="String(index)"
    :isApplyEnabled="isApplyEnabled"
    :isLinkDetectionEnabled="isLinkDetectionEnabled"
    :disableAutoLink="disableAutoLink"
  />
</template>
