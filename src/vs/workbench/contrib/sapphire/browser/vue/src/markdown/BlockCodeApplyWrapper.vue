<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { URI } from '../../../../../../../base/common/uri.js';
import { getBasename } from '../../../../common/pathLabels.js';
import { sapphireOpenFileFn } from '../sidebar-tsx/chatFileUtils.js';
import { useAccessor } from '../util/services.js';
import ToolChildrenWrapper from '../sidebar-tsx/ToolChildrenWrapper.vue';
import ApplyButtonsForEdit from './ApplyButtonsForEdit.vue';
import ApplyButtonsForTerminal from './ApplyButtonsForTerminal.vue';
import CopyButton from './CopyButton.vue';
import JumpToFileButton from './JumpToFileButton.vue';
import StatusIndicatorForApplyButton from './StatusIndicatorForApplyButton.vue';
import { terminalLanguages, useApplyStreamState } from './ApplyBlockHoverButtons.js';

const props = defineProps<{
  codeStr: string;
  applyBoxId: string;
  canApply: boolean;
  language: string;
  uri: URI | 'current';
}>();

const accessor = useAccessor();
const { currStreamStateRef } = useApplyStreamState(() => props.applyBoxId);
const currStreamState = computed(() => currStreamStateRef.current);
const isShellLanguage = computed(() => !!props.language && terminalLanguages.has(props.language));

const fileLabel = computed(() =>
  props.uri === 'current' ? '' : getBasename(props.uri.fsPath),
);

const openFile = () => {
  if (props.uri === 'current') return;
  sapphireOpenFileFn(props.uri, accessor);
};
</script>

<template>
  <div class="border border-void-border-3 rounded overflow-hidden bg-void-bg-3 my-1">
    <!-- Заголовок карточки -->
    <div
      class=" select-none flex justify-between items-center py-1 px-2 border-b border-void-border-3 cursor-default"
    >
      <div class="flex items-center">
        <StatusIndicatorForApplyButton :uri="uri" :applyBoxId="applyBoxId" />
        <span class="text-[13px] font-light text-void-fg-3">
          <div
            v-if="uri !== 'current'"
            class="hover:brightness-125 hover:cursor-pointer transition-all duration-200 flex items-center flex-nowrap whitespace-nowrap"
            @click="openFile"
          >
            <div class="italic text-void-fg-4 flex items-center">
              <span class="not-italic">{{ fileLabel }}</span>
            </div>
          </div>
          <span v-else>{{ language }}</span>
        </span>
      </div>
      <div :class="`${canApply ? '' : 'hidden'} flex items-center gap-1`">
        <JumpToFileButton :uri="uri" />
        <CopyButton
          v-if="currStreamState === 'idle-no-changes'"
          :codeStr="codeStr"
          toolTipName="Копировать"
        />
        <ApplyButtonsForTerminal
          v-if="isShellLanguage"
          :uri="uri"
          :applyBoxId="applyBoxId"
          :codeStr="codeStr"
          :language="language"
        />
        <ApplyButtonsForEdit
          v-else
          :uri="uri"
          :applyBoxId="applyBoxId"
          :codeStr="codeStr"
          :language="language"
        />
      </div>
    </div>

    <!-- Содержимое блока Apply -->
    <ToolChildrenWrapper>
      <slot />
    </ToolChildrenWrapper>
  </div>
</template>
