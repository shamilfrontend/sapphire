<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { FileSymlink } from 'lucide-vue-next';
import { URI } from '../../../../../../../base/common/uri.js';
import { sapphireOpenFileFn } from '../sidebar-tsx/chatFileUtils.js';
import { useAccessor } from '../util/services.js';
import { tooltipPropsForApplyBlock } from './ApplyBlockHoverButtons.js';
import IconShell1 from './IconShell1.vue';

const props = defineProps<{ uri: URI | 'current' }>();

const accessor = useAccessor();

const open = () => {
  if (props.uri === 'current') return;
  sapphireOpenFileFn(props.uri, accessor);
};
</script>

<template>
  <IconShell1
    v-if="uri !== 'current'"
    :Icon="FileSymlink"
    v-bind="tooltipPropsForApplyBlock({ tooltipName: 'Перейти к файлу' })"
    @click="open"
  />
</template>
