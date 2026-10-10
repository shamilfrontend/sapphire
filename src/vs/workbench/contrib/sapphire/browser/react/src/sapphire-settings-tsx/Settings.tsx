/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { displayInfoOfFeatureName, LayoutMode, providerNames } from '../../../../common/sapphireSettingsTypes.js';
import { LLM_IDE_TITLE } from '../../../../common/llmProviderConfig.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { SapphireButtonBgDarken, SapphireSwitch } from '../util/inputs.js';
import { useAccessor, useIsDark, useSettingsState } from '../util/services.js';
import { ModelDropdown } from './ModelDropdown.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { LayoutModeCards } from '../util/LayoutModeCards.js';
import { toolApprovalTypes } from '../../../../common/toolsServiceTypes.js';
import { ModelDump, SettingsForProvider } from './ModelProviderSettings.js';
import { revealSapphireRulesFile, UserRulesList } from './UserRulesSettings.js';
import { revealSapphireSkillsFile, UserSkillsList } from './UserSkillsSettings.js';
import {
  FastApplyMethodDropdown,
  MCPServersList,
  ToolApprovalTypeSwitch,
} from './McpAndFeatureSettings.js';

export { ModelDump, SettingsForProvider } from './ModelProviderSettings.js';
export { ToolApprovalTypeSwitch } from './McpAndFeatureSettings.js';

type Tab = 'models' | 'providers' | 'featureOptions' | 'mcp' | 'rules' | 'skills' | 'layout';

export const Settings = ({ variant = 'editor' }: { variant?: 'editor' | 'agents' }) => {
  const isDark = useIsDark();
  const agents = variant === 'agents';
  const headingClass = agents ? 'text-xl' : 'text-3xl';
  // ─── навигация боковой панели ──────────────────────────
  const [selectedSection, setSelectedSection] = useState<Tab>('providers');

  const navItems: { tab: Tab; label: string }[] = [
    { tab: 'providers', label: 'Провайдеры' },
    { tab: 'layout', label: 'Интерфейс' },
    { tab: 'models', label: 'Модели' },
    { tab: 'featureOptions', label: 'Опции' },
    { tab: 'rules', label: 'Правила' },
    { tab: 'skills', label: 'Скиллы' },
    { tab: 'mcp', label: 'MCP' },
  ];
  const shouldShowTab = (tab: Tab) => selectedSection === tab;
  const accessor = useAccessor();
  const settingsState = useSettingsState();
  const sapphireSettingsService = accessor.get('ISapphireSettingsService');
  const mcpService = accessor.get('IMCPService');

  return (
    <div
      className={agents ? 'h-full w-full min-h-0' : `@@void-scope ${isDark ? 'dark' : ''}`}
      style={agents ? undefined : { height: '100%', width: '100%', overflow: 'auto' }}
    >
      <div
        className={
          agents
            ? 'flex h-full w-full min-h-0'
            : 'flex flex-col md:flex-row w-full gap-6 max-w-[900px] mx-auto px-6 pt-6 pb-12'
        }
      >
        <aside
          className={
            agents
              ? 'w-[200px] shrink-0 h-full overflow-y-auto border-r border-void-border-2 bg-void-bg-2 p-2'
              : 'md:w-1/4 w-full shrink-0'
          }
        >
          <div className={`flex flex-col ${agents ? 'gap-0.5' : 'gap-2'}`}>
            {navItems.map(({ tab, label }) => (
              <button
                key={tab}
                onClick={() => {
                  setSelectedSection(tab);
                }}
                className={
                  agents
                    ? `py-1.5 px-2 rounded-md text-left text-sm transition-colors ${
                        selectedSection === tab
                          ? 'bg-[#00b0cc]/20 text-void-fg-1 font-medium shadow-[inset_2px_0_0_0_#00b0cc]'
                          : 'text-void-fg-3 hover:bg-void-bg-2-hover hover:text-void-fg-1'
                      }`
                    : `py-2 px-4 rounded-md text-left transition-all duration-200 ${
                        selectedSection === tab
                          ? 'bg-[#00b0cc]/80 text-white font-medium shadow-sm'
                          : 'bg-void-bg-2 hover:bg-void-bg-2/80 text-void-fg-1'
                      }`
                }
              >
                {label}
              </button>
            ))}
          </div>
        </aside>

        <main
          className={
            agents
              ? 'flex-1 min-w-0 max-w-[800px] h-full overflow-y-auto px-6 py-4 select-none'
              : 'flex-1 select-none min-w-0'
          }
        >
          <div className={shouldShowTab('layout') ? `` : 'hidden'}>
            <ErrorBoundary>
              <h2 className={`${headingClass} mb-2`}>Интерфейс</h2>
              <p className="text-void-fg-3 text-sm leading-relaxed mb-6">
                Режим можно сменить в любой момент. В режиме IDE кнопка «Режим Агент» справа сверху,
                в режиме Агент — кнопка «Режим IDE».
              </p>
              <LayoutModeCards
                value={settingsState.globalSettings.layoutMode}
                onChange={(mode: LayoutMode) => {
                  sapphireSettingsService.setGlobalSetting('layoutMode', mode);
                }}
              />
            </ErrorBoundary>
          </div>

          {/* Секция «Модели» */}
          <div className={shouldShowTab('models') ? `` : 'hidden'}>
            <ErrorBoundary>
              <h2 className={`${headingClass} mb-2`}>Модели</h2>
              <ModelDump />
            </ErrorBoundary>
          </div>

          <div className={shouldShowTab('providers') ? `` : 'hidden'}>
            <ErrorBoundary>
              <h2 className={`${headingClass} mb-2`}>Провайдеры</h2>
              <p className="text-void-fg-3 text-sm leading-relaxed mb-6">
                У каждого провайдера свой ключ или адрес. {LLM_IDE_TITLE} отправляет запросы только
                на выбранный endpoint.
              </p>
              <div className="flex flex-col gap-8">
                {providerNames.map((providerName) => (
                  <SettingsForProvider
                    key={providerName}
                    providerName={providerName}
                    showProviderTitle={true}
                    showProviderSuggestions={true}
                  />
                ))}
              </div>
            </ErrorBoundary>
          </div>

          {/* Секция «Опции» */}
          <div className={shouldShowTab('featureOptions') ? `` : 'hidden'}>
            <ErrorBoundary>
              <h2 className={`${headingClass} mb-6`}>Опции</h2>

              <div className="flex flex-col gap-y-8">
                <ErrorBoundary>
                  {/* FIM */}
                  <div>
                    <h4 className="text-base">{displayInfoOfFeatureName('Autocomplete')}</h4>
                    <div className="text-sm text-void-fg-3 mt-1">
                      <span>Экспериментально. </span>
                      <span
                        className="hover:brightness-110 cursor-help border-b border-dotted border-void-fg-3/40"
                        data-tooltip-id="sapphire-tooltip"
                        data-tooltip-content="FIM (Fill-In-the-Middle) — модель дописывает код с учётом текста и слева, и справа от курсора. Обычные chat-модели этого не умеют: для автодополнения нужна модель с поддержкой FIM (например, qwen3-8B)."
                        data-tooltip-place="top"
                        data-tooltip-class-name="sapphire-max-w-[300px]"
                      >
                        Только для FIM-моделей.*
                      </span>
                    </div>
                    <div className="text-sm text-void-fg-3 mt-1 max-w-xl">
                      FIM (Fill-In-the-Middle) — способ автодополнения, при котором модель видит код
                      до и после курсора и вставляет продолжение посередине. Без поддержки FIM
                      подсказки в редакторе работать не будут.
                    </div>

                    <div className="flex flex-col gap-2 mt-3">
                      {/* Включить автодополнение */}
                      <ErrorBoundary>
                        <div className="flex items-center gap-x-2">
                          <SapphireSwitch
                            size="xs"
                            value={settingsState.globalSettings.enableAutocomplete}
                            onChange={(newVal) =>
                              sapphireSettingsService.setGlobalSetting('enableAutocomplete', newVal)
                            }
                          />
                          <span className="text-void-fg-3 text-xs pointer-events-none">
                            {settingsState.globalSettings.enableAutocomplete
                              ? 'Включено'
                              : 'Выключено'}
                          </span>
                        </div>
                      </ErrorBoundary>

                      {/* Выбор модели */}
                      <ErrorBoundary>
                        <div
                          className={`${!settingsState.globalSettings.enableAutocomplete ? 'hidden' : ''}`}
                        >
                          <ModelDropdown
                            featureName="Autocomplete"
                            className="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
                          />
                        </div>
                      </ErrorBoundary>
                    </div>
                  </div>
                </ErrorBoundary>

                {/* Apply */}
                <ErrorBoundary>
                  <div className="w-full">
                    <h4 className="text-base">{displayInfoOfFeatureName('Apply')}</h4>
                    <div className="text-sm text-void-fg-3 mt-1">Настройки кнопки Apply.</div>

                    <div className="flex flex-col gap-2 mt-3">
                      {/* Та же модель, что у чата */}
                      <div className="flex items-center gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.syncApplyToChat}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting('syncApplyToChat', newVal)
                          }
                        />
                        <span className="text-void-fg-3 text-xs pointer-events-none">
                          {settingsState.globalSettings.syncApplyToChat
                            ? 'Та же модель, что у чата'
                            : 'Отдельная модель'}
                        </span>
                      </div>

                      {/* Выбор модели */}
                      <div
                        className={`${settingsState.globalSettings.syncApplyToChat ? 'hidden' : ''}`}
                      >
                        <ModelDropdown
                          featureName="Apply"
                          className="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
                        />
                      </div>

                      {/* Способ Apply: быстрый / полный */}
                      <div className="flex items-center gap-x-2">
                        <FastApplyMethodDropdown />
                      </div>
                    </div>
                  </div>
                </ErrorBoundary>

                {/* Инструменты агента */}
                <div>
                  <h4 className="text-base">Инструменты</h4>
                  <div className="text-sm text-void-fg-3 mt-1">
                    Функции, которые может вызывать модель. Некоторые требуют вашего подтверждения.
                  </div>

                  <div className="flex flex-col gap-2 mt-3">
                    {/* Автоодобрение инструментов */}
                    <ErrorBoundary>
                      {[...toolApprovalTypes].map((approvalType) => {
                        const approvalLabel =
                          approvalType === 'edits'
                            ? 'правки'
                            : approvalType === 'terminal'
                              ? 'терминал'
                              : 'MCP';
                        return (
                          <div key={approvalType} className="flex items-center gap-x-2">
                            <ToolApprovalTypeSwitch
                              size="xs"
                              approvalType={approvalType}
                              desc={`Автоодобрение: ${approvalLabel}`}
                            />
                          </div>
                        );
                      })}
                    </ErrorBoundary>

                    {/* Передавать ошибки линтера в контекст */}
                    <ErrorBoundary>
                      <div className="flex items-center gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.includeToolLintErrors}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting('includeToolLintErrors', newVal)
                          }
                        />
                        <span className="text-void-fg-3 text-xs pointer-events-none">
                          Исправлять ошибки линтера
                        </span>
                      </div>
                    </ErrorBoundary>

                    {/* Автопринятие правок модели */}
                    <ErrorBoundary>
                      <div className="flex items-center gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.autoAcceptLLMChanges}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting('autoAcceptLLMChanges', newVal)
                          }
                        />
                        <span className="text-void-fg-3 text-xs pointer-events-none">
                          Автопринятие изменений от модели
                        </span>
                      </div>
                    </ErrorBoundary>

                    {/* Звук уведомления чата */}
                    <ErrorBoundary>
                      <div className="flex items-center gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.playChatNotificationSound}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting(
                              'playChatNotificationSound',
                              newVal,
                            )
                          }
                        />
                        <span className="text-void-fg-3 text-xs pointer-events-none">
                          Звуковой сигнал: окончание ответа и запрос подтверждения
                        </span>
                      </div>
                    </ErrorBoundary>

                    {/* Автоприкрепление активного файла */}
                    <ErrorBoundary>
                      <div className="flex items-start gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.autoAttachActiveFile !== false}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting('autoAttachActiveFile', newVal)
                          }
                        />
                        <div className="flex flex-col gap-0.5 pointer-events-none">
                          <span className="text-void-fg-3 text-xs">
                            Автоматически прикреплять активный файл
                          </span>
                          <span className="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                            При отправке в чат в контекст добавляется содержимое файла из активного
                            редактора. В чате это видно как чип «Активный»; × отключает только для
                            текущего сообщения.
                          </span>
                        </div>
                      </div>
                    </ErrorBoundary>

                    {/* Эвристический поиск релевантных файлов */}
                    <ErrorBoundary>
                      <div className="flex items-start gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.autoRetrieveRelevantFiles !== false}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting(
                              'autoRetrieveRelevantFiles',
                              newVal,
                            )
                          }
                        />
                        <div className="flex flex-col gap-0.5 pointer-events-none">
                          <span className="text-void-fg-3 text-xs">
                            Автоматически находить релевантные файлы
                          </span>
                          <span className="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                            По тексту запроса ищет файлы в workspace (имя / содержимое) и добавляет
                            до трёх в контекст. Чип «Найдено»; × — не прикреплять этот файл в
                            следующий раз.
                          </span>
                        </div>
                      </div>
                    </ErrorBoundary>

                    <ErrorBoundary>
                      <div className="flex items-start gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.projectIndexEnabled !== false}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting('projectIndexEnabled', newVal)
                          }
                        />
                        <div className="flex flex-col gap-0.5 pointer-events-none">
                          <span className="text-void-fg-3 text-xs">Индексировать проект</span>
                          <span className="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                            Фоновая карта workspace в `.sapphire/index/` — ускоряет поиск файлов для
                            агента (код и документы).
                          </span>
                        </div>
                      </div>
                    </ErrorBoundary>

                    <ErrorBoundary>
                      <div className="flex items-start gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.projectIndexIncludeOffice !== false}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting(
                              'projectIndexIncludeOffice',
                              newVal,
                            )
                          }
                        />
                        <div className="flex flex-col gap-0.5 pointer-events-none">
                          <span className="text-void-fg-3 text-xs">
                            Индексировать офисные файлы
                          </span>
                          <span className="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                            Включать xlsx, docx, pptx и pdf в индекс проекта.
                          </span>
                        </div>
                      </div>
                    </ErrorBoundary>

                    <ErrorBoundary>
                      <div className="flex items-start gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.projectIndexLlmPurpose !== false}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting('projectIndexLlmPurpose', newVal)
                          }
                        />
                        <div className="flex flex-col gap-0.5 pointer-events-none">
                          <span className="text-void-fg-3 text-xs">
                            LLM-описания файлов (purpose)
                          </span>
                          <span className="text-void-fg-3 text-[11px] opacity-80 leading-snug">
                            Фоном через модель SCM пишет короткое «зачем файл» и теги.
                          </span>
                        </div>
                      </div>
                    </ErrorBoundary>
                  </div>
                </div>

                <div className="w-full">
                  <h4 className="text-base">Редактор</h4>
                  <div className="text-sm text-void-fg-3 mt-1">
                    {`Настройки отображения подсказок ${LLM_IDE_TITLE} в редакторе кода.`}
                  </div>

                  <div className="flex flex-col gap-2 mt-3">
                    {/* Автоодобрение инструментов */}
                    <ErrorBoundary>
                      <div className="flex items-center gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.showInlineSuggestions}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting('showInlineSuggestions', newVal)
                          }
                        />
                        <span className="text-void-fg-3 text-xs pointer-events-none">
                          Показывать подсказки при выделении
                        </span>
                      </div>
                    </ErrorBoundary>
                  </div>
                </div>

                {/* SCM */}
                <ErrorBoundary>
                  <div className="w-full">
                    <h4 className="text-base">{displayInfoOfFeatureName('SCM')}</h4>
                    <div className="text-sm text-void-fg-3 mt-1">
                      Настройки генератора сообщений коммита.
                    </div>

                    <div className="flex flex-col gap-2 mt-3">
                      {/* Та же модель, что у чата */}
                      <div className="flex items-center gap-x-2">
                        <SapphireSwitch
                          size="xs"
                          value={settingsState.globalSettings.syncSCMToChat}
                          onChange={(newVal) =>
                            sapphireSettingsService.setGlobalSetting('syncSCMToChat', newVal)
                          }
                        />
                        <span className="text-void-fg-3 text-xs pointer-events-none">
                          {settingsState.globalSettings.syncSCMToChat
                            ? 'Та же модель, что у чата'
                            : 'Отдельная модель'}
                        </span>
                      </div>

                      {/* Выбор модели */}
                      <div
                        className={`${settingsState.globalSettings.syncSCMToChat ? 'hidden' : ''}`}
                      >
                        <ModelDropdown
                          featureName="SCM"
                          className="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
                        />
                      </div>
                    </div>
                  </div>
                </ErrorBoundary>
              </div>
            </ErrorBoundary>
          </div>

          {/* Секция «Правила» */}
          <div className={shouldShowTab('rules') ? `` : 'hidden'}>
            <ErrorBoundary>
              <h2 className={`${headingClass} mb-2`}>Правила</h2>
              <p className="text-void-fg-3 text-sm mb-6">
                Общие правила проекта и ваши личные инструкции для AI.
              </p>

              <div className="flex flex-col gap-y-10">
                <div>
                  <h3 className="text-lg text-void-fg-1 mb-2">Общие правила</h3>
                  <div className="text-void-fg-3 text-xs mb-3">
                    Файл <code className="text-void-fg-2">.rules</code> в корне workspace —
                    общие правила команды. Их можно коммитить в репозиторий.
                  </div>
                  <SapphireButtonBgDarken
                    className="px-4 py-1"
                    onClick={() => {
                      revealSapphireRulesFile(accessor);
                    }}
                  >
                    Открыть .rules
                  </SapphireButtonBgDarken>
                </div>

                <ErrorBoundary>
                  <UserRulesList />
                </ErrorBoundary>

                <div>
                  <ErrorBoundary>
                    <div className="flex items-center gap-x-2">
                      <SapphireSwitch
                        size="xs"
                        value={!!settingsState.globalSettings.disableSystemMessage}
                        onChange={(newValue) => {
                          sapphireSettingsService.setGlobalSetting('disableSystemMessage', newValue);
                        }}
                      />
                      <span className="text-void-fg-3 text-xs pointer-events-none">
                        Disable system message
                      </span>
                    </div>
                  </ErrorBoundary>
                  <div className="text-void-fg-3 text-xs mt-1">
                    {`Если выключено, ${LLM_IDE_TITLE} не добавит в системное сообщение ничего, кроме текста выше.`}
                  </div>
                </div>
              </div>
            </ErrorBoundary>
          </div>

          {/* Секция «Скиллы» */}
          <div className={shouldShowTab('skills') ? `` : 'hidden'}>
            <ErrorBoundary>
              <h2 className={`${headingClass} mb-2`}>Скиллы</h2>
              <p className="text-void-fg-3 text-sm mb-6">
                Инструкции для AI: в чате вызывайте через{' '}
                <code className="text-void-fg-2">/</code> (например{' '}
                <code className="text-void-fg-2">/design-landing</code>), либо включите Always on.
                Ниже — файл workspace и список скиллов.
              </p>

              <div className="flex flex-col gap-y-10">
                <div>
                  <h3 className="text-lg text-void-fg-1 mb-2">Общие скиллы</h3>
                  <div className="text-void-fg-3 text-xs mb-3">
                    Файл <code className="text-void-fg-2">.skills</code> в корне workspace —
                    общие скиллы команды. Их можно коммитить в репозиторий.
                  </div>
                  <SapphireButtonBgDarken
                    className="px-4 py-1"
                    onClick={() => {
                      revealSapphireSkillsFile(accessor);
                    }}
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

          {/* Секция MCP */}
          <div className={shouldShowTab('mcp') ? `` : 'hidden'}>
            <ErrorBoundary>
              <h2 className={`${headingClass} mb-2`}>MCP</h2>
              <div className="text-void-fg-3 text-sm mb-6">
                <ChatMarkdownRender
                  inPTag
                  string={`
Use Model Context Protocol to provide Agent mode with more tools.
							`}
                  chatMessageLocation={undefined}
                />
              </div>
              <div className="mb-3">
                <SapphireButtonBgDarken
                  className="px-4 py-1 w-full max-w-48"
                  onClick={async () => {
                    await mcpService.revealMCPConfigFile();
                  }}
                >
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
  );
};
