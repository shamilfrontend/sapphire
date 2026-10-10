<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onUnmounted, ref, watch } from 'vue';
import { AlertCircle, CheckCircle2, ExternalLink, KeyRound, Loader2 } from 'lucide-vue-next';
import { useAccessor, useRefreshModelListener, useSettingsState } from '../util/services.js';
import {
  customSettingNamesOfProvider,
  displayInfoOfProviderName,
  displayInfoOfSettingName,
  providerNames,
  type FeatureName,
  type LayoutMode,
  type ModelSelection,
  type ProviderName,
  type SettingName,
} from '../../../../common/sapphireSettingsTypes.js';
import { getModelCapabilities } from '../../../../common/modelCapabilities.js';
import { LLM_IDE_TITLE } from '../../../../common/llmProviderConfig.js';
import LayoutModeCards from '../util/LayoutModeCards.vue';

type ValidationState =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'success'; modelCount: number }
  | { kind: 'error'; message: string };

const VALIDATE_TIMEOUT_MS = 20_000;
const DEFAULT_ONBOARDING_PROVIDER: ProviderName = 'deepseek';

const applyDefaultFeatureModels = async (
  providerName: ProviderName,
  modelNames: string[],
  setModelSelectionOfFeature: (featureName: FeatureName, selection: ModelSelection) => Promise<void>,
) => {
  if (!modelNames.length) return;
  const chatModel =
    modelNames.find((name) => !getModelCapabilities(providerName, name, undefined).supportsFIM) ??
    modelNames[0];
  const fimModel = modelNames.find((name) => getModelCapabilities(providerName, name, undefined).supportsFIM);

  await setModelSelectionOfFeature('Chat', { providerName, modelName: chatModel });
  await setModelSelectionOfFeature('Ctrl+K', { providerName, modelName: chatModel });
  await setModelSelectionOfFeature('Apply', { providerName, modelName: chatModel });
  await setModelSelectionOfFeature('SCM', { providerName, modelName: chatModel });
  if (fimModel) {
    await setModelSelectionOfFeature('Autocomplete', { providerName, modelName: fimModel });
  }
};

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const refreshModelService = accessor.get('IRefreshModelService');
const settingsState = useSettingsState();

const providerName = ref<ProviderName>(DEFAULT_ONBOARDING_PROVIDER);
const drafts = ref<Record<string, string>>({});
const validation = ref<ValidationState>({ kind: 'idle' });
const step = ref<'provider' | 'layout'>('provider');
const layoutChoice = ref<LayoutMode>('ide');

const isOnboardingComplete = computed(() => settingsState.value.globalSettings.isOnboardingComplete);
const layoutMode = computed(() => settingsState.value.globalSettings.layoutMode);
const wasComplete = ref(isOnboardingComplete.value);
const providerInfo = computed(() => displayInfoOfProviderName(providerName.value));
const settingNames = computed(() => customSettingNamesOfProvider(providerName.value));

const models = computed(() => settingsState.value.settingsOfProvider[providerName.value].models);
const availableModelNames = computed(() => {
  const visible = models.value.filter((model) => !model.isHidden).map((model) => model.modelName);
  return visible.length ? visible : models.value.map((model) => model.modelName);
});

const settingInfo = (settingName: (typeof settingNames.value)[number]) =>
  displayInfoOfSettingName(providerName.value, settingName as SettingName);

// drafts follow the selected provider, not every settings tick
watch(
  providerName,
  (name) => {
    const next: Record<string, string> = {};
    const providerSettings = settingsState.value.settingsOfProvider[name];
    for (const settingName of customSettingNamesOfProvider(name)) {
      const value = providerSettings[settingName as keyof typeof providerSettings];
      next[settingName] = typeof value === 'string' ? value : '';
    }
    drafts.value = next;
    validation.value = { kind: 'idle' };
  },
  { immediate: true },
);

const validateInProgress = ref(false);
const validateTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

const clearValidateTimeout = () => {
  if (validateTimeout.value !== null) {
    clearTimeout(validateTimeout.value);
    validateTimeout.value = null;
  }
};

const markSuccess = (modelCount: number) => {
  if (!validateInProgress.value) return;
  validateInProgress.value = false;
  clearValidateTimeout();
  validation.value = { kind: 'success', modelCount };
};

const markError = (message: string) => {
  if (!validateInProgress.value) return;
  validateInProgress.value = false;
  clearValidateTimeout();
  validation.value = { kind: 'error', message };
};

useRefreshModelListener((refreshedProvider, nextRefreshState) => {
  if (refreshedProvider !== providerName.value) return;
  if (!validateInProgress.value) return;
  const st = nextRefreshState[providerName.value]?.state;
  if (st === 'finished') {
    const count = sapphireSettingsService.state.settingsOfProvider[providerName.value].models.length;
    if (count > 0) markSuccess(count);
    else markError(`${providerInfo.value.title} ответил, но список моделей пуст.`);
  } else if (st === 'error') {
    markError(`Не удалось получить список моделей от ${providerInfo.value.title}. Проверьте ключ и адрес API.`);
  }
});

onUnmounted(() => {
  clearValidateTimeout();
});

watch(
  () => [isOnboardingComplete.value, layoutMode.value] as const,
  () => {
    if (wasComplete.value && !isOnboardingComplete.value) {
      validateInProgress.value = false;
      clearValidateTimeout();
      validation.value = { kind: 'idle' };
      step.value = 'provider';
      layoutChoice.value = layoutMode.value;
      providerName.value = DEFAULT_ONBOARDING_PROVIDER;
    }
    wasComplete.value = isOnboardingComplete.value;
  },
  { flush: 'sync', immediate: true },
);

const missingRequired = computed(() =>
  settingNames.value.some((settingName) => {
    if (providerName.value === 'awsBedrock' && settingName === 'endpoint') return false;
    if (settingName === 'headersJSON') return false;
    return !(drafts.value[settingName] ?? '').trim();
  }),
);

const onProviderChange = (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const next = providerNames.find((name) => name === target.value);
  if (!next) return;
  providerName.value = next;
};

const onDraftInput = (settingName: string, event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  drafts.value = { ...drafts.value, [settingName]: target.value };
  if (validation.value.kind !== 'idle') validation.value = { kind: 'idle' };
};

const onValidate = async () => {
  if (missingRequired.value) {
    validation.value = { kind: 'error', message: 'Заполните обязательные поля провайдера.' };
    return;
  }
  clearValidateTimeout();
  validation.value = { kind: 'validating' };
  validateInProgress.value = true;
  validateTimeout.value = setTimeout(() => {
    markError(
      `${providerInfo.value.title} не ответил за ${VALIDATE_TIMEOUT_MS / 1000} с. Проверьте сеть и адрес API.`,
    );
  }, VALIDATE_TIMEOUT_MS);

  for (const settingName of settingNames.value) {
    await sapphireSettingsService.setSettingOfProvider(
      providerName.value,
      settingName,
      (drafts.value[settingName] ?? '').trim(),
    );
  }
  refreshModelService.startRefreshingModels(providerName.value, {
    enableProviderOnSuccess: true,
    doNotFire: false,
  });
};

const canFinish = computed(() => validation.value.kind === 'success' && availableModelNames.value.length > 0);

const onFinish = async () => {
  await applyDefaultFeatureModels(
    providerName.value,
    availableModelNames.value,
    sapphireSettingsService.setModelSelectionOfFeature,
  );
  sapphireSettingsService.setGlobalSetting('layoutMode', layoutChoice.value);
  sapphireSettingsService.setGlobalSetting('isOnboardingComplete', true);
};

const setLayoutChoice = (mode: LayoutMode) => {
  layoutChoice.value = mode;
};

const validateButtonDisabled = computed(
  () => missingRequired.value || validation.value.kind === 'validating',
);
</script>

<template>
  <div v-if="step === 'layout'" class="w-full max-w-[560px] px-6 py-10 flex flex-col gap-6">
    <div class="flex flex-col items-center gap-2 text-center">
      <div class="text-4xl font-light">Как работать в {{ LLM_IDE_TITLE }}</div>
      <div class="text-void-fg-3 text-sm max-w-md">
        Режим можно сменить позже в настройках или кнопкой справа сверху.
      </div>
    </div>
    <LayoutModeCards :value="layoutChoice" @change="setLayoutChoice" />
    <div class="flex justify-between">
      <button
        type="button"
        class="px-4 py-2 rounded text-sm text-void-fg-2 hover:text-void-fg-1"
        @click="step = 'provider'"
      >
        Назад
      </button>
      <button
        type="button"
        class="px-6 py-2 rounded font-medium bg-zinc-100 text-black hover:bg-white"
        @click="onFinish"
      >
        Начать
      </button>
    </div>
  </div>

  <div v-else class="w-full max-w-[560px] px-6 py-10 flex flex-col gap-6">
    <div class="flex flex-col items-center gap-2 text-center">
      <div class="text-4xl font-light">Добро пожаловать в {{ LLM_IDE_TITLE }}</div>
      <div class="text-void-fg-3 text-sm max-w-md">
        Подключите провайдера моделей: облачный API или локальный OpenAI-совместимый сервер.
      </div>
    </div>

    <div class="flex flex-col gap-3 bg-void-bg-2 border border-void-border-2 rounded-md p-5">
      <div class="flex items-center gap-2 text-void-fg-1 text-base font-medium">
        <KeyRound class="w-4 h-4" />
        <span>Провайдер</span>
      </div>
      <select
        :value="providerName"
        class="w-full px-3 py-2 rounded-sm bg-void-bg-1 border border-void-border-2 text-void-fg-1"
        @change="onProviderChange"
      >
        <option v-for="name in providerNames" :key="name" :value="name">
          {{ displayInfoOfProviderName(name).title }}
        </option>
      </select>
      <div v-if="providerInfo.desc" class="text-void-fg-3 text-xs">{{ providerInfo.desc }}</div>
      <a
        v-if="providerInfo.usageUrl"
        :href="providerInfo.usageUrl"
        target="_blank"
        rel="noreferrer"
        class="text-xs underline inline-flex items-center gap-1 text-void-fg-2"
      >
        Ключ и расход
        <ExternalLink class="w-3 h-3" />
      </a>

      <label v-for="settingName in settingNames" :key="settingName" class="flex flex-col gap-1">
        <span class="text-void-fg-3 text-xs">{{ settingInfo(settingName).title }}</span>
        <input
          :type="settingInfo(settingName).isPasswordField ? 'password' : 'text'"
          :value="drafts[settingName] ?? ''"
          :spellcheck="false"
          :placeholder="settingInfo(settingName).placeholder"
          class="w-full px-3 py-2 rounded-sm bg-void-bg-1 border border-void-border-2 text-void-fg-1 focus:outline-none focus:border-void-border-1"
          @input="onDraftInput(settingName, $event)"
        />
      </label>

      <div class="flex items-center gap-2">
        <button
          type="button"
          :disabled="validateButtonDisabled"
          class="px-4 py-2 rounded text-sm font-medium transition-colors"
          :class="
            validateButtonDisabled
              ? 'bg-void-bg-3 text-void-fg-3 cursor-not-allowed'
              : 'bg-[#00b0cc] text-white hover:bg-[#0097b2]'
          "
          @click="onValidate"
        >
          <span v-if="validation.kind === 'validating'" class="flex items-center gap-2">
            <Loader2 class="w-3.5 h-3.5 animate-spin" /> Проверка…
          </span>
          <template v-else>Проверить подключение</template>
        </button>
        <div v-if="validation.kind === 'success'" class="flex items-center gap-1.5 text-emerald-500 text-sm">
          <CheckCircle2 class="w-4 h-4" />
          <span>Подключено. Моделей: {{ validation.modelCount }}</span>
        </div>
        <div v-else-if="validation.kind === 'error'" class="flex items-center gap-1.5 text-rose-500 text-sm">
          <AlertCircle class="w-4 h-4" />
          <span>{{ validation.message }}</span>
        </div>
      </div>
    </div>

    <div class="text-void-fg-3 text-xs">
      Ключ хранится зашифрованно на этой машине. Сменить провайдера можно в Settings → Провайдеры.
    </div>

    <div class="flex justify-end">
      <button
        type="button"
        :disabled="!canFinish"
        class="px-6 py-2 rounded font-medium transition-all"
        :class="
          canFinish ? 'bg-zinc-100 text-black hover:bg-white' : 'bg-zinc-100/40 text-black/40 cursor-not-allowed'
        "
        @click="step = 'layout'"
      >
        Далее
      </button>
    </div>
  </div>
</template>
