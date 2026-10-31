<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onMounted, onWatcherCleanup, ref, watch } from 'vue';
import { autoUpdate, offset, shift, useFloating } from '@floating-ui/vue';
import {
  type FeatureName,
  isAutoModelSelection,
  isFeatureNameDisabled,
  modelSelectionsEqual,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import { useAccessor, useSettingsState } from '../util/services.js';
import {
  modelFilterOfFeatureName,
  type ModelOption,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsService.js';
import {
  getIsReasoningEnabledState,
  getModelCapabilities,
  getModelDisplayName,
} from '../../../../common/modelCapabilities.js';
import ModelDropdown from '../void-settings-tsx/ModelDropdown.vue';
import SapphireSwitch from '../util/SapphireSwitch.vue';
import { useCurrentThreadModelSelection } from './ChatComposer.js';

const props = defineProps<{ featureName: FeatureName }>();

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const chatThreadsService = accessor.get('IChatThreadService');
const settingsState = useSettingsState();
const threadModelSelection = useCurrentThreadModelSelection();
const isChatThreadScoped = computed(() => props.featureName === 'Chat');

const { filter } = modelFilterOfFeatureName[props.featureName];

const oldOptionsRef = ref<ModelOption[]>([]);
const memoizedOptions = ref<ModelOption[]>([]);

const syncOptions = () => {
  const oldOptions = oldOptionsRef.value;
  const state = settingsState.value;
  const newOptions = (state._modelOptions ?? []).filter((option) =>
    filter(option.selection, {
      chatMode: state.globalSettings.chatMode,
      overridesOfModel: state.overridesOfModel,
    }),
  );
  if (
    oldOptions.length !== newOptions.length ||
    oldOptions.some((option, index) => !modelSelectionsEqual(option.selection, newOptions[index].selection))
  ) {
    memoizedOptions.value = newOptions;
  }
  oldOptionsRef.value = newOptions;
};

onMounted(syncOptions);
watch(() => settingsState.value._modelOptions, syncOptions);

const modelSelection = computed(() =>
  isChatThreadScoped.value
    ? threadModelSelection.value
    : settingsState.value.modelSelectionOfFeature[props.featureName],
);

const selectedOption = computed(() => {
  const selection = modelSelection.value;
  const options = memoizedOptions.value;
  if (!selection) return options[0];
  return (
    (settingsState.value._modelOptions ?? []).find((option) =>
      modelSelectionsEqual(option.selection, selection),
    ) ?? options[0]
  );
});

const isAutoOption = (option: ModelOption) =>
  isAutoModelSelection(option.selection) ||
  option.selection.modelName.trim().toLowerCase() === 'auto' ||
  option.name === 'Auto';

const modelName = computed(() => {
  const option = selectedOption.value;
  if (!option) return '';
  if (isAutoOption(option)) return 'Auto';
  return getModelDisplayName(option.selection.providerName, option.selection.modelName);
});

const reasoningView = computed(() => {
  const selection = modelSelection.value;
  if (!selection || isAutoModelSelection(selection)) return null;
  const { modelName: selectedModel, providerName } = selection;
  const overridesOfModel = settingsState.value.overridesOfModel;
  const { reasoningCapabilities } = getModelCapabilities(providerName, selectedModel, overridesOfModel);
  const { canTurnOffReasoning, reasoningSlider: reasoningBudgetSlider } = reasoningCapabilities || {};
  const modelSelectionOptions =
    settingsState.value.optionsOfModelSelection[props.featureName]?.[providerName]?.[selectedModel];
  const isReasoningEnabled = getIsReasoningEnabledState(
    props.featureName,
    providerName,
    selectedModel,
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

const effortLabelRu: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  max: 'Макс.',
};

const effortLabelOf = (effort: string) =>
  effortLabelRu[effort.toLowerCase()] ?? effort.charAt(0).toUpperCase() + effort.slice(1);

const effortView = computed(() => {
  const view = reasoningView.value;
  if (!view || view.reasoningBudgetSlider?.type !== 'effort_slider') return null;
  const values = view.reasoningBudgetSlider.values ?? [];
  if (values.length === 0) return null;
  const defaultVal = view.reasoningBudgetSlider.default;
  const featureOptions = settingsState.value.optionsOfModelSelection[props.featureName];
  const currentEffort =
    featureOptions?.[view.selection.providerName]?.[view.selection.modelName]?.reasoningEffort ??
    defaultVal ??
    '';
  const valueIfOff = -1;
  const value = view.isReasoningEnabled && currentEffort ? values.indexOf(currentEffort) : valueIfOff;
  return { values, value, valueIfOff };
});

const segments = computed(() => {
  const view = reasoningView.value;
  const effort = effortView.value;
  if (!view || !effort) return [];
  const items: { index: number; label: string; active: boolean }[] = [];
  if (view.canTurnOffReasoning) {
    items.push({
      index: effort.valueIfOff,
      label: 'Выкл',
      active: !view.isReasoningEnabled,
    });
  }
  effort.values.forEach((name, index) => {
    items.push({
      index,
      label: effortLabelOf(name),
      active: view.isReasoningEnabled && effort.value === index,
    });
  });
  return items;
});

const toggleKind = computed(() => {
  const view = reasoningView.value;
  if (!view || segments.value.length > 0) return null;
  if (view.canTurnOffReasoning && !view.reasoningBudgetSlider) return 'off' as const;
  if (view.reasoningBudgetSlider?.type === 'budget_slider' && view.canTurnOffReasoning) return 'enabled' as const;
  return null;
});

const hasNuance = computed(() => segments.value.length > 0 || toggleKind.value !== null);

const activeEffortLabel = computed(() => segments.value.find((segment) => segment.active)?.label ?? '');

const isOpen = ref(false);
const pane = ref<'effort' | 'model' | null>(null);
const referenceRef = ref<HTMLElement | null>(null);
const floatingRef = ref<HTMLElement | null>(null);
const lockedPlacement = ref<'top-end' | 'bottom-end'>('bottom-end');
const paneMaxHeight = ref(288);

/** Высота самой большой панели: вертикальная сторона выбирается по ней и больше не меняется. */
const largestMenuHeight = () => {
  const row = 30;
  const main = 8 + 2 * row;
  const effort = segments.value.length > 0 ? 8 + 48 + segments.value.length * row : 0;
  const model = Math.min(8 + Math.max(memoizedOptions.value.length, 1) * row, 288);
  return Math.max(main, effort, model);
};

const choosePlacement = () => {
  const anchor = referenceRef.value;
  if (!(anchor instanceof HTMLElement)) return;
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const pad = 8;
  const need = largestMenuHeight() + gap;
  const above = rect.top;
  const below = window.innerHeight - rect.bottom;
  const fitsAbove = above >= need;
  const fitsBelow = below >= need;
  const placeTop = fitsAbove ? !fitsBelow || above >= below : !fitsBelow && above >= below;
  lockedPlacement.value = placeTop ? 'top-end' : 'bottom-end';
  const room = (placeTop ? above : below) - gap - pad;
  paneMaxHeight.value = Math.max(120, Math.min(288, room));
};

const onTriggerClick = () => {
  if (!isOpen.value) choosePlacement();
  isOpen.value = !isOpen.value;
};

const { x, y, strategy } = useFloating(referenceRef, floatingRef, {
  open: () => isOpen.value,
  placement: () => lockedPlacement.value,
  strategy: 'fixed',
  transform: false,
  middleware: [offset(6), shift({ padding: 8, mainAxis: false, crossAxis: true })],
  whileElementsMounted: autoUpdate,
});

const floatingStyle = computed(() => ({
  position: strategy.value,
  top: `${y.value ?? 0}px`,
  left: `${x.value ?? 0}px`,
}));

const hasContains = (el: unknown): el is { contains: (node: Node) => boolean } =>
  !!el && typeof el === 'object' && 'contains' in el && typeof el.contains === 'function';

watch(isOpen, (open) => {
  if (!open) {
    pane.value = null;
    return;
  }
  const handleClickOutside = (event: MouseEvent) => {
    const node = event.target instanceof Node ? event.target : null;
    const floating = floatingRef.value;
    const reference = referenceRef.value;
    const insideReference = hasContains(reference) && !!node && reference.contains(node);
    const insideFloating = !!floating && !!node && floating.contains(node);
    if (!insideReference && !insideFloating) isOpen.value = false;
  };
  document.addEventListener('mousedown', handleClickOutside);
  onWatcherCleanup(() => document.removeEventListener('mousedown', handleClickOutside));
});

const onToggleOff = (newVal: boolean) => {
  const view = reasoningView.value;
  if (!view?.canTurnOffReasoning) return;
  sapphireSettingsService.setOptionsOfModelSelection(
    props.featureName,
    view.selection.providerName,
    view.selection.modelName,
    { reasoningEnabled: newVal },
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

const onModel = (option: ModelOption) => {
  if (isChatThreadScoped.value) {
    chatThreadsService.setThreadModelSelection(
      chatThreadsService.state.currentThreadId,
      option.selection,
    );
  } else {
    sapphireSettingsService.setModelSelectionOfFeature(props.featureName, option.selection);
  }
  isOpen.value = false;
};

const togglePane = (next: 'effort' | 'model') => {
  pane.value = pane.value === next ? null : next;
};

const optionKey = (option: ModelOption) =>
  `${option.selection.providerName}/${option.selection.modelName}`;

const isSelectedModel = (option: ModelOption) =>
  !!selectedOption.value && modelSelectionsEqual(option.selection, selectedOption.value.selection);

const optionDetail = (option: ModelOption) => {
  // Auto: справа смысл режима, не sentinel-провайдер (deepseek).
  if (isAutoOption(option)) {
    return 'Баланс качества и скорости';
  }
  const { providerName, modelName: rawName } = option.selection;
  const displayName = getModelDisplayName(providerName, rawName);
  return displayName !== rawName ? rawName : providerName;
};

const optionDisplayName = (option: ModelOption) =>
  isAutoOption(option)
    ? 'Auto'
    : getModelDisplayName(option.selection.providerName, option.selection.modelName);

const isDisabled = computed(() => isFeatureNameDisabled(props.featureName, settingsState.value));
</script>

<template>
  <ModelDropdown
    v-if="isDisabled || !hasNuance"
    :featureName="featureName"
    :threadScoped="isChatThreadScoped"
    class="text-xs text-void-fg-3 rounded"
  />
  <div v-else class="min-w-0 max-w-full">
    <button
      ref="referenceRef"
      type="button"
      class="flex items-center h-4 max-w-full min-w-0 bg-transparent text-xs text-void-fg-3 hover:text-void-fg-1"
      @click="onTriggerClick"
    >
      <span class="truncate">{{ modelName }}</span>
      <svg class="size-3 shrink-0 ml-1" viewBox="0 0 12 12" fill="none">
        <path
          d="M2.5 4.5L6 8L9.5 4.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <div
      v-if="isOpen"
      ref="floatingRef"
      class="z-[100] flex flex-row-reverse rounded-lg border border-void-border-2 bg-void-bg-1 shadow-lg"
      :style="[
        floatingStyle,
        { alignItems: lockedPlacement.startsWith('top') ? 'flex-end' : 'flex-start' },
      ]"
      @wheel.stop
    >
      <div class="min-w-[200px] py-1">
        <button
          v-if="segments.length > 0"
          type="button"
          class="flex items-center w-full gap-3 px-2.5 py-1.5 text-xs text-left cursor-pointer"
          :class="
            pane === 'effort'
              ? 'bg-void-bg-2-hover text-void-fg-1'
              : 'text-void-fg-1 hover:bg-void-bg-2-hover'
          "
          @click="togglePane('effort')"
        >
          <span>Усилие</span>
          <span class="ml-auto flex items-center gap-1 text-void-fg-3 min-w-0">
            <span class="truncate">{{ activeEffortLabel }}</span>
            <svg class="size-3 shrink-0" viewBox="0 0 12 12" fill="none">
              <path
                d="M4.5 2.5L8 6L4.5 9.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </button>

        <div
          v-else-if="toggleKind && reasoningView"
          class="flex items-center w-full gap-3 px-2.5 py-1.5 text-xs text-void-fg-1"
        >
          <span>Думает</span>
          <span class="ml-auto">
            <SapphireSwitch
              v-if="toggleKind === 'off'"
              size="xs"
              :value="reasoningView.isReasoningEnabled"
              @change="onToggleOff"
            />
            <SapphireSwitch
              v-else
              size="xs"
              :value="reasoningView.isReasoningEnabled"
              @change="onToggleEnabled"
            />
          </span>
        </div>

        <button
          type="button"
          class="flex items-center w-full gap-3 px-2.5 py-1.5 text-xs text-left cursor-pointer"
          :class="
            pane === 'model'
              ? 'bg-void-bg-2-hover text-void-fg-1'
              : 'text-void-fg-1 hover:bg-void-bg-2-hover'
          "
          @click="togglePane('model')"
        >
          <span>Модель</span>
          <span class="ml-auto flex items-center gap-1 text-void-fg-3 min-w-0">
            <span class="truncate max-w-[120px]">{{ modelName }}</span>
            <svg class="size-3 shrink-0" viewBox="0 0 12 12" fill="none">
              <path
                d="M4.5 2.5L8 6L4.5 9.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </button>
      </div>

      <div
        v-if="pane === 'effort'"
        class="min-w-[180px] max-w-[220px] overflow-y-auto py-1 border-r border-void-border-2"
        :style="{ maxHeight: `${paneMaxHeight}px` }"
      >
        <div class="px-2.5 pt-1 pb-1.5 text-[11px] leading-snug text-void-fg-4">
          Чем выше уровень, тем тщательнее анализ, но медленнее и больше токенов.
        </div>
        <button
          v-for="segment in segments"
          :key="segment.index"
          type="button"
          class="flex items-center w-full gap-2 px-2.5 py-1.5 text-xs text-left cursor-pointer"
          :class="
            segment.active
              ? 'bg-void-bg-2 text-void-fg-1'
              : 'text-void-fg-1 hover:bg-void-bg-2-hover'
          "
          @click="onEffort(segment.index)"
        >
          <span class="w-3 shrink-0">
            <svg v-if="segment.active" class="size-3" viewBox="0 0 12 12" fill="none">
              <path
                d="M10 3L4.5 8.5L2 6"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          {{ segment.label }}
        </button>
      </div>

      <div
        v-else-if="pane === 'model'"
        class="min-w-[200px] max-w-[280px] overflow-y-auto py-1 border-r border-void-border-2"
        :style="{ maxHeight: `${paneMaxHeight}px` }"
      >
        <button
          v-for="option in memoizedOptions"
          :key="optionKey(option)"
          type="button"
          class="flex items-center w-full gap-2 px-2.5 py-1.5 text-xs text-left cursor-pointer"
          :class="
            isSelectedModel(option)
              ? 'bg-void-bg-2 text-void-fg-1'
              : 'text-void-fg-1 hover:bg-void-bg-2-hover'
          "
          @click="onModel(option)"
        >
          <span class="w-3 shrink-0">
            <svg v-if="isSelectedModel(option)" class="size-3" viewBox="0 0 12 12" fill="none">
              <path
                d="M10 3L4.5 8.5L2 6"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <span class="truncate">{{ optionDisplayName(option) }}</span>
          <span class="ml-auto shrink-0 text-void-fg-4 truncate max-w-[90px]">{{
            optionDetail(option)
          }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
