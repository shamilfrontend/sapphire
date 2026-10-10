<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref } from 'vue';
import { Asterisk, Settings as SettingsIcon } from 'lucide-vue-next';
import {
  ProviderName,
  SapphireStatefulModelInfo,
  displayInfoOfProviderName,
  providerNames,
} from '../../../../common/sapphireSettingsTypes.js';
import SapphireSwitch from '../util/SapphireSwitch.vue';
import { useAccessor, useSettingsState } from '../util/services.js';
import SimpleModelSettingsDialog from './SimpleModelSettingsDialog.vue';

type OpenModel = {
  modelName: string;
  providerName: ProviderName;
  type: 'autodetected' | 'custom' | 'default';
};

const accessor = useAccessor();
const settingsStateService = accessor.get('ISapphireSettingsService');
const settingsState = useSettingsState();

// Какая модель открыта в диалоге расширенных настроек
const openSettingsModel = ref<OpenModel | null>(null);

// Плоский список моделей всех провайдеров с флагом доступности
const modelDump = computed(() => {
  const rows: (SapphireStatefulModelInfo & {
    providerName: ProviderName;
    providerEnabled: boolean;
  })[] = [];
  const state = settingsState.value;

  for (const providerName of providerNames) {
    const providerSettings = state.settingsOfProvider[providerName];
    rows.push(
      ...providerSettings.models.map((model) => ({
        ...model,
        providerName,
        providerEnabled: !!providerSettings._didFillInProviderSettings,
      })),
    );
  }

  // Сначала модели от подключённых провайдеров
  rows.sort((a, b) => Number(b.providerEnabled) - Number(a.providerEnabled));
  return rows;
});

const providerTitleOf = (providerName: ProviderName) => displayInfoOfProviderName(providerName).title;

const isNewProviderName = (index: number) => {
  const rows = modelDump.value;
  const providerName = rows[index]?.providerName;
  return (index > 0 ? rows[index - 1] : undefined)?.providerName !== providerName;
};

const hasOverrides = (providerName: ProviderName, modelName: string) =>
  !!settingsState.value.overridesOfModel?.[providerName]?.[modelName];
</script>

<template>
  <div>
    <div v-for="(m, i) in modelDump" :key="`${m.modelName}${m.providerName}`">
      <div v-if="isNewProviderName(i)" class="text-sm text-void-fg-3 px-3 pt-4 pb-1">
        {{ providerTitleOf(m.providerName) }}
      </div>
      <div
        class="flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate group"
      >
        <!-- Левая часть — имя модели, flex-grow -->
        <div class="flex flex-grow items-center gap-4 min-w-0">
          <span class="w-fit max-w-[400px] truncate">{{ m.modelName }}</span>
        </div>

        <!-- Правая часть — иконки и переключатель -->
        <div class="flex items-center gap-2 w-fit">
          <!-- Шестерёнка: скрыта, если провайдер не настроен -->
          <div v-if="m.providerEnabled" class="w-5 flex items-center justify-center">
            <button
              data-tooltip-id="sapphire-tooltip"
              data-tooltip-place="right"
              data-tooltip-content="Расширенные настройки"
              class="transition-opacity"
              :class="
                hasOverrides(m.providerName, m.modelName) ? '' : 'opacity-0 group-hover:opacity-100'
              "
              @click="
                openSettingsModel = {
                  modelName: m.modelName,
                  providerName: m.providerName,
                  type: m.type,
                }
              "
            >
              <SettingsIcon :size="14" class="text-void-fg-3 opacity-70" />
            </button>
          </div>

          <!-- Маркер autodetected / custom -->
          <Asterisk
            v-if="m.type === 'autodetected'"
            :size="14"
            class="inline-block align-text-top brightness-115 stroke-[2] text-[#00b0cc]"
            data-tooltip-id="sapphire-tooltip"
            data-tooltip-place="right"
            data-tooltip-content="Обнаружена автоматически"
          />
          <Asterisk
            v-else-if="m.type === 'custom'"
            :size="14"
            class="inline-block align-text-top brightness-115 stroke-[2] text-[#00b0cc]"
            data-tooltip-id="sapphire-tooltip"
            data-tooltip-place="right"
            data-tooltip-content="Пользовательская модель"
          />

          <!-- Показать/скрыть в списках выбора модели -->
          <SapphireSwitch
            :value="m.providerEnabled ? !m.isHidden : false"
            :disabled="!m.providerEnabled"
            size="sm"
            data-tooltip-id="sapphire-tooltip"
            data-tooltip-place="right"
            :data-tooltip-content="
              !m.providerEnabled
                ? `Подключите ${providerTitleOf(m.providerName)}, чтобы включить`
                : m.providerEnabled && !m.isHidden
                  ? 'Показывать в списке'
                  : 'Скрыть из списка'
            "
            @change="settingsStateService.toggleModelHidden(m.providerName, m.modelName)"
          />
        </div>
      </div>
    </div>

    <!-- Диалог переопределений модели -->
    <SimpleModelSettingsDialog
      v-if="openSettingsModel"
      :modelInfo="openSettingsModel"
      @close="openSettingsModel = null"
    />
  </div>
</template>
