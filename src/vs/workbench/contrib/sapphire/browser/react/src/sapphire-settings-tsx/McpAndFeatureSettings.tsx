/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useMemo } from 'react';
import { SapphireCustomDropdownBox, SapphireSwitch } from '../util/inputs.js';
import { useAccessor, useMCPServiceState, useSettingsState } from '../util/services.js';
import { WarningBox } from './WarningBox.js';
import { ToolApprovalType } from '../../../../common/toolsServiceTypes.js';
import { MCPServer } from '../../../../common/mcpServiceTypes.js';

export const FastApplyMethodDropdown = () => {
  const accessor = useAccessor();
  const sapphireSettingsService = accessor.get('ISapphireSettingsService');

  const options = useMemo(() => [true, false], []);

  const onChangeOption = useCallback(
    (newVal: boolean) => {
      sapphireSettingsService.setGlobalSetting('enableFastApply', newVal);
    },
    [sapphireSettingsService],
  );

  return (
    <SapphireCustomDropdownBox
      className="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
      options={options}
      selectedOption={sapphireSettingsService.state.globalSettings.enableFastApply}
      onChangeOption={onChangeOption}
      getOptionDisplayName={(val) => (val ? 'Быстрый Apply' : 'Обычный Apply')}
      getOptionDropdownName={(val) => (val ? 'Быстрый Apply' : 'Обычный Apply')}
      getOptionDropdownDetail={(val) => (val ? 'Блоки Search/Replace' : 'Перезапись всего файла')}
      getOptionsEqual={(a, b) => a === b}
    />
  );
};

export const ToolApprovalTypeSwitch = ({
  approvalType,
  size,
  desc,
}: {
  approvalType: ToolApprovalType;
  size: 'xxs' | 'xs' | 'sm' | 'sm+' | 'md';
  desc: string;
}) => {
  const accessor = useAccessor();
  const sapphireSettingsService = accessor.get('ISapphireSettingsService');
  const sapphireSettingsState = useSettingsState();

  const onToggleAutoApprove = useCallback(
    (approvalType: ToolApprovalType, newValue: boolean) => {
      sapphireSettingsService.setGlobalSetting('autoApprove', {
        ...sapphireSettingsService.state.globalSettings.autoApprove,
        [approvalType]: newValue,
      });
    },
    [sapphireSettingsService],
  );

  return (
    <>
      <SapphireSwitch
        size={size}
        value={sapphireSettingsState.globalSettings.autoApprove[approvalType] ?? false}
        onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
      />
      <span className="text-void-fg-3 text-xs">{desc}</span>
    </>
  );
};

// Настройки фич и MCP

// Карточка одного MCP-сервера
const MCPServerComponent = ({ name, server }: { name: string; server: MCPServer }) => {
  const accessor = useAccessor();
  const mcpService = accessor.get('IMCPService');

  const sapphireSettings = useSettingsState();
  const isOn = sapphireSettings.mcpUserStateOfName[name]?.isOn;

  const removeUniquePrefix = (name: string) => name.split('_').slice(1).join('_');

  return (
    <div className="border border-void-border-2 bg-void-bg-1 py-3 px-4 rounded-sm">
      <div className="flex items-center justify-between">
        {/* Слева: индикатор статуса и имя */}
        <div className="flex items-center gap-2">
          {/* Цвет по status сервера */}
          <div
            className={`w-2 h-2 rounded-full
						${
              server.status === 'success'
                ? 'bg-green-500'
                : server.status === 'error'
                  ? 'bg-red-500'
                  : server.status === 'loading'
                    ? 'bg-yellow-500'
                    : server.status === 'offline'
                      ? 'bg-void-fg-3'
                      : ''
            }
					`}
          />

          {/* Имя сервера */}
          <div className="text-sm font-medium text-void-fg-1">{name}</div>
        </div>

        {/* Справа: вкл/выкл сервер */}
        <SapphireSwitch
          value={isOn ?? false}
          size="xs"
          disabled={server.status === 'error'}
          onChange={() => mcpService.toggleServerIsOn(name, !isOn)}
        />
      </div>

      {/* Список инструментов MCP */}
      {isOn && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            {(server.tools ?? []).length > 0 ? (
              (server.tools ?? []).map((tool: { name: string; description?: string }) => (
                <span
                  key={tool.name}
                  className="px-2 py-0.5 bg-void-bg-2 text-void-fg-3 rounded-sm text-xs"

                  data-tooltip-id="sapphire-tooltip"
                  data-tooltip-content={tool.description || ''}
                  data-tooltip-class-name="sapphire-max-w-[300px]"
                >
                  {removeUniquePrefix(tool.name)}
                </span>
              ))
            ) : (
              <span className="text-xs text-void-fg-3">No tools available</span>
            )}
          </div>
        </div>
      )}

      {/* Команда запуска сервера */}
      {isOn && server.command && (
        <div className="mt-3">
          <div className="text-xs text-void-fg-3 mb-1">Command:</div>
          <div className="px-2 py-1 bg-void-bg-2 text-xs font-mono overflow-x-auto whitespace-nowrap text-void-fg-2 rounded-sm">
            {server.command}
          </div>
        </div>
      )}

      {/* Текст ошибки подключения */}
      {server.error && (
        <div className="mt-3">
          <WarningBox text={server.error} />
        </div>
      )}
    </div>
  );
};

// Список всех MCP-серверов из конфигурации
export const MCPServersList = () => {
  const mcpServiceState = useMCPServiceState();

  let content: React.ReactNode;
  if (mcpServiceState.error) {
    content = <div className="text-void-fg-3 text-sm">{mcpServiceState.error}</div>;
  } else {
    const entries = Object.entries(mcpServiceState.mcpServerOfName);
    if (entries.length === 0) {
      content = <div className="text-void-fg-3 text-sm">No servers found</div>;
    } else {
      content = entries.map(([name, server]) => (
        <MCPServerComponent key={name} name={name} server={server} />
      ));
    }
  }

  return <div className="flex flex-col gap-2">{content}</div>;
};
