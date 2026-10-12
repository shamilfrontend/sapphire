<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import SapphireCustomDropdownBox from '../util/SapphireCustomDropdownBox.vue';
import { useAccessor, useSettingsState } from '../util/services.js';

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const settingsState = useSettingsState();

const options: boolean[] = [true, false];

const selectedOption = computed(() => settingsState.value.globalSettings.enableFastApply);

const onChangeOption = (newVal: boolean) => {
  sapphireSettingsService.setGlobalSetting('enableFastApply', newVal);
};

const displayName = (val: boolean) => (val ? 'Быстрый Apply' : 'Обычный Apply');
const detail = (val: boolean) => (val ? 'Блоки Search/Replace' : 'Перезапись всего файла');
const optionsEqual = (a: boolean, b: boolean) => a === b;
</script>

<template>
  <SapphireCustomDropdownBox
    class="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
    :options="options"
    :selectedOption="selectedOption"
    :getOptionDisplayName="displayName"
    :getOptionDropdownName="displayName"
    :getOptionDropdownDetail="detail"
    :getOptionsEqual="optionsEqual"
    @changeOption="onChangeOption"
  />
</template>
