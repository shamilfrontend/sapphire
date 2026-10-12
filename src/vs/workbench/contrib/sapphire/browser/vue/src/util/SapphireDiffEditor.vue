<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { URI } from '../../../../../../../base/common/uri.js';
import { useAccessor } from './services.js';
import {
  extractSearchReplaceBlocks,
} from '../../../../common/helpers/extractCodeFromResult.js';
import { detectLanguage } from '../../../../common/helpers/languageHelpers.js';
import SingleDiffEditor from './SingleDiffEditor.vue';

const props = defineProps<{
  uri?: URI | null;
  searchReplaceBlocks: string;
  language?: string;
}>();

const accessor = useAccessor();
const languageService = accessor.get('ILanguageService');

// Парсим все блоки из строки инструмента
const blocks = computed(() => extractSearchReplaceBlocks(props.searchReplaceBlocks));

// Язык по uri/содержимому, если не передан явно
const lang = computed(() => {
  if (props.language) return props.language;
  const parsed = blocks.value;
  if (parsed.length > 0) {
    return detectLanguage(languageService, {
      uri: props.uri ?? null,
      fileContents: parsed[0].orig,
    });
  }
  return undefined;
});
</script>

<template>
  <!-- Пустой ответ — заглушка без редактора -->
  <div v-if="blocks.length === 0" class="w-full p-4 text-void-fg-4 text-sm">No changes found</div>
  <!-- Несколько блоков — колонка diff-редакторов -->
  <div v-else class="w-full flex flex-col gap-2">
    <div v-for="(block, index) in blocks" :key="index" class="w-full">
      <div v-if="blocks.length > 1" class="text-void-fg-4 text-xs mb-1 px-1">
        Change {{ index + 1 }} of {{ blocks.length }}
      </div>
      <SingleDiffEditor :block="block" :lang="lang" />
    </div>
  </div>
</template>
