/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

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
  }) as SapphireSettingsState;

suite('isFeatureNameDisabled / isProviderNameDisabled', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('isProviderNameDisabled tolerates missing models array', () => {
    const state = baseState();
    (state.settingsOfProvider.openAI as any).models = undefined;

    assert.strictEqual(isProviderNameDisabled('openAI', state), 'providerNotAutoDetected');
  });

  test('isProviderNameDisabled tolerates missing provider entry', () => {
    const state = baseState();
    delete (state.settingsOfProvider as any).openAI;

    assert.strictEqual(isProviderNameDisabled('openAI', state), 'providerNotAutoDetected');
  });

  test('isFeatureNameDisabled with selected provider and undefined models does not throw', () => {
    const state = baseState();
    (state as any).modelSelectionOfFeature = {
      ...state.modelSelectionOfFeature,
      Chat: { providerName: 'openAI', modelName: 'gpt-4o' },
    };
    (state.settingsOfProvider.openAI as any).models = undefined;

    assert.strictEqual(isFeatureNameDisabled('Chat', state), 'providerNotAutoDetected');
  });

  test('isFeatureNameDisabled scans providers with missing models without throw', () => {
    const state = baseState();
    for (const name of providerNames) {
      (state.settingsOfProvider[name] as any).models = undefined;
    }

    assert.strictEqual(isFeatureNameDisabled('Chat', state), 'addProvider');
  });
});
