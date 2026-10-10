<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ref } from 'vue';
import { Play, X } from 'lucide-vue-next';
import { URI } from '../../../../../../../base/common/uri.js';
import { useAccessor } from '../util/services.js';
import { tooltipPropsForApplyBlock } from './ApplyBlockHoverButtons.js';
import IconShell1 from './IconShell1.vue';

defineProps<{
  codeStr: string;
  applyBoxId: string;
  language?: string;
  uri: URI | 'current';
}>();

const accessor = useAccessor();
const terminalToolService = accessor.get('ITerminalToolService');

const isShellRunning = ref(false);
const interruptToolRef = ref<(() => void) | null>(null);

const onClickSubmit = async (codeStr: string) => {
  if (isShellRunning.value) return;
  try {
    isShellRunning.value = true;
    const terminalId = await terminalToolService.createPersistentTerminal({ cwd: null });
    const { interrupt } = await terminalToolService.runCommand(codeStr, {
      type: 'persistent',
      persistentTerminalId: terminalId,
    });
    interruptToolRef.value = interrupt;
  } catch (e) {
    isShellRunning.value = false;
    console.error('Failed to execute in terminal:', e);
  }
};

const onStop = () => {
  interruptToolRef.value?.();
  isShellRunning.value = false;
};
</script>

<template>
  <IconShell1
    v-if="isShellRunning"
    :Icon="X"
    v-bind="tooltipPropsForApplyBlock({ tooltipName: 'Стоп' })"
    @click="onStop"
  />
  <IconShell1
    v-else
    :Icon="Play"
    v-bind="tooltipPropsForApplyBlock({ tooltipName: 'Применить' })"
    @click="onClickSubmit(codeStr)"
  />
</template>
