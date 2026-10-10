/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useAccessor, useIsDark } from '../util/services.js';

import '../styles.css';
import { SAPPHIRE_CTRL_K_ACTION_ID, SAPPHIRE_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { MoreVertical } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SapphireSelectionHelperProps } from '../../../../../../contrib/sapphire/browser/sapphireSelectionHelperWidget.js';
import { SAPPHIRE_OPEN_SETTINGS_ACTION_ID } from '../../../sapphireSettingsPane.js';

export const SapphireSelectionHelperMain = (props: SapphireSelectionHelperProps) => {
  const isDark = useIsDark();

  return (
    <div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
      <SapphireSelectionHelper {...props} />
    </div>
  );
};

const SapphireSelectionHelper = ({ rerenderKey }: SapphireSelectionHelperProps) => {
  const accessor = useAccessor();
  const keybindingService = accessor.get('IKeybindingService');
  const commandService = accessor.get('ICommandService');

  const ctrlLKeybind = keybindingService.lookupKeybinding(SAPPHIRE_CTRL_L_ACTION_ID);
  const ctrlKKeybind = keybindingService.lookupKeybinding(SAPPHIRE_CTRL_K_ACTION_ID);

  const dividerHTML = <div className="w-[0.5px] bg-void-border-3" />;

  const [reactRerenderCount, setReactRerenderKey] = useState(rerenderKey);
  const [clickState, setClickState] = useState<'init' | 'clickedOption' | 'clickedMore'>('init');

  useEffect(() => {
    const disposable = commandService.onWillExecuteCommand((e) => {
      if (e.commandId === SAPPHIRE_CTRL_L_ACTION_ID || e.commandId === SAPPHIRE_CTRL_K_ACTION_ID) {
        setClickState('clickedOption');
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [commandService, setClickState]);

  // Сброс UI при новом rerenderKey с виджета VS Code
  if (reactRerenderCount !== rerenderKey) {
    setReactRerenderKey(rerenderKey);
    setClickState('init');
  }
  // useEffect(() => {
  // }, [rerenderKey, reactRerenderCount, setReactRerenderKey, setClickState])

  // После выбора пункта виджет скрываем

  if (clickState === 'clickedOption') {
    return null;
  }

  const defaultHTML = (
    <>
      {ctrlLKeybind && (
        <div
          className="
					flex items-center px-2 py-1.5
					cursor-pointer
				"
          onClick={() => {
            commandService.executeCommand(SAPPHIRE_CTRL_L_ACTION_ID);
            setClickState('clickedOption');
          }}
        >
          <span>Добавить в чат</span>
          <span className="ml-1 px-1 rounded bg-[var(--vscode-keybindingLabel-background)] text-[var(--vscode-keybindingLabel-foreground)] border border-[var(--vscode-keybindingLabel-border)]">
            {ctrlLKeybind.getLabel()}
          </span>
        </div>
      )}
      {ctrlLKeybind && ctrlKKeybind && dividerHTML}
      {ctrlKKeybind && (
        <div
          className="
					flex items-center px-2 py-1.5
					cursor-pointer
				"
          onClick={() => {
            commandService.executeCommand(SAPPHIRE_CTRL_K_ACTION_ID);
            setClickState('clickedOption');
          }}
        >
          <span className="ml-1">Редактировать</span>
          <span className="ml-1 px-1 rounded bg-[var(--vscode-keybindingLabel-background)] text-[var(--vscode-keybindingLabel-foreground)] border border-[var(--vscode-keybindingLabel-border)]">
            {ctrlKKeybind.getLabel()}
          </span>
        </div>
      )}

      {dividerHTML}

      <div
        className="
				flex items-center px-0.5
				cursor-pointer
			"
        onClick={() => {
          setClickState('clickedMore');
        }}
      >
        <MoreVertical className="w-4" />
      </div>
    </>
  );

  const moreOptionsHTML = (
    <>
      <div
        className="
				flex items-center px-2 py-1.5
				cursor-pointer
			"
        onClick={() => {
          commandService.executeCommand(SAPPHIRE_OPEN_SETTINGS_ACTION_ID);
          setClickState('clickedOption');
        }}
      >
        Отключить подсказки?
      </div>

      {dividerHTML}

      <div
        className="
				flex items-center px-0.5
				cursor-pointer
			"
        onClick={() => {
          setClickState('init');
        }}
      >
        <MoreVertical className="w-4" />
      </div>
    </>
  );

  return (
    <div
      className="
		pointer-events-auto select-none
		z-[1000]
		rounded-sm shadow-md flex flex-nowrap text-nowrap
		border border-void-border-3 bg-void-bg-2
		transition-all duration-200
	"
    >
      {clickState === 'init' ? defaultHTML : clickState === 'clickedMore' ? moreOptionsHTML : <></>}
    </div>
  );
};
