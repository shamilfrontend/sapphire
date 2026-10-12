<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import ExternalLink from './ExternalLink.vue';
import type { LinkifyResult } from './ChatMarkdownRender.js';

defineProps<{ result: LinkifyResult }>();
</script>

<template>
  <template v-if="result.kind === 'plain'">{{ result.text }}</template>
  <template v-else>
    <template v-for="part in result.parts" :key="part.key">
      <span v-if="part.kind === 'text'">{{ part.text }}</span>
      <ExternalLink v-else :href="part.href">{{ part.label }}</ExternalLink>
    </template>
  </template>
</template>
