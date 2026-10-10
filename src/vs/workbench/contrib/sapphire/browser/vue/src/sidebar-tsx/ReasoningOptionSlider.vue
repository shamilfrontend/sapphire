<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { useAccessor, useSettingsState } from '../util/services.js';
import SapphireSlider from '../util/SapphireSlider.vue';
import SapphireSwitch from '../util/SapphireSwitch.vue';
import { FeatureName } from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import {
  getIsReasoningEnabledState,
  getModelCapabilities,
} from '../../../../common/modelCapabilities.js';
import ReasoningLabel from './ReasoningLabel.vue';

const props = defineProps<{ featureName: FeatureName }>();

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const sapphireSettingsState = useSettingsState();

const modelSelection = computed(
  () => sapphireSettingsState.value.modelSelectionOfFeature[props.featureName],
);

const reasoningView = computed(() => {
  const selection = modelSelection.value;
  if (!selection) return null;
  const { modelName, providerName } = selection;
  const overridesOfModel = sapphireSettingsState.value.overridesOfModel;
  const { reasoningCapabilities } = getModelCapabilities(providerName, modelName, overridesOfModel);
  const { canTurnOffReasoning, reasoningSlider: reasoningBudgetSlider } = reasoningCapabilities || {};
  const modelSelectionOptions =
    sapphireSettingsState.value.optionsOfModelSelection[props.featureName][providerName]?.[modelName];
  const isReasoningEnabled = getIsReasoningEnabledState(
    props.featureName,
    providerName,
    modelName,
    modelSelectionOptions,
    overridesOfModel,
  );
  return {
    selection,
    canTurnOffReasoning,
    reasoningBudgetSlider,
    isReasoningEnabled,
  };
});

const effortView = computed(() => {
  const view = reasoningView.value;
  if (!view || view.reasoningBudgetSlider?.type !== 'effort_slider') return null;
  const { values, default: defaultVal } = view.reasoningBudgetSlider;
  const min = view.canTurnOffReasoning ? -1 : 0;
  const max = values.length - 1;
  const currentEffort =
    sapphireSettingsState.value.optionsOfModelSelection[props.featureName][view.selection.providerName]?.[
      view.selection.modelName
    ]?.reasoningEffort ?? defaultVal;
  const valueIfOff = -1;
  const value = view.isReasoningEnabled && currentEffort ? values.indexOf(currentEffort) : valueIfOff;
  const effortLabelRu: Record<string, string> = {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий',
  };
  const currentEffortLabel =
    effortLabelRu[currentEffort.toLowerCase()] ??
    currentEffort.charAt(0).toUpperCase() + currentEffort.slice(1);
  return { values, min, max, value, valueIfOff, currentEffortLabel };
});

const onToggleOff = (newVal: boolean) => {
  const view = reasoningView.value;
  if (!view?.canTurnOffReasoning) return;
  const isOff = view.canTurnOffReasoning && !newVal;
  sapphireSettingsService.setOptionsOfModelSelection(
    props.featureName,
    view.selection.providerName,
    view.selection.modelName,
    { reasoningEnabled: !isOff },
  );
};

const onToggleEnabled = (newVal: boolean) => {
  const view = reasoningView.value;
  if (!view) return;
  sapphireSettingsService.setOptionsOfModelSelection(
    props.featureName,
    view.selection.providerName,
    view.selection.modelName,
    { reasoningEnabled: newVal },
  );
};

const onEffort = (newVal: number) => {
  const view = reasoningView.value;
  const effort = effortView.value;
  if (!view || !effort) return;
  const isOff = view.canTurnOffReasoning && newVal === effort.valueIfOff;
  sapphireSettingsService.setOptionsOfModelSelection(
    props.featureName,
    view.selection.providerName,
    view.selection.modelName,
    { reasoningEnabled: !isOff, reasoningEffort: effort.values[newVal] ?? undefined },
  );
};
</script>

<template>
  <!-- только слайдер (без отдельного переключателя): -->
  <div
    v-if="reasoningView && reasoningView.canTurnOffReasoning && !reasoningView.reasoningBudgetSlider"
    class="flex items-center gap-x-2 min-w-0 overflow-hidden"
  >
    <!-- простой вкл/выкл без слайдера «усилия» -->
    <ReasoningLabel />
    <SapphireSwitch size="xxs" :value="reasoningView.isReasoningEnabled" @change="onToggleOff" />
  </div>
  <div
    v-else-if="
      reasoningView &&
      reasoningView.reasoningBudgetSlider?.type === 'budget_slider' &&
      reasoningView.canTurnOffReasoning
    "
    class="flex items-center gap-x-2 min-w-0 overflow-hidden"
  >
    <ReasoningLabel />
    <SapphireSwitch
      size="xxs"
      :value="reasoningView.isReasoningEnabled"
      @change="onToggleEnabled"
    />
  </div>
  <div
    v-else-if="reasoningView && effortView"
    class="flex items-center gap-x-2 min-w-0 overflow-hidden"
  >
    <ReasoningLabel />
    <SapphireSlider
      :width="72"
      size="sm"
      :min="effortView.min"
      :max="effortView.max"
      :step="1"
      :value="effortView.value"
      @change="onEffort"
    />
    <span class="text-void-fg-3 text-xs pointer-events-none truncate min-w-0">
      {{ reasoningView.isReasoningEnabled ? effortView.currentEffortLabel : 'Выкл.' }}
    </span>
  </div>
</template>
