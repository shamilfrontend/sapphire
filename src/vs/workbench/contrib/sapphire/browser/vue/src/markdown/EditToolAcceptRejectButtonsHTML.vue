<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { Check, X } from 'lucide-vue-next';
import { URI } from '../../../../../../../base/common/uri.js';
import { isFeatureNameDisabled } from '../../../../common/sapphireSettingsTypes.js';
import {
  useAccessor,
  useChatThreadsStreamState,
  useSettingsState,
} from '../util/services.js';
import { tooltipPropsForApplyBlock, useEditToolStreamState } from './ApplyBlockHoverButtons.js';
import IconShell1 from './IconShell1.vue';

const props = defineProps<{
  codeStr: string;
  applyBoxId: string;
  uri: URI;
  type: 'edit_file' | 'rewrite_file';
  threadId: string;
}>();

const accessor = useAccessor();
const editCodeService = accessor.get('IEditCodeService');
const settingsState = useSettingsState();
const { streamState } = useEditToolStreamState({
  applyBoxId: () => props.applyBoxId,
  uri: () => props.uri,
});
const chatThreadsStreamState = useChatThreadsStreamState(() => props.threadId);
const isRunning = computed(() => chatThreadsStreamState.value?.isRunning);
const isDisabled = computed(
  () => !!isFeatureNameDisabled('Chat', settingsState.value) || !props.applyBoxId,
);

const showActions = computed(
  () =>
    !isDisabled.value &&
    streamState.value === 'idle-has-changes' &&
    isRunning.value !== 'LLM' &&
    isRunning.value !== 'tool' &&
    isRunning.value !== 'preparing',
);

const onAccept = () => {
  editCodeService.acceptOrRejectAllDiffAreas({
    uri: props.uri,
    behavior: 'accept',
    removeCtrlKs: false,
  });
};

const onReject = () => {
  editCodeService.acceptOrRejectAllDiffAreas({
    uri: props.uri,
    behavior: 'reject',
    removeCtrlKs: false,
  });
};
</script>

<template>
  <template v-if="showActions">
    <IconShell1
      :Icon="X"
      v-bind="tooltipPropsForApplyBlock({ tooltipName: 'Отклонить' })"
      @click="onReject"
    />
    <IconShell1
      :Icon="Check"
      v-bind="tooltipPropsForApplyBlock({ tooltipName: 'Оставить' })"
      @click="onAccept"
    />
  </template>
</template>
