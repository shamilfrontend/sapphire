<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { URI } from '../../../../../../../base/common/uri.js';
import { tooltipPropsForApplyBlock, useApplyStreamState } from './ApplyBlockHoverButtons.js';
import StatusIndicator from './StatusIndicator.vue';

const props = defineProps<{
  applyBoxId: string;
  uri: URI | 'current';
}>();

const { currStreamStateRef } = useApplyStreamState(() => props.applyBoxId);
const currStreamState = computed(() => currStreamStateRef.current);

const color = computed(() =>
  currStreamState.value === 'idle-no-changes'
    ? 'dark'
    : currStreamState.value === 'streaming'
      ? 'orange'
      : currStreamState.value === 'idle-has-changes'
        ? 'green'
        : null,
);

const tooltipName = computed(() =>
  currStreamState.value === 'idle-no-changes'
    ? 'Готово'
    : currStreamState.value === 'streaming'
      ? 'Применение'
      : currStreamState.value === 'idle-has-changes'
        ? 'Готово' // «Applied» в UI смотрелось хуже
        : '',
);
</script>

<template>
  <StatusIndicator
    :key="currStreamState"
    class="mx-2"
    :indicatorColor="color"
    v-bind="
      tooltipPropsForApplyBlock({
        tooltipName,
        color,
        position: 'top',
        offset: 12,
      })
    "
  />
</template>
