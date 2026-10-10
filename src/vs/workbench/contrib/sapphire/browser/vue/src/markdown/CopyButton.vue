<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref, watch } from 'vue';
import { Check, Copy, X } from 'lucide-vue-next';
import { useAccessor } from '../util/services.js';
import IconShell1 from './IconShell1.vue';
import {
  COPY_FEEDBACK_TIMEOUT,
  CopyButtonText,
  tooltipPropsForApplyBlock,
} from './ApplyBlockHoverButtons.js';

const props = defineProps<{
  codeStr: string | (() => Promise<string> | string);
  toolTipName: string;
}>();

const accessor = useAccessor();
const clipboardService = accessor.get('IClipboardService');
const copyButtonText = ref(CopyButtonText.Idle);

watch(copyButtonText, (text) => {
  if (text === CopyButtonText.Idle) return;
  setTimeout(() => {
    copyButtonText.value = CopyButtonText.Idle;
  }, COPY_FEEDBACK_TIMEOUT);
});

const onCopy = async () => {
  clipboardService
    .writeText(typeof props.codeStr === 'string' ? props.codeStr : await props.codeStr())
    .then(() => {
      copyButtonText.value = CopyButtonText.Copied;
    })
    .catch(() => {
      copyButtonText.value = CopyButtonText.Error;
    });
};

const copyIcon = computed(() =>
  copyButtonText.value === CopyButtonText.Copied
    ? Check
    : copyButtonText.value === CopyButtonText.Error
      ? X
      : Copy,
);
</script>

<template>
  <IconShell1
    :Icon="copyIcon"
    v-bind="tooltipPropsForApplyBlock({ tooltipName: toolTipName })"
    @click="onCopy"
  />
</template>
