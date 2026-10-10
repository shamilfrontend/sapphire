/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FeatureName,
  isFeatureNameDisabled,
  modelSelectionsEqual,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import { useSettingsState, useAccessor } from '../util/services.js';
import { SapphireCustomDropdownBox } from '../util/inputs.js';
import { SAPPHIRE_OPEN_SETTINGS_ACTION_ID } from '../../../sapphireSettingsPane.js';
import {
  modelFilterOfFeatureName,
  ModelOption,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsService.js';
import { WarningBox } from './WarningBox.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';

const optionsEqual = (m1: ModelOption[], m2: ModelOption[]) => {
  if (m1.length !== m2.length) return false;
  for (let i = 0; i < m1.length; i++) {
    if (!modelSelectionsEqual(m1[i].selection, m2[i].selection)) return false;
  }
  return true;
};

const ModelSelectBox = ({
  options,
  featureName,
  className,
  fillWidth,
}: {
  options: ModelOption[];
  featureName: FeatureName;
  className: string;
  fillWidth?: boolean;
}) => {
  const accessor = useAccessor();
  const sapphireSettingsService = accessor.get('ISapphireSettingsService');

  const selection = sapphireSettingsService.state.modelSelectionOfFeature[featureName];
  const selectedOption = selection
    ? sapphireSettingsService.state._modelOptions.find((v) =>
        modelSelectionsEqual(v.selection, selection),
      )!
    : options[0];

  const onChangeOption = useCallback(
    (newOption: ModelOption) => {
      sapphireSettingsService.setModelSelectionOfFeature(featureName, newOption.selection);
    },
    [sapphireSettingsService, featureName],
  );

  return (
    <SapphireCustomDropdownBox
      options={options}
      selectedOption={selectedOption}
      onChangeOption={onChangeOption}
      getOptionDisplayName={(option) => option.selection.modelName}
      getOptionDropdownName={(option) => option.selection.modelName}
      getOptionDropdownDetail={(option) => option.selection.providerName}
      getOptionsEqual={(a, b) => optionsEqual([a], [b])}
      className={className}
      matchInputWidth={false}
      fillWidth={fillWidth}
    />
  );
};

const MemoizedModelDropdown = ({
  featureName,
  className,
  fillWidth,
}: {
  featureName: FeatureName;
  className: string;
  fillWidth?: boolean;
}) => {
  const settingsState = useSettingsState();
  const oldOptionsRef = useRef<ModelOption[]>([]);
  const [memoizedOptions, setMemoizedOptions] = useState(oldOptionsRef.current);

  const { filter, emptyMessage } = modelFilterOfFeatureName[featureName];

  useEffect(() => {
    const oldOptions = oldOptionsRef.current;
    const newOptions = settingsState._modelOptions.filter((o) =>
      filter(o.selection, {
        chatMode: settingsState.globalSettings.chatMode,
        overridesOfModel: settingsState.overridesOfModel,
      }),
    );

    if (!optionsEqual(oldOptions, newOptions)) {
      setMemoizedOptions(newOptions);
    }
    oldOptionsRef.current = newOptions;
  }, [settingsState._modelOptions, filter]);

  if (memoizedOptions.length === 0) {
    // Сюда не попадаем, пока не включён фильтр моделей
    return <WarningBox text={emptyMessage?.message || 'Нет доступных моделей'} />;
  }

  return (
    <ModelSelectBox
      featureName={featureName}
      options={memoizedOptions}
      className={className}
      fillWidth={fillWidth}
    />
  );
};

export const ModelDropdown = ({
  featureName,
  className,
  fillWidth,
}: {
  featureName: FeatureName;
  className: string;
  fillWidth?: boolean;
}) => {
  const settingsState = useSettingsState();

  const accessor = useAccessor();
  const commandService = accessor.get('ICommandService');

  const openSettings = () => {
    commandService.executeCommand(SAPPHIRE_OPEN_SETTINGS_ACTION_ID);
  };

  const { emptyMessage } = modelFilterOfFeatureName[featureName];

  const isDisabled = isFeatureNameDisabled(featureName, settingsState);
  if (isDisabled)
    return (
      <WarningBox
        onClick={openSettings}
        text={
          emptyMessage && emptyMessage.priority === 'always'
            ? emptyMessage.message
            : isDisabled === 'needToEnableModel'
              ? 'Включите модель'
              : isDisabled === 'addModel'
                ? 'Нет доступных моделей'
                : isDisabled === 'addProvider' || isDisabled === 'providerNotAutoDetected'
                  ? 'Нужен провайдер'
                  : 'Нужен провайдер'
        }
      />
    );

  return (
    <ErrorBoundary>
      <MemoizedModelDropdown featureName={featureName} className={className} fillWidth={fillWidth} />
    </ErrorBoundary>
  );
};
