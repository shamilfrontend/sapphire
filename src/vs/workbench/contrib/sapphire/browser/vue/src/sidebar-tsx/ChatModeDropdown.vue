<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useAccessor } from '../util/services.js';
import SapphireCustomDropdownBox from '../util/SapphireCustomDropdownBox.vue';
import { ChatMode } from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import {
  accentOfChatMode,
  detailOfChatMode,
  iconOfChatMode,
  nameOfChatMode,
  useCurrentThreadChatMode,
} from './ChatComposer.js';

defineProps<{ iconOnly: boolean }>();

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');
const chatMode = useCurrentThreadChatMode();

const options: ChatMode[] = ['agent', 'plan', 'normal'];

const onChangeOption = (newVal: ChatMode) => {
  chatThreadsService.setThreadChatMode(chatThreadsService.state.currentThreadId, newVal);
};

const displayName = (val: ChatMode) => nameOfChatMode[val];
const dropdownName = (val: ChatMode) => nameOfChatMode[val];
const dropdownDetail = (val: ChatMode) => detailOfChatMode[val];
const dropdownAccent = (val: ChatMode) => accentOfChatMode[val];
const dropdownIcon = (val: ChatMode) => iconOfChatMode(val);
const optionsEqual = (a: ChatMode, b: ChatMode) => a === b;
</script>

<template>
  <SapphireCustomDropdownBox
    :class="`text-xs rounded-md py-0.5 border border-void-border-2 shrink-0 ${iconOnly ? 'px-1.5' : 'px-2'}`"
    :iconOnly="iconOnly"
    :options="options"
    :selectedOption="chatMode"
    :onChangeOption="onChangeOption"
    :getOptionDisplayName="displayName"
    :getOptionDropdownName="dropdownName"
    :getOptionDropdownDetail="dropdownDetail"
    :getOptionDropdownAccent="dropdownAccent"
    :getOptionDropdownIcon="dropdownIcon"
    :getOptionsEqual="optionsEqual"
    detailAsTooltip
    selectedCheckOnRight
    :accentFillSelected="false"
  />
</template>
