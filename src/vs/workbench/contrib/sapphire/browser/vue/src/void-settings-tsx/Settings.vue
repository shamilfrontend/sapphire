<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref } from 'vue';
import {
  cloudProviderNames,
  displayInfoOfFeatureName,
  isProviderListedAsConnected,
  LayoutMode,
  localProviderNames,
  providerNames,
  type ProviderName,
} from '../../../../common/sapphireSettingsTypes.js';
import { LLM_IDE_TITLE } from '../../../../common/llmProviderConfig.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.vue';
import SapphireButtonBgDarken from '../util/SapphireButtonBgDarken.vue';
import SapphireSwitch from '../util/SapphireSwitch.vue';
import { useAccessor, useIsDark, useSettingsState } from '../util/services.js';
import ModelDropdown from './ModelDropdown.vue';
import ChatMarkdownRender from '../markdown/ChatMarkdownRender.vue';
import LayoutModeCards from '../util/LayoutModeCards.vue';
import { toolApprovalTypes, ToolApprovalType } from '../../../../common/toolsServiceTypes.js';
import ModelDump from './ModelDump.vue';
import SettingsForProvider from './SettingsForProvider.vue';
import AddProviderForm from './AddProviderForm.vue';
import { revealSapphireRulesFile } from './userRules.js';
import UserRulesList from './UserRulesList.vue';
import { revealSapphireSkillsFile } from './userSkills.js';
import UserSkillsList from './UserSkillsList.vue';
import FastApplyMethodDropdown from './FastApplyMethodDropdown.vue';
import MCPServersList from './MCPServersList.vue';
import ToolApprovalTypeSwitch from './ToolApprovalTypeSwitch.vue';
import { openAgentsFile } from '../agents-window-tsx/agentsFileBridge.js';

type Tab = 'models' | 'providers' | 'featureOptions' | 'mcp' | 'rules' | 'skills' | 'layout';

const props = withDefaults(defineProps<{ variant?: 'editor' | 'agents' }>(), {
  variant: 'editor',
});

const isDark = useIsDark();
const agents = computed(() => props.variant === 'agents');

// ─── навигация боковой панели ──────────────────────────
const selectedSection = ref<Tab>('providers');

const navItems: { tab: Tab; label: string }[] = [
  { tab: 'providers', label: 'Провайдеры' },
  { tab: 'layout', label: 'Интерфейс' },
  { tab: 'models', label: 'Модели' },
  { tab: 'featureOptions', label: 'Опции' },
  { tab: 'rules', label: 'Правила' },
  { tab: 'skills', label: 'Скиллы' },
  { tab: 'mcp', label: 'MCP' },
];

const accessor = useAccessor();
const settingsState = useSettingsState();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const mcpService = accessor.get('IMCPService');

const setLayoutMode = (mode: LayoutMode) => {
  sapphireSettingsService.setGlobalSetting('layoutMode', mode);
};

const approvalLabel = (approvalType: ToolApprovalType) =>
  approvalType === 'edits'
    ? 'правки'
    : approvalType === 'terminal'
      ? 'терминал'
      : approvalType === 'network'
        ? 'сеть'
        : approvalType === 'browser'
          ? 'браузер'
          : 'MCP';

const mcpIntro = `
Use Model Context Protocol to provide Agent mode with more tools.
							`;

const revealMcpConfig = async () => {
  const uri = await mcpService.getOrCreateMCPConfigFile();
  if (openAgentsFile({ fsPath: uri.fsPath })) return;
  await mcpService.revealMCPConfigFile();
};

const catalogProviderNames = new Set<ProviderName>([
  ...cloudProviderNames,
  ...localProviderNames,
]);

const isConnected = (providerName: ProviderName) =>
  isProviderListedAsConnected(settingsState.value.settingsOfProvider[providerName]);

const connectedCloud = computed(() => cloudProviderNames.filter(isConnected));
const connectedLocal = computed(() => localProviderNames.filter(isConnected));
const connectedOther = computed(() =>
  providerNames.filter((name) => !catalogProviderNames.has(name) && isConnected(name)),
);

const connectedProviderSections = computed(() => {
  const sections: { id: string; title: string; providers: readonly ProviderName[] }[] = [];
  if (connectedCloud.value.length) {
    sections.push({ id: 'cloud', title: 'Облачные', providers: connectedCloud.value });
  }
  if (connectedLocal.value.length) {
    sections.push({ id: 'local', title: 'Локальные', providers: connectedLocal.value });
  }
  if (connectedOther.value.length) {
    sections.push({ id: 'other', title: 'Другие', providers: connectedOther.value });
  }
  return sections;
});

const hasConnectedProviders = computed(() => connectedProviderSections.value.length > 0);

const showAddProvider = ref(false);

const onProviderAdded = () => {
  showAddProvider.value = false;
};

const onAddProviderCancel = () => {
  showAddProvider.value = false;
};
</script>

<template>
  <div
    :class="agents ? 'h-full w-full min-h-0' : ['@@void-scope', isDark ? 'dark' : '']"
    :style="agents ? undefined : { height: '100%', width: '100%', overflow: 'auto' }"
  >
    <div
      :class="
        agents
          ? 'flex h-full w-full min-h-0'
          : 'flex flex-col md:flex-row w-full gap-6 max-w-[900px] mx-auto px-6 pt-6 pb-12'
      "
    >
      <aside
        :class="
          agents
            ? 'w-[200px] shrink-0 h-full overflow-y-auto border-r border-void-border-2 bg-void-bg-2 p-2'
            : 'md:w-1/4 w-full shrink-0'
        "
      >
        <div :class="agents ? 'flex flex-col gap-0.5' : 'flex flex-col gap-2'">
          <button
            v-for="item in navItems"
            :key="item.tab"
            :class="
              agents
                ? selectedSection === item.tab
                  ? 'py-1.5 px-2 rounded-md text-left text-sm transition-colors bg-[#0e639c]/20 text-void-fg-1 font-medium shadow-[inset_2px_0_0_0_#0e639c]'
                  : 'py-1.5 px-2 rounded-md text-left text-sm transition-colors text-void-fg-3 hover:bg-void-bg-2-hover hover:text-void-fg-1'
                : selectedSection === item.tab
                  ? 'py-2 px-4 rounded-md text-left transition-all duration-200 bg-[#0e639c]/80 text-white font-medium shadow-sm'
                  : 'py-2 px-4 rounded-md text-left transition-all duration-200 bg-void-bg-2 hover:bg-void-bg-2/80 text-void-fg-1'
            "
            @click="selectedSection = item.tab"
          >
            {{ item.label }}
          </button>
        </div>
      </aside>

      <main
        :class="
          agents
            ? 'flex-1 min-w-0 max-w-[800px] h-full overflow-y-auto px-6 py-4 select-none'
            : 'flex-1 select-none min-w-0'
        "
      >
        <div :class="selectedSection === 'layout' ? '' : 'hidden'">
          <ErrorBoundary>
            <h2 :class="agents ? 'text-xl mb-2' : 'text-3xl mb-2'">Интерфейс</h2>
            <p class="text-void-fg-3 text-sm leading-relaxed mb-6">
              Режим можно сменить в любой момент. В режиме IDE кнопка «Режим Агент» справа сверху,
              в режиме Агент — кнопка «Режим IDE».
            </p>
            <LayoutModeCards
              :value="settingsState.globalSettings.layoutMode"
              @change="setLayoutMode"
            />
          </ErrorBoundary>
        </div>

        <!-- Секция «Модели» -->
        <div :class="selectedSection === 'models' ? '' : 'hidden'">
          <ErrorBoundary>
            <h2 :class="agents ? 'text-xl mb-2' : 'text-3xl mb-2'">Модели</h2>
            <ModelDump />
          </ErrorBoundary>
        </div>

        <div :class="selectedSection === 'providers' ? '' : 'hidden'">
          <ErrorBoundary>
            <h2 :class="agents ? 'text-xl mb-2' : 'text-3xl mb-2'">Провайдеры</h2>
            <p class="text-void-fg-3 text-sm leading-relaxed mb-6">
              У каждого провайдера свой ключ или адрес. {{ LLM_IDE_TITLE }} отправляет запросы только
              на выбранный endpoint.
            </p>
            <div class="flex flex-col gap-10">
              <p v-if="!hasConnectedProviders" class="text-void-fg-3 text-sm">
                Нет подключённых провайдеров.
              </p>
              <section
                v-for="section in connectedProviderSections"
                :key="section.id"
                class="flex flex-col gap-6"
              >
                <h3 class="text-sm uppercase tracking-wide text-void-fg-3">{{ section.title }}</h3>
                <div class="flex flex-col gap-8">
                  <SettingsForProvider
                    v-for="providerName in section.providers"
                    :key="providerName"
                    :providerName="providerName"
                    :showProviderTitle="true"
                    :showProviderSuggestions="true"
                  />
                </div>
              </section>

              <div class="flex flex-col gap-4">
                <button
                  v-if="!showAddProvider"
                  type="button"
                  class="px-4 py-2 rounded text-sm font-medium w-fit transition-colors bg-[#0e639c] text-white hover:bg-[#1177bb]"
                  @click="showAddProvider = true"
                >
                  Добавить провайдер
                </button>
                <AddProviderForm
                  v-else
                  @added="onProviderAdded"
                  @cancel="onAddProviderCancel"
                />
              </div>
            </div>
          </ErrorBoundary>
        </div>

        <!-- Секция «Опции» -->
        <div :class="selectedSection === 'featureOptions' ? '' : 'hidden'">
          <ErrorBoundary>
            <h2 :class="agents ? 'text-xl mb-6' : 'text-3xl mb-6'">Опции</h2>

            <div class="flex flex-col gap-y-8">
              <ErrorBoundary>
                <!-- FIM -->
                <div>
                  <h4 class="text-base">{{ displayInfoOfFeatureName('Autocomplete') }}</h4>
                  <div class="text-sm text-void-fg-3 mt-1">
                    <span>Экспериментально. </span>
                    <span
                      class="hover:brightness-110 cursor-help border-b border-dotted border-void-fg-3/40"
                      data-tooltip-id="sapphire-tooltip"
                      data-tooltip-content="FIM (Fill-In-the-Middle) — модель дописывает код с учётом текста и слева, и справа от курсора. Обычные chat-модели этого не умеют: для автодополнения нужна модель с поддержкой FIM (например, qwen3-8B)."
                      data-tooltip-place="top"
                      data-tooltip-class-name="sapphire-max-w-[300px]"
                    >
                      Только для FIM-моделей.*
                    </span>
                  </div>
                  <div class="text-sm text-void-fg-3 mt-1 max-w-xl">
                    FIM (Fill-In-the-Middle) — способ автодополнения, при котором модель видит код
                    до и после курсора и вставляет продолжение посередине. Без поддержки FIM
                    подсказки в редакторе работать не будут.
                  </div>

                  <div class="flex flex-col gap-2 mt-3">
                    <!-- Включить автодополнение -->
                    <ErrorBoundary>
                      <div class="flex items-center gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          :value="settingsState.globalSettings.enableAutocomplete"
                          @change="
                            sapphireSettingsService.setGlobalSetting('enableAutocomplete', $event)
                          "
                        />
                        <span class="text-void-fg-3 text-xs pointer-events-none">
                          {{
                            settingsState.globalSettings.enableAutocomplete ? 'Включено' : 'Выключено'
                          }}
                        </span>
                      </div>
                    </ErrorBoundary>

                    <!-- Выбор модели -->
                    <ErrorBoundary>
                      <div :class="!settingsState.globalSettings.enableAutocomplete ? 'hidden' : ''">
                        <ModelDropdown
                          featureName="Autocomplete"
                          class="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
                        />
                      </div>
                    </ErrorBoundary>
                  </div>
                </div>
              </ErrorBoundary>

              <!-- Apply -->
              <ErrorBoundary>
                <div class="w-full">
                  <h4 class="text-base">{{ displayInfoOfFeatureName('Apply') }}</h4>
                  <div class="text-sm text-void-fg-3 mt-1">Настройки кнопки Apply.</div>

                  <div class="flex flex-col gap-2 mt-3">
                    <!-- Та же модель, что у чата -->
                    <div class="flex items-center gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.syncApplyToChat"
                        @change="sapphireSettingsService.setGlobalSetting('syncApplyToChat', $event)"
                      />
                      <span class="text-void-fg-3 text-xs pointer-events-none">
                        {{
                          settingsState.globalSettings.syncApplyToChat
                            ? 'Та же модель, что у чата'
                            : 'Отдельная модель'
                        }}
                      </span>
                    </div>

                    <!-- Выбор модели -->
                    <div :class="settingsState.globalSettings.syncApplyToChat ? 'hidden' : ''">
                      <ModelDropdown
                        featureName="Apply"
                        class="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
                      />
                    </div>

                    <!-- Способ Apply: быстрый / полный -->
                    <div class="flex items-center gap-x-2">
                      <FastApplyMethodDropdown />
                    </div>
                  </div>
                </div>
              </ErrorBoundary>

              <!-- Инструменты агента -->
              <div>
                <h4 class="text-base">Инструменты</h4>
                <div class="text-sm text-void-fg-3 mt-1">
                  Функции, которые может вызывать модель. Некоторые требуют вашего подтверждения.
                </div>

                <div class="flex flex-col gap-2 mt-3">
                  <!-- Автоодобрение инструментов -->
                  <ErrorBoundary>
                    <div
                      v-for="approvalType in toolApprovalTypes"
                      :key="approvalType"
                      class="flex items-center gap-x-2"
                    >
                      <ToolApprovalTypeSwitch
                        size="xs"
                        :approvalType="approvalType"
                        :desc="`Автоодобрение: ${approvalLabel(approvalType)}`"
                      />
                    </div>
                  </ErrorBoundary>

                  <ErrorBoundary>
                    <div class="flex items-center gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.allowAgentPathsOutsideWorkspace === true"
                        @change="
                          sapphireSettingsService.setGlobalSetting(
                            'allowAgentPathsOutsideWorkspace',
                            $event,
                          )
                        "
                      />
                      <span class="text-void-fg-3 text-xs pointer-events-none">
                        Разрешить пути вне workspace (elevated)
                      </span>
                    </div>
                  </ErrorBoundary>

                  <!-- Передавать ошибки линтера в контекст -->
                  <ErrorBoundary>
                    <div class="flex items-center gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.includeToolLintErrors"
                        @change="
                          sapphireSettingsService.setGlobalSetting('includeToolLintErrors', $event)
                        "
                      />
                      <span class="text-void-fg-3 text-xs pointer-events-none">
                        Исправлять ошибки линтера
                      </span>
                    </div>
                  </ErrorBoundary>

                  <!-- Verify until green -->
                  <ErrorBoundary>
                    <div class="flex items-center gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.verifyUntilGreen"
                        @change="
                          sapphireSettingsService.setGlobalSetting('verifyUntilGreen', $event)
                        "
                      />
                      <span class="text-void-fg-3 text-xs pointer-events-none">
                        Довести до зелёного (diagnostics/тесты после правок; разово — /verify)
                      </span>
                    </div>
                  </ErrorBoundary>

                  <!-- Subagent worktrees -->
                  <ErrorBoundary>
                    <div class="flex items-center gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.subagentWorktrees"
                        @change="
                          sapphireSettingsService.setGlobalSetting('subagentWorktrees', $event)
                        "
                      />
                      <span class="text-void-fg-3 text-xs pointer-events-none">
                        Worktree для subagent (git worktree в .sapphire/worktrees/)
                      </span>
                    </div>
                  </ErrorBoundary>

                  <!-- Автопринятие правок модели -->
                  <ErrorBoundary>
                    <div class="flex items-center gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.autoAcceptLLMChanges"
                        @change="
                          sapphireSettingsService.setGlobalSetting('autoAcceptLLMChanges', $event)
                        "
                      />
                      <span class="text-void-fg-3 text-xs pointer-events-none">
                        Автопринятие изменений от модели
                      </span>
                    </div>
                  </ErrorBoundary>

                  <!-- Звук уведомления чата -->
                  <ErrorBoundary>
                    <div class="flex items-start gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.playChatNotificationSound"
                        @change="
                          sapphireSettingsService.setGlobalSetting(
                            'playChatNotificationSound',
                            $event,
                          )
                        "
                      />
                      <span class="text-void-fg-3 text-xs pointer-events-none">
                        Звуковой сигнал: окончание ответа и запрос подтверждения.
                        Нужна ненулевая громкость Accessibility → Signals
                        (accessibility.signalOptions.volume).
                      </span>
                    </div>
                  </ErrorBoundary>

                  <!-- Автоприкрепление активного файла -->
                  <ErrorBoundary>
                    <div class="flex items-start gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.autoAttachActiveFile !== false"
                        @change="
                          sapphireSettingsService.setGlobalSetting('autoAttachActiveFile', $event)
                        "
                      />
                      <div class="flex flex-col gap-0.5 pointer-events-none">
                        <span class="text-void-fg-3 text-xs">
                          Автоматически прикреплять активный файл
                        </span>
                        <span class="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                          При отправке в чат в контекст добавляется содержимое файла из активного
                          редактора. В чате это видно как чип «Активный»; × отключает только для
                          текущего сообщения.
                        </span>
                      </div>
                    </div>
                  </ErrorBoundary>

                  <!-- Эвристический поиск релевантных файлов -->
                  <ErrorBoundary>
                    <div class="flex items-start gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.autoRetrieveRelevantFiles !== false"
                        @change="
                          sapphireSettingsService.setGlobalSetting(
                            'autoRetrieveRelevantFiles',
                            $event,
                          )
                        "
                      />
                      <div class="flex flex-col gap-0.5 pointer-events-none">
                        <span class="text-void-fg-3 text-xs">
                          Автоматически находить релевантные файлы
                        </span>
                        <span class="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                          По тексту запроса ищет файлы в workspace (имя / содержимое) и добавляет
                          до трёх в контекст. Чип «Найдено»; × — не прикреплять этот файл в
                          следующий раз.
                        </span>
                      </div>
                    </div>
                  </ErrorBoundary>

                  <ErrorBoundary>
                    <div class="flex items-start gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.projectIndexEnabled !== false"
                        @change="
                          sapphireSettingsService.setGlobalSetting('projectIndexEnabled', $event)
                        "
                      />
                      <div class="flex flex-col gap-0.5 pointer-events-none">
                        <span class="text-void-fg-3 text-xs">Индексировать проект</span>
                        <span class="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                          Фоновая карта workspace в `.sapphire/index/` — ускоряет поиск файлов для
                          агента (код и документы).
                        </span>
                      </div>
                    </div>
                  </ErrorBoundary>

                  <ErrorBoundary>
                    <div class="flex items-start gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.projectIndexIncludeOffice !== false"
                        @change="
                          sapphireSettingsService.setGlobalSetting(
                            'projectIndexIncludeOffice',
                            $event,
                          )
                        "
                      />
                      <div class="flex flex-col gap-0.5 pointer-events-none">
                        <span class="text-void-fg-3 text-xs">Индексировать офисные файлы</span>
                        <span class="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                          Включать xlsx, docx, pptx и pdf в индекс проекта.
                        </span>
                      </div>
                    </div>
                  </ErrorBoundary>

                  <ErrorBoundary>
                    <div class="flex items-start gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.projectIndexLlmPurpose === true"
                        @change="
                          sapphireSettingsService.setGlobalSetting('projectIndexLlmPurpose', $event)
                        "
                      />
                      <div class="flex flex-col gap-0.5 pointer-events-none">
                        <span class="text-void-fg-3 text-xs">LLM-описания файлов (purpose)</span>
                        <span class="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                          В фоне, когда в чате нет активных запросов (модель SCM: короткое «зачем
                          файл» и теги). Пока чат занят, очередь ждёт.
                        </span>
                      </div>
                    </div>
                  </ErrorBoundary>
                </div>
              </div>

              <div class="w-full">
                <h4 class="text-base">Редактор</h4>
                <div class="text-sm text-void-fg-3 mt-1">
                  {{ `Настройки отображения подсказок ${LLM_IDE_TITLE} в редакторе кода.` }}
                </div>

                <div class="flex flex-col gap-2 mt-3">
                  <!-- Автоодобрение инструментов -->
                  <ErrorBoundary>
                    <div class="flex items-center gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.showInlineSuggestions"
                        @change="
                          sapphireSettingsService.setGlobalSetting('showInlineSuggestions', $event)
                        "
                      />
                      <span class="text-void-fg-3 text-xs pointer-events-none">
                        Показывать подсказки при выделении
                      </span>
                    </div>
                  </ErrorBoundary>
                </div>
              </div>

              <!-- SCM -->
              <ErrorBoundary>
                <div class="w-full">
                  <h4 class="text-base">{{ displayInfoOfFeatureName('SCM') }}</h4>
                  <div class="text-sm text-void-fg-3 mt-1">
                    Настройки генератора сообщений коммита.
                  </div>

                  <div class="flex flex-col gap-2 mt-3">
                    <!-- Та же модель, что у чата -->
                    <div class="flex items-center gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        :value="settingsState.globalSettings.syncSCMToChat"
                        @change="sapphireSettingsService.setGlobalSetting('syncSCMToChat', $event)"
                      />
                      <span class="text-void-fg-3 text-xs pointer-events-none">
                        {{
                          settingsState.globalSettings.syncSCMToChat
                            ? 'Та же модель, что у чата'
                            : 'Отдельная модель'
                        }}
                      </span>
                    </div>

                    <!-- Выбор модели -->
                    <div :class="settingsState.globalSettings.syncSCMToChat ? 'hidden' : ''">
                      <ModelDropdown
                        featureName="SCM"
                        class="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
                      />
                    </div>
                  </div>
                </div>
              </ErrorBoundary>
            </div>
          </ErrorBoundary>
        </div>

        <!-- Секция «Правила» -->
        <div :class="selectedSection === 'rules' ? '' : 'hidden'">
          <ErrorBoundary>
            <h2 :class="agents ? 'text-xl mb-2' : 'text-3xl mb-2'">Правила</h2>
            <p class="text-void-fg-3 text-sm mb-6">
              Общие правила проекта и ваши личные инструкции для AI.
            </p>

            <div class="flex flex-col gap-y-10">
              <div>
                <h3 class="text-lg text-void-fg-1 mb-2">Общие правила</h3>
                <div class="text-void-fg-3 text-xs mb-3">
                  Файл <code class="text-void-fg-2">.rules</code> в корне workspace — общие правила
                  команды. Их можно коммитить в репозиторий.
                </div>
                <SapphireButtonBgDarken class="px-4 py-1" @click="revealSapphireRulesFile(accessor)">
                  Открыть .rules
                </SapphireButtonBgDarken>
              </div>

              <ErrorBoundary>
                <UserRulesList />
              </ErrorBoundary>

              <div>
                <ErrorBoundary>
                  <div class="flex items-center gap-x-2">
                    <SapphireSwitch
                      size="xs"
                      :value="!!settingsState.globalSettings.disableSystemMessage"
                      @change="sapphireSettingsService.setGlobalSetting('disableSystemMessage', $event)"
                    />
                    <span class="text-void-fg-3 text-xs pointer-events-none">
                      Disable system message
                    </span>
                  </div>
                </ErrorBoundary>
                <div class="text-void-fg-3 text-xs mt-1">
                  {{
                    `Если выключено, ${LLM_IDE_TITLE} не добавит в системное сообщение ничего, кроме текста выше.`
                  }}
                </div>
              </div>
            </div>
          </ErrorBoundary>
        </div>

        <!-- Секция «Скиллы» -->
        <div :class="selectedSection === 'skills' ? '' : 'hidden'">
          <ErrorBoundary>
            <h2 :class="agents ? 'text-xl mb-2' : 'text-3xl mb-2'">Скиллы</h2>
            <p class="text-void-fg-3 text-sm mb-6">
              Инструкции для AI: в чате вызывайте через <code class="text-void-fg-2">/</code>
              (например <code class="text-void-fg-2">/design-landing</code>), либо включите Always
              on. Ниже — файл workspace и список скиллов.
            </p>

            <div class="flex flex-col gap-y-10">
              <div>
                <h3 class="text-lg text-void-fg-1 mb-2">Общие скиллы</h3>
                <div class="text-void-fg-3 text-xs mb-3">
                  Файл <code class="text-void-fg-2">.skills</code> в корне workspace — общие скиллы. Также читаются
                  <code class="text-void-fg-2">.claude/skills/*/SKILL.md</code> и
                  <code class="text-void-fg-2">.agents/skills/*/SKILL.md</code> (каталог + <code class="text-void-fg-2">/slug</code>)
                  команды. Их можно коммитить в репозиторий.
                </div>
                <SapphireButtonBgDarken
                  class="px-4 py-1"
                  @click="revealSapphireSkillsFile(accessor)"
                >
                  Открыть .skills
                </SapphireButtonBgDarken>
              </div>

              <ErrorBoundary>
                <UserSkillsList />
              </ErrorBoundary>
            </div>
          </ErrorBoundary>
        </div>

        <!-- Секция MCP -->
        <div :class="selectedSection === 'mcp' ? '' : 'hidden'">
          <ErrorBoundary>
            <h2 :class="agents ? 'text-xl mb-2' : 'text-3xl mb-2'">MCP</h2>
            <div class="text-void-fg-3 text-sm mb-6">
              <ChatMarkdownRender :inPTag="true" :string="mcpIntro" :chatMessageLocation="undefined" />
            </div>
            <div class="mb-3">
              <SapphireButtonBgDarken class="px-4 py-1 w-full max-w-48" @click="revealMcpConfig">
                Add MCP Server
              </SapphireButtonBgDarken>
            </div>

            <ErrorBoundary>
              <MCPServersList />
            </ErrorBoundary>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  </div>
</template>
