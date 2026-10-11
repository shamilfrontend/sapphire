<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onUnmounted, ref, watch } from 'vue';
import { Check } from 'lucide-vue-next';
import {
  ProviderName,
  SettingName,
  displayInfoOfSettingName,
} from '../../../../common/sapphireSettingsTypes.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.vue';
import SapphireSimpleInputBox from '../util/SapphireSimpleInputBox.vue';
import { useAccessor, useSettingsState } from '../util/services.js';

const props = defineProps<{
  providerName: ProviderName;
  settingName: SettingName;
}>();

const { title: settingTitle, placeholder, isPasswordField } = displayInfoOfSettingName(
  props.providerName,
  props.settingName,
);

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const settingsState = useSettingsState();

const rawSettingValue = computed(
  () => settingsState.value.settingsOfProvider[props.providerName][props.settingName],
);
const settingValue = computed(() =>
  typeof rawSettingValue.value === 'string' ? rawSettingValue.value : '',
);

// Токен (apiKey): сохраняем только по кнопке, чтобы было ясно, что значение записано.
const saveOnButton = props.settingName === 'apiKey';
const draftValue = ref(settingValue.value);
const justSaved = ref(false);
const confirmDelete = ref(false);
let savedFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

watch(settingValue, (next) => {
  draftValue.value = next;
  if (!next) confirmDelete.value = false;
});

watch(
  rawSettingValue,
  (value) => {
    if (typeof value !== 'string') {
      console.log('Error: Provider setting had a non-string value.');
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (savedFeedbackTimer) clearTimeout(savedFeedbackTimer);
});

const handleChangeValue = (newVal: string) => {
  if (saveOnButton) {
    draftValue.value = newVal;
    justSaved.value = false;
    return;
  }
  sapphireSettingsService.setSettingOfProvider(props.providerName, props.settingName, newVal);
};

const handleSave = () => {
  const trimmed = draftValue.value.trim();
  sapphireSettingsService.setSettingOfProvider(props.providerName, props.settingName, trimmed);
  draftValue.value = trimmed;
  justSaved.value = true;
  confirmDelete.value = false;
  if (savedFeedbackTimer) clearTimeout(savedFeedbackTimer);
  savedFeedbackTimer = setTimeout(() => {
    justSaved.value = false;
  }, 2000);
};

const handleDelete = async () => {
  confirmDelete.value = false;
  draftValue.value = '';
  justSaved.value = false;
  if (savedFeedbackTimer) clearTimeout(savedFeedbackTimer);
  await sapphireSettingsService.setSettingOfProvider(props.providerName, props.settingName, '');
  await sapphireSettingsService.setGlobalSetting('isOnboardingComplete', false);
};

const onInputKeyDown = (event: KeyboardEvent) => {
  if (!saveOnButton) return;
  if (event.key === 'Enter' && isDirty.value) handleSave();
};

const isDirty = computed(() => saveOnButton && draftValue.value !== settingValue.value);
const inputValue = computed(() => (saveOnButton ? draftValue.value : settingValue.value));
</script>

<template>
  <ErrorBoundary v-if="typeof rawSettingValue === 'string'">
    <div class="mb-3 w-full">
      <div class="flex w-full items-center gap-2">
        <div class="flex-1 min-w-0">
          <SapphireSimpleInputBox
            :value="inputValue"
            :placeholder="`${settingTitle} (${placeholder})`"
            :passwordBlur="isPasswordField"
            :compact="false"
            @changeValue="handleChangeValue"
            @keydown="onInputKeyDown"
          />
        </div>
        <div v-if="saveOnButton" class="flex shrink-0 items-center gap-2">
          <template v-if="confirmDelete">
            <span class="text-sm text-void-fg-2 whitespace-nowrap shrink-0">Удалить токен?</span>
            <button
              type="button"
              class="px-4 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors shrink-0 bg-rose-600 text-white hover:bg-rose-500"
              @click="handleDelete"
            >
              Удалить
            </button>
            <button
              type="button"
              class="px-4 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors shrink-0 text-void-fg-2 hover:text-void-fg-1"
              @click="confirmDelete = false"
            >
              Отмена
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="px-4 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors shrink-0"
              :class="
                !isDirty
                  ? 'bg-void-bg-3 text-void-fg-3 cursor-not-allowed'
                  : 'bg-[#00b0cc] text-white hover:bg-[#0097b2]'
              "
              :disabled="!isDirty"
              @click="handleSave"
            >
              Сохранить
            </button>
            <button
              type="button"
              class="px-4 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors shrink-0"
              :class="
                !settingValue
                  ? 'bg-void-bg-3 text-void-fg-3 cursor-not-allowed'
                  : 'bg-void-bg-3 text-void-fg-1 hover:bg-void-bg-2'
              "
              :disabled="!settingValue"
              @click="confirmDelete = true"
            >
              Удалить
            </button>
            <span
              v-if="justSaved"
              class="flex items-center gap-1 text-emerald-500 text-sm whitespace-nowrap shrink-0"
            >
              <Check class="w-4 h-4" />
              Сохранено
            </span>
          </template>
        </div>
      </div>
    </div>
  </ErrorBoundary>
</template>
