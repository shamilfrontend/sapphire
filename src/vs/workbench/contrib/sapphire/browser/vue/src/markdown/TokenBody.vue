<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { Token } from 'marked';
import { URI } from '../../../../../../../base/common/uri.js';
import { linkifyPlainText, type ChatMessageLocation } from './ChatMarkdownRender.js';
import LinkifiedText from './LinkifiedText.vue';
import RenderToken from './RenderToken.vue';

const props = defineProps<{
  nested?: Token[];
  fallback: string;
  disableAutoLink?: boolean;
  inPTag?: boolean;
  codeURI?: URI;
  chatMessageLocation?: ChatMessageLocation;
  tokenIdx: string;
  isApplyEnabled?: boolean;
  isLinkDetectionEnabled?: boolean;
}>();

const childIdx = (index: number) => `${props.tokenIdx ? `${props.tokenIdx}-` : ''}${index}`;
</script>

<template>
  <template v-if="nested?.length">
    <RenderToken
      v-for="(child, index) in nested"
      :key="index"
      :token="child"
      :inPTag="inPTag"
      :codeURI="codeURI"
      :chatMessageLocation="chatMessageLocation"
      :tokenIdx="childIdx(index)"
      :isApplyEnabled="isApplyEnabled"
      :isLinkDetectionEnabled="isLinkDetectionEnabled"
      :disableAutoLink="disableAutoLink"
    />
  </template>
  <template v-else-if="disableAutoLink">{{ fallback }}</template>
  <LinkifiedText v-else :result="linkifyPlainText(fallback)" />
</template>
