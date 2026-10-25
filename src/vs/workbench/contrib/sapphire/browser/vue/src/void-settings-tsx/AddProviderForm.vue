<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onUnmounted, ref, watch } from 'vue';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-vue-next';
import { useAccessor, useRefreshModelListener, useSettingsState } from '../util/services.js';
import {
  addFormCloudProviderNames,
  addFormLocalProviderNames,
  customSettingNamesOfProvider,
  displayInfoOfProviderName,
  displayInfoOfSettingName,
  isProviderListedAsConnected,
  providerNames,
  type ProviderName,
  type SettingName,
} from '../../../../common/sapphireSettingsTypes.js';

type ValidationState =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'success'; modelCount: number }
  | { kind: 'error'; message: string };

type ProviderKind = 'cloud' | 'local';

const VALIDATE_TIMEOUT_MS = 20_000;

const emit = defineEmits<{
  added: [providerName: ProviderName];
  cancel: [];
}>();

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const refreshModelService = accessor.get('IRefreshModelService');
const settingsState = useSettingsState();

const providerKind = ref<ProviderKind>('cloud');

const catalogForKind = (kind: ProviderKind): readonly ProviderName[] =>
  kind === 'cloud' ? addFormCloudProviderNames : addFormLocalProviderNames;

const availableProviders = computed(() =>
  catalogForKind(providerKind.value).filter(
    (name) => !isProviderListedAsConnected(settingsState.value.settingsOfProvider[name]),
  ),
);

const availableCloudCount = computed(
  () =>
    addFormCloudProviderNames.filter(
      (name) => !isProviderListedAsConnected(settingsState.value.settingsOfProvider[name]),
    ).length,
);

const availableLocalCount = computed(
  () =>
    addFormLocalProviderNames.filter(
      (name) => !isProviderListedAsConnected(settingsState.value.settingsOfProvider[name]),
    ).length,
);

const anyAvailable = computed(() => availableCloudCount.value + availableLocalCount.value > 0);

watch(
  () => [availableCloudCount.value, availableLocalCount.value] as const,
  ([cloudCount, localCount]) => {
    if (providerKind.value === 'cloud' && cloudCount === 0 && localCount > 0) {
      providerKind.value = 'local';
    } else if (providerKind.value === 'local' && localCount === 0 && cloudCount > 0) {
      providerKind.value = 'cloud';
    }
  },
  { immediate: true },
);

const providerName = ref<ProviderName>(availableProviders.value[0] ?? 'deepseek');
const drafts = ref<Record<string, string>>({});
const validation = ref<ValidationState>({ kind: 'idle' });
const validateInProgress = ref(false);
const validateTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

const providerInfo = computed(() => displayInfoOfProviderName(providerName.value));
const settingNames = computed(() => customSettingNamesOfProvider(providerName.value));

const settingInfo = (settingName: (typeof settingNames.value)[number]) =>
  displayInfoOfSettingName(providerName.value, settingName as SettingName);

watch(
  [providerKind, availableProviders],
  () => {
    const list = availableProviders.value;
    if (!list.length) return;
    if (!list.includes(providerName.value)) {
      providerName.value = list[0];
    }
  },
  { immediate: true },
);

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
  emit('added', providerName.value);
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
    markError(
      `Не удалось получить список моделей от ${providerInfo.value.title}. Проверьте ключ и адрес API.`,
    );
  }
});

onUnmounted(() => {
  clearValidateTimeout();
});

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

const validateButtonDisabled = computed(
  () =>
    missingRequired.value ||
    validation.value.kind === 'validating' ||
    !availableProviders.value.length,
);

const emptyKindMessage = computed(() =>
  providerKind.value === 'cloud'
    ? 'Все облачные провайдеры уже подключены.'
    : 'Все локальные провайдеры уже подключены.',
);
</script>

<template>
  <div class="flex flex-col gap-3 bg-void-bg-2 border border-void-border-2 rounded-md p-5">
    <div class="text-void-fg-1 text-base font-medium">Новый провайдер</div>

    <div v-if="!anyAvailable" class="text-void-fg-3 text-sm">
      Все известные провайдеры уже подключены.
    </div>

    <template v-else>
      <div class="flex items-center gap-4 text-sm text-void-fg-1">
        <label class="inline-flex items-center gap-2 cursor-pointer">
          <input
            v-model="providerKind"
            type="radio"
            value="cloud"
            class="accent-[#0e639c]"
            :disabled="availableCloudCount === 0"
          />
          <span :class="availableCloudCount === 0 ? 'text-void-fg-3' : ''">Облачные</span>
        </label>
        <label class="inline-flex items-center gap-2 cursor-pointer">
          <input
            v-model="providerKind"
            type="radio"
            value="local"
            class="accent-[#0e639c]"
            :disabled="availableLocalCount === 0"
          />
          <span :class="availableLocalCount === 0 ? 'text-void-fg-3' : ''">Локальные</span>
        </label>
      </div>

      <div v-if="!availableProviders.length" class="text-void-fg-3 text-sm">
        {{ emptyKindMessage }}
      </div>

      <template v-else>
        <select
          :value="providerName"
          class="w-full px-3 py-2 rounded-sm bg-void-bg-1 border border-void-border-2 text-void-fg-1"
          @change="onProviderChange"
        >
          <option v-for="name in availableProviders" :key="name" :value="name">
            {{ displayInfoOfProviderName(name).title }}
          </option>
        </select>
        <div v-if="providerInfo.desc" class="text-void-fg-3 text-xs">{{ providerInfo.desc }}</div>
        <a
          v-if="providerInfo.usageUrl"
          :href="providerInfo.usageUrl"
          target="_blank"
          rel="noreferrer"
          class="text-xs underline inline-flex items-center gap-1 text-void-fg-2 w-fit"
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

        <div class="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            :disabled="validateButtonDisabled"
            class="px-4 py-2 rounded text-sm font-medium transition-colors"
            :class="
              validateButtonDisabled
                ? 'bg-void-bg-3 text-void-fg-3 cursor-not-allowed'
                : 'bg-[#0e639c] text-white hover:bg-[#1177bb]'
            "
            @click="onValidate"
          >
            <span v-if="validation.kind === 'validating'" class="flex items-center gap-2">
              <Loader2 class="w-3.5 h-3.5 animate-spin" /> Проверка…
            </span>
            <template v-else>Проверить подключение</template>
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded text-sm text-void-fg-2 hover:text-void-fg-1"
            @click="emit('cancel')"
          >
            Отмена
          </button>
          <div
            v-if="validation.kind === 'success'"
            class="flex items-center gap-1.5 text-emerald-500 text-sm"
          >
            <CheckCircle2 class="w-4 h-4" />
            <span>Подключено. Моделей: {{ validation.modelCount }}</span>
          </div>
          <div
            v-else-if="validation.kind === 'error'"
            class="flex items-center gap-1.5 text-rose-500 text-sm"
          >
            <AlertCircle class="w-4 h-4" />
            <span>{{ validation.message }}</span>
          </div>
        </div>
      </template>
    </template>

    <button
      v-if="!anyAvailable"
      type="button"
      class="px-4 py-2 rounded text-sm text-void-fg-2 hover:text-void-fg-1 w-fit"
      @click="emit('cancel')"
    >
      Отмена
    </button>
  </div>
</template>
