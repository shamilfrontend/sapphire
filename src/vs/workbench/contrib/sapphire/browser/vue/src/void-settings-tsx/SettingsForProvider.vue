<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import {
  ProviderName,
  customSettingNamesOfProvider,
  displayInfoOfProviderName,
  isProviderNameDisabled,
} from '../../../../common/sapphireSettingsTypes.js';
import { useSettingsState } from '../util/services.js';
import WarningBox from './WarningBox.vue';
import ProviderSetting from './ProviderSetting.vue';

const props = defineProps<{
  providerName: ProviderName;
  showProviderTitle: boolean;
  showProviderSuggestions: boolean;
}>();

const sapphireSettingsState = useSettingsState();

const needsModel = computed(
  () =>
    isProviderNameDisabled(props.providerName, sapphireSettingsState.value) ===
    'providerNotAutoDetected',
);

const settingNames = computed(() => customSettingNamesOfProvider(props.providerName));

const providerInfo = computed(() => displayInfoOfProviderName(props.providerName));
</script>

<template>
  <div>
    <div class="flex items-center w-full gap-4">
      <h3 v-if="showProviderTitle" class="text-xl truncate">{{ providerInfo.title }}</h3>
    </div>
    <div
      v-if="showProviderTitle && (providerInfo.desc || providerInfo.usageUrl)"
      class="text-void-fg-3 text-xs mb-2 flex flex-col gap-1"
    >
      <span v-if="providerInfo.desc">{{ providerInfo.desc }}</span>
      <a
        v-if="providerInfo.usageUrl"
        :href="providerInfo.usageUrl"
        target="_blank"
        rel="noreferrer"
        class="underline w-fit"
      >
        Ключ и расход
      </a>
    </div>

    <div>
      <!-- Настройки провайдера кроме списка моделей (например apiKey) -->
      <ProviderSetting
        v-for="settingName in settingNames"
        :key="settingName"
        :providerName="providerName"
        :settingName="settingName"
      />

      <WarningBox
        v-if="showProviderSuggestions && needsModel"
        class="pl-2 mb-4"
        :text="`Нет доступных моделей для ${providerInfo.title}. Обновите список моделей.`"
      />
    </div>
  </div>
</template>
