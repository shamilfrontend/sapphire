/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { deepClone } from '../../../../../base/common/objects.js';
import { defaultSettingsOfProvider } from '../../common/sapphireSettingsTypes.js';
import {
  mergeApiKeysIntoSettingsOfProvider,
  secretStorageKeyForProviderApiKey,
  settingsOfProviderHaveEmbeddedApiKeys,
  stripApiKeysFromSettingsOfProvider,
} from '../../common/providerApiKeySecrets.js';

suite('providerApiKeySecrets', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('secretStorageKeyForProviderApiKey is stable', () => {
    assert.strictEqual(secretStorageKeyForProviderApiKey('openAI'), 'sapphire.apiKey.openAI');
  });

  test('strip removes apiKey and extract returns them', () => {
    const settings = deepClone(defaultSettingsOfProvider);
    (settings.openAI as { apiKey?: string }).apiKey = 'sk-test';
    (settings.anthropic as { apiKey?: string }).apiKey = 'ant-key';

    assert.strictEqual(settingsOfProviderHaveEmbeddedApiKeys(settings), true);

    const { stripped, keys } = stripApiKeysFromSettingsOfProvider(settings);
    assert.strictEqual(keys.openAI, 'sk-test');
    assert.strictEqual(keys.anthropic, 'ant-key');
    assert.strictEqual((stripped.openAI as { apiKey?: string }).apiKey, undefined);
    assert.strictEqual(settingsOfProviderHaveEmbeddedApiKeys(stripped), false);
  });

  test('merge restores apiKeys into settings', () => {
    const settings = deepClone(defaultSettingsOfProvider);
    const merged = mergeApiKeysIntoSettingsOfProvider(settings, {
      openAI: 'sk-restored',
    });
    assert.strictEqual((merged.openAI as { apiKey?: string }).apiKey, 'sk-restored');
    assert.strictEqual((settings.openAI as { apiKey?: string }).apiKey, undefined);
  });
});
