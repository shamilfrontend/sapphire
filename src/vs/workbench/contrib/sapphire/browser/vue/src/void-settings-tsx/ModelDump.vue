<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref } from 'vue';
import { Asterisk, Settings as SettingsIcon } from 'lucide-vue-next';
import {
  cloudProviderNames,
  localProviderNames,
  ProviderName,
  SapphireStatefulModelInfo,
  displayInfoOfProviderName,
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

const openSettingsModel = ref<OpenModel | null>(null);

type ModelRow = SapphireStatefulModelInfo & {
  providerName: ProviderName;
};

type ModelProviderGroup = {
  providerName: ProviderName;
  providerTitle: string;
  isEnabled: boolean;
  rows: ModelRow[];
};

type ModelSection = {
  id: 'cloud' | 'local';
  title: string;
  providers: ModelProviderGroup[];
};

const modelSections = computed<ModelSection[]>(() => {
  const state = settingsState.value;
  const providersBySection = [
    { id: 'cloud' as const, title: 'Облачные', providerNames: cloudProviderNames },
    { id: 'local' as const, title: 'Локальные', providerNames: localProviderNames },
  ];

  const sections: ModelSection[] = [];

  for (const section of providersBySection) {
    const providerGroups: ModelProviderGroup[] = [];

    for (const providerName of section.providerNames) {
      const providerSettings = state.settingsOfProvider[providerName];
      if (!providerSettings._didFillInProviderSettings) continue;

      const rows = providerSettings.models.map((model) => ({
        ...model,
        providerName,
      }));
      if (rows.length === 0) continue;

      providerGroups.push({
        providerName,
        providerTitle: providerTitleOf(providerName),
        isEnabled: providerSettings.isEnabled !== false,
        rows,
      });
    }

    if (providerGroups.length > 0) {
      sections.push({
        id: section.id,
        title: section.title,
        providers: providerGroups,
      });
    }
  }

  return sections;
});

const providerTitleOf = (providerName: ProviderName) => displayInfoOfProviderName(providerName).title;

const hasOverrides = (providerName: ProviderName, modelName: string) =>
  !!settingsState.value.overridesOfModel?.[providerName]?.[modelName];
</script>

<template>
  <div>
    <div v-if="modelSections.length === 0" class="text-sm text-void-fg-3 px-3 py-2">
      Нет моделей у подключённых провайдеров.
    </div>
    <section v-for="section in modelSections" :key="section.id" class="mb-4">
      <h3 class="text-sm uppercase tracking-wide text-void-fg-3 px-3 pt-2 pb-1">{{ section.title }}</h3>

      <div
        v-for="provider in section.providers"
        :key="provider.providerName"
        :class="provider.isEnabled ? '' : 'opacity-60'"
      >
        <div class="text-sm text-void-fg-3 px-3 pt-4 pb-1 flex items-center gap-2">
          <span>{{ provider.providerTitle }}</span>
          <span v-if="!provider.isEnabled" class="text-xs">(выключен)</span>
        </div>
        <div v-for="m in provider.rows" :key="`${m.modelName}${m.providerName}`">
          <div
            class="flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate group"
          >
            <div class="flex flex-grow items-center gap-4 min-w-0">
              <span class="w-fit max-w-[400px] truncate">{{ m.modelName }}</span>
            </div>

            <div class="flex items-center gap-2 w-fit">
              <div class="w-5 flex items-center justify-center">
                <button
                  data-tooltip-id="sapphire-tooltip"
                  data-tooltip-place="right"
                  data-tooltip-content="Расширенные настройки"
                  class="transition-opacity"
                  :class="
                    hasOverrides(m.providerName, m.modelName)
                      ? ''
                      : 'opacity-0 group-hover:opacity-100'
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

              <Asterisk
                v-if="m.type === 'autodetected'"
                :size="14"
                class="inline-block align-text-top brightness-115 stroke-[2] text-[#0e639c]"
                data-tooltip-id="sapphire-tooltip"
                data-tooltip-place="right"
                data-tooltip-content="Обнаружена автоматически"
              />
              <Asterisk
                v-else-if="m.type === 'custom'"
                :size="14"
                class="inline-block align-text-top brightness-115 stroke-[2] text-[#0e639c]"
                data-tooltip-id="sapphire-tooltip"
                data-tooltip-place="right"
                data-tooltip-content="Пользовательская модель"
              />

              <SapphireSwitch
                :value="!m.isHidden"
                size="sm"
                data-tooltip-id="sapphire-tooltip"
                data-tooltip-place="right"
                :data-tooltip-content="!m.isHidden ? 'Показывать в списке' : 'Скрыть из списка'"
                @change="settingsStateService.toggleModelHidden(m.providerName, m.modelName)"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <SimpleModelSettingsDialog
      v-if="openSettingsModel"
      :modelInfo="openSettingsModel"
      @close="openSettingsModel = null"
    />
  </div>
</template>
