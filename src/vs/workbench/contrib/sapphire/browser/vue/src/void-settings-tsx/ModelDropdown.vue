<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onMounted, ref, watch } from 'vue';
import {
  FeatureName,
  isFeatureNameDisabled,
  modelSelectionsEqual,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import { useSettingsState, useAccessor } from '../util/services.js';
import SapphireCustomDropdownBox from '../util/SapphireCustomDropdownBox.vue';
import { SAPPHIRE_OPEN_SETTINGS_ACTION_ID } from '../../../sapphireSettingsPane.js';
import {
  modelFilterOfFeatureName,
  ModelOption,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsService.js';
import WarningBox from './WarningBox.vue';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.vue';

const props = defineProps<{
  featureName: FeatureName;
  class: string;
  fillWidth?: boolean;
}>();

const optionsEqual = (m1: ModelOption[], m2: ModelOption[]) => {
  if (m1.length !== m2.length) return false;
  for (let i = 0; i < m1.length; i++) {
    if (!modelSelectionsEqual(m1[i].selection, m2[i].selection)) return false;
  }
  return true;
};

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const commandService = accessor.get('ICommandService');
const settingsState = useSettingsState();

const { filter, emptyMessage } = modelFilterOfFeatureName[props.featureName];

const oldOptionsRef = ref<ModelOption[]>([]);
const memoizedOptions = ref<ModelOption[]>([]);

const syncOptions = () => {
  const oldOptions = oldOptionsRef.value;
  const state = settingsState.value;
  const newOptions = (state._modelOptions ?? []).filter((o) =>
    filter(o.selection, {
      chatMode: state.globalSettings.chatMode,
      overridesOfModel: state.overridesOfModel,
    }),
  );

  if (!optionsEqual(oldOptions, newOptions)) {
    memoizedOptions.value = newOptions;
  }
  oldOptionsRef.value = newOptions;
};

// Как useEffect: первый проход после mount, дальше только при смене списка моделей.
onMounted(syncOptions);
watch(() => settingsState.value._modelOptions, syncOptions);

const selectedOption = computed(() => {
  const state = settingsState.value;
  const selection = state.modelSelectionOfFeature[props.featureName];
  const options = memoizedOptions.value;
  if (!selection) return options[0];
  return (state._modelOptions ?? []).find((v) => modelSelectionsEqual(v.selection, selection))!;
});

const onChangeOption = (newOption: ModelOption) => {
  sapphireSettingsService.setModelSelectionOfFeature(props.featureName, newOption.selection);
};

const optionName = (option: ModelOption) => option.selection.modelName;
const optionDetail = (option: ModelOption) => option.selection.providerName;
const optionEquals = (a: ModelOption, b: ModelOption) => optionsEqual([a], [b]);

const openSettings = () => {
  commandService.executeCommand(SAPPHIRE_OPEN_SETTINGS_ACTION_ID);
};

const isDisabled = computed(() => isFeatureNameDisabled(props.featureName, settingsState.value));

const disabledText = computed(() => {
  const disabled = isDisabled.value;
  if (emptyMessage && emptyMessage.priority === 'always') return emptyMessage.message;
  if (disabled === 'needToEnableModel') return 'Включите модель';
  if (disabled === 'addModel') return 'Нет доступных моделей';
  if (disabled === 'addProvider' || disabled === 'providerNotAutoDetected') return 'Нужен провайдер';
  return 'Нужен провайдер';
});
</script>

<template>
  <WarningBox v-if="isDisabled" :text="disabledText" @click="openSettings" />
  <ErrorBoundary v-else>
    <!-- Сюда не попадаем, пока не включён фильтр моделей -->
    <WarningBox
      v-if="memoizedOptions.length === 0"
      :text="emptyMessage?.message || 'Нет доступных моделей'"
    />
    <SapphireCustomDropdownBox
      v-else
      :class="props.class"
      :options="memoizedOptions"
      :selectedOption="selectedOption"
      :getOptionDisplayName="optionName"
      :getOptionDropdownName="optionName"
      :getOptionDropdownDetail="optionDetail"
      :getOptionsEqual="optionEquals"
      :matchInputWidth="false"
      :fillWidth="fillWidth"
      @changeOption="onChangeOption"
    />
  </ErrorBoundary>
</template>
