<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { CSSProperties } from 'vue';
import { useAccessor } from '../util/services.js';
import { isSafeExternalHref } from './ChatMarkdownRender.js';

defineProps<{
  href: string;
  title?: string;
}>();

const accessor = useAccessor();

const externalLinkStyle: CSSProperties = {
  color: 'var(--vscode-textLink-foreground)',
  textDecoration: 'underline',
  cursor: 'pointer',
};

const open = (href: string) => {
  if (!isSafeExternalHref(href)) return;
  void accessor.get('INativeHostService').openExternal(href);
};
</script>

<template>
  <a
    :href="href"
    :title="title ?? href"
    :style="externalLinkStyle"
    @click.prevent.stop="open(href)"
  >
    <slot />
  </a>
</template>
