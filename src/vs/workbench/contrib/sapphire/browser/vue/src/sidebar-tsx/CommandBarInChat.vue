<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref, watch } from 'vue';
import { ChevronRight } from 'lucide-vue-next';
import { useAccessor, useCommandBarState } from '../util/services.js';
import { getIconClasses } from '../../../../../../../editor/common/services/getIconClasses.js';
import { FileKind } from '../../../../../../../platform/files/common/files.js';
import { getBasename } from '../../../../common/pathLabels.js';
import { useAgentsReview } from '../agents-window-tsx/AgentsReviewContext.js';
import { sapphireOpenFileFn } from './chatFileUtils.js';
import { countDiffLineStats, filesCountLabel } from './sidebarChatShared.js';

const review = useAgentsReview();
const commandBar = useCommandBarState();
const sortedCommandBarURIs = computed(() => commandBar.value.sortedURIs);
const commandBarStateOfURI = computed(() => commandBar.value.stateOfURI);
const numFilesChanged = computed(() => sortedCommandBarURIs.value.length);

const accessor = useAccessor();
const editCodeService = accessor.get('IEditCodeService');
const sapphireCommandBarService = accessor.get('ISapphireCommandBarService');
const modelService = accessor.get('IModelService');
const languageService = accessor.get('ILanguageService');

const fileDetailsOpenedState = ref<'auto-opened' | 'auto-closed' | 'user-opened' | 'user-closed'>(
  'auto-closed',
);
const isFileDetailsOpened = computed(
  () => fileDetailsOpenedState.value === 'auto-opened' || fileDetailsOpenedState.value === 'user-opened',
);

watch(
  [fileDetailsOpenedState, numFilesChanged],
  () => {
    if (numFilesChanged.value === 0) {
      fileDetailsOpenedState.value = 'auto-closed';
    } else if (fileDetailsOpenedState.value !== 'user-closed') {
      fileDetailsOpenedState.value = 'auto-opened';
    }
  },
  { immediate: true },
);

const isFinishedMakingThreadChanges = computed(
  () =>
    numFilesChanged.value !== 0 &&
    sortedCommandBarURIs.value.every((uri) => !commandBarStateOfURI.value[uri.fsPath]?.isStreaming),
);

const onRejectAll = () => {
  sortedCommandBarURIs.value.forEach((uri) => {
    editCodeService.acceptOrRejectAllDiffAreas({
      uri,
      removeCtrlKs: true,
      behavior: 'reject',
      _addToHistory: true,
    });
  });
};

const onAcceptAll = () => {
  sortedCommandBarURIs.value.forEach((uri) => {
    editCodeService.acceptOrRejectAllDiffAreas({
      uri,
      removeCtrlKs: true,
      behavior: 'accept',
      _addToHistory: true,
    });
  });
};

const onReview = () => {
  if (review) {
    review.openReview(sortedCommandBarURIs.value[0]?.fsPath);
    return;
  }
  void sapphireCommandBarService.goToURIIdx(0);
};

const toggleDetails = () => {
  fileDetailsOpenedState.value = isFileDetailsOpened.value ? 'user-closed' : 'user-opened';
};

const openUri = (fsPath: string, uri: (typeof sortedCommandBarURIs.value)[number]) => {
  if (review) {
    review.openReview(fsPath);
    return;
  }
  sapphireOpenFileFn(uri, accessor);
};

const rowOf = (uri: (typeof sortedCommandBarURIs.value)[number]) => {
  const basename = getBasename(uri.fsPath);
  const { sortedDiffIds } = commandBarStateOfURI.value[uri.fsPath] ?? {};
  const { added, removed } = countDiffLineStats(sortedDiffIds, editCodeService.diffOfId);
  const iconClasses = getIconClasses(modelService, languageService, uri, FileKind.FILE).join(' ');
  return { basename, added, removed, iconClasses };
};
</script>

<template>
  <div
    v-if="numFilesChanged !== 0"
    class="select-none w-full rounded-t-lg bg-void-bg-3 text-void-fg-3 text-xs border-t border-l border-r border-void-border-3 overflow-hidden"
  >
    <div class="flex w-full items-center justify-between px-2 py-1">
      <button
        type="button"
        class="flex items-center gap-1 cursor-pointer hover:brightness-125 transition-all duration-200"
        @click="toggleDetails"
      >
        <ChevronRight
          class="size-3.5 transition-transform duration-200"
          :style="{
            transform: isFileDetailsOpened ? 'rotate(90deg)' : 'rotate(0deg)',
          }"
        />
        <span>{{ filesCountLabel(numFilesChanged) }}</span>
      </button>

      <div class="flex items-center gap-2">
        <template v-if="isFinishedMakingThreadChanges">
          <button
            type="button"
            class="px-1 py-0.5 text-void-fg-3 hover:text-void-fg-1 transition-colors cursor-pointer"
            @click="onRejectAll"
          >
            Отменить все
          </button>
          <button
            type="button"
            class="px-1 py-0.5 text-void-fg-3 hover:text-void-fg-1 transition-colors cursor-pointer"
            @click="onAcceptAll"
          >
            Оставить все
          </button>
        </template>
        <button
          type="button"
          class="px-2 py-0.5 rounded bg-void-bg-2 text-void-fg-1 hover:brightness-125 transition-all cursor-pointer border border-void-border-2"
          @click="onReview"
        >
          Проверить
        </button>
      </div>
    </div>

    <div
      :class="`
					overflow-hidden transition-all duration-200 ease-in-out
					${isFileDetailsOpened ? 'max-h-64' : 'max-h-0'}
				`"
    >
      <div class="px-2 pb-1.5 flex flex-col gap-0.5 overflow-y-auto max-h-64 show-file-icons">
        <div
          v-for="uri in sortedCommandBarURIs"
          :key="uri.fsPath"
          class="flex items-center gap-1.5 py-0.5 cursor-pointer hover:brightness-125 transition-all duration-200 min-w-0"
          @click="openUri(uri.fsPath, uri)"
        >
          <span
            :class="`monaco-icon-label ${rowOf(uri).iconClasses} shrink-0`"
            :style="{ width: 16, height: 16, paddingLeft: 16 }"
          />
          <span class="truncate text-void-fg-2">{{ rowOf(uri).basename }}</span>
          <span class="flex items-center gap-1.5 shrink-0 ml-1 font-mono tabular-nums">
            <span v-if="rowOf(uri).added > 0" class="text-green-500">+{{ rowOf(uri).added }}</span>
            <span v-if="rowOf(uri).removed > 0" class="text-red-500">-{{ rowOf(uri).removed }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
