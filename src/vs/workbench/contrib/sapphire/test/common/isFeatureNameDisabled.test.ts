/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SapphireSettingsState } from '../../common/sapphireSettingsService.js';
import {
  defaultGlobalSettings,
  defaultOverridesOfModel,
  defaultSettingsOfProvider,
  isFeatureNameDisabled,
  isProviderNameDisabled,
  providerNames,
} from '../../common/sapphireSettingsTypes.js';

const baseState = (): SapphireSettingsState =>
  ({
    settingsOfProvider: structuredClone(defaultSettingsOfProvider),
    modelSelectionOfFeature: {
      Chat: null,
      'Ctrl+K': null,
      Autocomplete: null,
      Apply: null,
      SCM: null,
    },
    optionsOfModelSelection: { Chat: {}, 'Ctrl+K': {}, Autocomplete: {}, Apply: {}, SCM: {} },
    overridesOfModel: structuredClone(defaultOverridesOfModel),
    globalSettings: structuredClone(defaultGlobalSettings),
    mcpUserStateOfName: {},
    _modelOptions: [],
  }) satisfies SapphireSettingsState;

type ProviderName = keyof SapphireSettingsState['settingsOfProvider'];

/** Фикстура с models: undefined — isProviderNameDisabled трактует это как пустой список. */
function withModels(
  state: SapphireSettingsState,
  providerName: ProviderName,
  models: SapphireSettingsState['settingsOfProvider'][ProviderName]['models'] | undefined,
): SapphireSettingsState {
  return {
    ...state,
    settingsOfProvider: {
      ...state.settingsOfProvider,
      [providerName]: {
        ...state.settingsOfProvider[providerName],
        models,
      },
    } as unknown as SapphireSettingsState['settingsOfProvider'],
  };
}

function withoutProvider(state: SapphireSettingsState, providerName: ProviderName): SapphireSettingsState {
  const settingsOfProvider: Partial<SapphireSettingsState['settingsOfProvider']> = {
    ...state.settingsOfProvider,
  };
  delete settingsOfProvider[providerName];
  return {
    ...state,
    settingsOfProvider: settingsOfProvider as SapphireSettingsState['settingsOfProvider'],
  };
}

function withChatModel(
  state: SapphireSettingsState,
  modelName: string,
): SapphireSettingsState {
  return {
    ...state,
    modelSelectionOfFeature: {
      ...state.modelSelectionOfFeature,
      Chat: { providerName: 'openAI', modelName },
    },
  };
}

suite('isFeatureNameDisabled / isProviderNameDisabled', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('isProviderNameDisabled tolerates missing models array', () => {
    const state = withModels(baseState(), 'openAI', undefined);

    assert.strictEqual(isProviderNameDisabled('openAI', state), 'providerNotAutoDetected');
  });

  test('isProviderNameDisabled tolerates missing provider entry', () => {
    const state = withoutProvider(baseState(), 'openAI');

    assert.strictEqual(isProviderNameDisabled('openAI', state), 'providerNotAutoDetected');
  });

  test('isFeatureNameDisabled with selected provider and undefined models does not throw', () => {
    const state = withModels(withChatModel(baseState(), 'gpt-4o'), 'openAI', undefined);

    assert.strictEqual(isFeatureNameDisabled('Chat', state), 'providerNotAutoDetected');
  });

  test('isFeatureNameDisabled scans providers with missing models without throw', () => {
    let state = baseState();
    for (const name of providerNames) {
      state = withModels(state, name, undefined);
    }

    assert.strictEqual(isFeatureNameDisabled('Chat', state), 'addProvider');
  });

  test('isProviderNameDisabled when isEnabled is false', () => {
    const state = baseState();
    state.settingsOfProvider.openAI.isEnabled = false;
    state.settingsOfProvider.openAI.models = [
      { modelName: 'gpt-4o', type: 'default', isHidden: false },
    ];

    assert.strictEqual(isProviderNameDisabled('openAI', state), 'providerDisabled');
  });

  test('isFeatureNameDisabled when selected provider is disabled', () => {
    const state = baseState();
    state.settingsOfProvider.openAI.isEnabled = false;
    state.settingsOfProvider.openAI.models = [
      { modelName: 'gpt-4o', type: 'default', isHidden: false },
    ];
    const selected = withChatModel(state, 'gpt-4o');

    assert.strictEqual(isFeatureNameDisabled('Chat', selected), 'providerDisabled');
  });
});
