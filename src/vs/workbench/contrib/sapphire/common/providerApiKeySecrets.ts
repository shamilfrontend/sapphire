/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepClone } from '../../../../base/common/objects.js';
import { ProviderName, SettingsOfProvider, providerNames } from './sapphireSettingsTypes.js';

export const secretStorageKeyForProviderApiKey = (providerName: ProviderName): string =>
  `sapphire.apiKey.${providerName}`;

export type ProviderApiKeyMap = Partial<Record<ProviderName, string>>;

/** Копия settingsOfProvider без apiKey (для persist blob). */
export function stripApiKeysFromSettingsOfProvider(
  settingsOfProvider: SettingsOfProvider,
): { stripped: SettingsOfProvider; keys: ProviderApiKeyMap } {
  const stripped = deepClone(settingsOfProvider);
  const keys: ProviderApiKeyMap = {};
  for (const providerName of providerNames) {
    const entry = stripped[providerName] as { apiKey?: string } | undefined;
    if (!entry) {
      continue;
    }
    const apiKey = typeof entry.apiKey === 'string' ? entry.apiKey : '';
    if (apiKey) {
      keys[providerName] = apiKey;
    }
    entry.apiKey = undefined;
  }
  return { stripped, keys };
}

export function mergeApiKeysIntoSettingsOfProvider(
  settingsOfProvider: SettingsOfProvider,
  keys: ProviderApiKeyMap,
): SettingsOfProvider {
  const merged = deepClone(settingsOfProvider);
  for (const providerName of providerNames) {
    const key = keys[providerName];
    if (typeof key !== 'string' || !key) {
      continue;
    }
    const entry = merged[providerName] as { apiKey?: string } | undefined;
    if (entry) {
      entry.apiKey = key;
    }
  }
  return merged;
}

export function settingsOfProviderHaveEmbeddedApiKeys(
  settingsOfProvider: SettingsOfProvider,
): boolean {
  for (const providerName of providerNames) {
    const entry = settingsOfProvider[providerName] as { apiKey?: string } | undefined;
    if (typeof entry?.apiKey === 'string' && entry.apiKey.length > 0) {
      return true;
    }
  }
  return false;
}
