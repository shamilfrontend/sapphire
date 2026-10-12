<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import SapphireSwitch from '../util/SapphireSwitch.vue';
import { useAccessor, useMCPServiceState, useSettingsState } from '../util/services.js';
import WarningBox from './WarningBox.vue';

const accessor = useAccessor();
const mcpService = accessor.get('IMCPService');
const sapphireSettings = useSettingsState();
const mcpServiceState = useMCPServiceState();

const removeUniquePrefix = (name: string) => name.split('_').slice(1).join('_');

const entries = computed(() => Object.entries(mcpServiceState.value.mcpServerOfName));

const isOn = (name: string) => sapphireSettings.value.mcpUserStateOfName[name]?.isOn;
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="mcpServiceState.error" class="text-void-fg-3 text-sm">
      {{ mcpServiceState.error }}
    </div>
    <div v-else-if="entries.length === 0" class="text-void-fg-3 text-sm">No servers found</div>
    <template v-else>
      <div
        v-for="[name, server] in entries"
        :key="name"
        class="border border-void-border-2 bg-void-bg-1 py-3 px-4 rounded-sm"
      >
        <div class="flex items-center justify-between">
          <!-- Слева: индикатор статуса и имя -->
          <div class="flex items-center gap-2">
            <!-- Цвет по status сервера -->
            <div
              class="w-2 h-2 rounded-full"
              :class="
                server.status === 'success'
                  ? 'bg-green-500'
                  : server.status === 'error'
                    ? 'bg-red-500'
                    : server.status === 'loading'
                      ? 'bg-yellow-500'
                      : server.status === 'offline'
                        ? 'bg-void-fg-3'
                        : ''
              "
            />

            <!-- Имя сервера -->
            <div class="text-sm font-medium text-void-fg-1">{{ name }}</div>
          </div>

          <!-- Справа: вкл/выкл сервер -->
          <SapphireSwitch
            :value="isOn(name) ?? false"
            size="xs"
            :disabled="server.status === 'error'"
            @change="mcpService.toggleServerIsOn(name, !isOn(name))"
          />
        </div>

        <!-- Список инструментов MCP -->
        <div v-if="isOn(name)" class="mt-3">
          <div class="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            <template v-if="(server.tools ?? []).length > 0">
              <span
                v-for="tool in server.tools ?? []"
                :key="tool.name"
                class="px-2 py-0.5 bg-void-bg-2 text-void-fg-3 rounded-sm text-xs"
                data-tooltip-id="sapphire-tooltip"
                :data-tooltip-content="tool.description || ''"
                data-tooltip-class-name="sapphire-max-w-[300px]"
              >
                {{ removeUniquePrefix(tool.name) }}
              </span>
            </template>
            <span v-else class="text-xs text-void-fg-3">No tools available</span>
          </div>
        </div>

        <!-- Команда запуска сервера -->
        <div v-if="isOn(name) && server.command" class="mt-3">
          <div class="text-xs text-void-fg-3 mb-1">Command:</div>
          <div
            class="px-2 py-1 bg-void-bg-2 text-xs font-mono overflow-x-auto whitespace-nowrap text-void-fg-2 rounded-sm"
          >
            {{ server.command }}
          </div>
        </div>

        <!-- Текст ошибки подключения -->
        <div v-if="server.error" class="mt-3">
          <WarningBox :text="server.error" />
        </div>
      </div>
    </template>
  </div>
</template>
