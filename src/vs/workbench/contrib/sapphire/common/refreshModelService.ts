/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ISapphireSettingsService } from './sapphireSettingsService.js';
import { ILLMMessageService } from './sendLLMMessageService.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ProviderName, providerNames, SettingsOfProvider } from './sapphireSettingsTypes.js';
import { GatewayModelResponse } from './sendLLMMessageTypes.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

type RefreshableState =
  | {
      state: 'init';
      timeoutId: null;
    }
  | {
      state: 'refreshing';
      timeoutId: NodeJS.Timeout | null; // timeoutId последнего вызова refreshModels
    }
  | {
      state: 'finished';
      timeoutId: null;
    }
  | {
      state: 'error';
      timeoutId: null;
    };

/*

user click -> error -> fire(error)
		   \> success -> fire(success)
	finally: keep polling

poll -> do not fire

*/
export type RefreshModelStateOfProvider = Record<ProviderName, RefreshableState>;

const refreshBasedOn: { [k in ProviderName]: (keyof SettingsOfProvider[k])[] } = {
  anthropic: ['_didFillInProviderSettings', 'isEnabled', 'apiKey'],
  openAI: ['_didFillInProviderSettings', 'isEnabled', 'apiKey'],
  deepseek: ['_didFillInProviderSettings', 'isEnabled', 'apiKey'],
  ollama: ['_didFillInProviderSettings', 'isEnabled', 'endpoint'],
  vLLM: ['_didFillInProviderSettings', 'isEnabled', 'endpoint'],
  openRouter: ['_didFillInProviderSettings', 'isEnabled', 'apiKey'],
  openAICompatible: ['_didFillInProviderSettings', 'isEnabled', 'endpoint', 'apiKey'],
  gemini: ['_didFillInProviderSettings', 'isEnabled', 'apiKey'],
  groq: ['_didFillInProviderSettings', 'isEnabled', 'apiKey'],
  xAI: ['_didFillInProviderSettings', 'isEnabled', 'apiKey'],
  mistral: ['_didFillInProviderSettings', 'isEnabled', 'apiKey'],
  lmStudio: ['_didFillInProviderSettings', 'isEnabled', 'endpoint'],
  liteLLM: ['_didFillInProviderSettings', 'isEnabled', 'endpoint'],
  googleVertex: ['_didFillInProviderSettings', 'isEnabled', 'project', 'region'],
  microsoftAzure: ['_didFillInProviderSettings', 'isEnabled', 'project', 'apiKey', 'azureApiVersion'],
  awsBedrock: ['_didFillInProviderSettings', 'isEnabled', 'apiKey', 'region', 'endpoint'],
};

const initialRefreshState = (): RefreshModelStateOfProvider => {
  const state = {} as RefreshModelStateOfProvider;
  for (const providerName of providerNames) {
    state[providerName] = { state: 'init', timeoutId: null };
  }
  return state;
};
const REFRESH_INTERVAL = 5_000;

const autoOptions = { enableProviderOnSuccess: true, doNotFire: true };

// поэлементное сравнение массивов
function eq<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
export interface IRefreshModelService {
  readonly _serviceBrand: undefined;
  startRefreshingModels: (
    providerName: ProviderName,
    options: { enableProviderOnSuccess: boolean; doNotFire: boolean },
  ) => void;
  onDidChangeState: Event<ProviderName>;
  state: RefreshModelStateOfProvider;
}

export const IRefreshModelService = createDecorator<IRefreshModelService>('RefreshModelService');

class RefreshModelService extends Disposable implements IRefreshModelService {
  readonly _serviceBrand: undefined;

  private readonly _onDidChangeState = new Emitter<ProviderName>();

  readonly onDidChangeState: Event<ProviderName> = this._onDidChangeState.event; // в основном для React — подписка и обновление UI

  constructor(
    @ISapphireSettingsService private readonly sapphireSettingsService: ISapphireSettingsService,
    @ILLMMessageService private readonly llmMessageService: ILLMMessageService,
  ) {
    super();

    const disposables: Set<IDisposable> = new Set();

    const initializeAutoPollingAndOnChange = () => {
      this._clearAllTimeouts();
      disposables.forEach((d) => d.dispose());
      disposables.clear();

      if (!sapphireSettingsService.state.globalSettings.autoRefreshModels) return;

      for (const providerName of providerNames) {
        this.startRefreshingModels(providerName, autoOptions);
      }

      const relevantVals = () =>
        providerNames.flatMap((providerName) =>
          refreshBasedOn[providerName].map(
            (settingName) => sapphireSettingsService.state.settingsOfProvider[providerName][settingName],
          ),
        );
      let prevVals = relevantVals();
      disposables.add(
        sapphireSettingsService.onDidChangeState(() => {
          const newVals = relevantVals();
          if (!eq(prevVals, newVals)) {
            for (const providerName of providerNames) {
              this.startRefreshingModels(providerName, {
                enableProviderOnSuccess: true,
                doNotFire: false,
              });
            }
            prevVals = newVals;
          }
        }),
      );
    };

    // После init settings и при смене autoRefreshModels — запуск polling моделей
    sapphireSettingsService.waitForInitState.then(() => {
      initializeAutoPollingAndOnChange();
      this._register(
        sapphireSettingsService.onDidChangeState((type) => {
          if (typeof type === 'object' && type[1] === 'autoRefreshModels')
            initializeAutoPollingAndOnChange();
        }),
      );
    });
  }

  state: RefreshModelStateOfProvider = initialRefreshState();

  // Запуск/перезапуск опроса списка моделей
  startRefreshingModels: IRefreshModelService['startRefreshingModels'] = (
    providerName,
    options,
  ) => {
    this._clearProviderTimeout(providerName);

    const settingsAtProvider = this.sapphireSettingsService.state.settingsOfProvider[providerName];
    if (!settingsAtProvider?._didFillInProviderSettings || settingsAtProvider.isEnabled === false) {
      this._setRefreshState(providerName, 'init', options);
      return;
    }

    this._setRefreshState(providerName, 'refreshing', options);

    const autoPoll = () => {
      if (this.sapphireSettingsService.state.globalSettings.autoRefreshModels) {
        // продолжаем auto-polling
        const timeoutId = setTimeout(
          () => this.startRefreshingModels(providerName, autoOptions),
          REFRESH_INTERVAL,
        );
        this._setTimeoutId(providerName, timeoutId);
      }
    };
    const listFn = this.llmMessageService.gatewayModelList;

    listFn({
      providerName,
      onSuccess: ({ models }) => {
        // сохраняем autodetected-модели из ответа шлюза
        this.sapphireSettingsService.setAutodetectedModels(
          providerName,
          models.map((model) => (model as GatewayModelResponse).id),
        );

        if (options.enableProviderOnSuccess)
          this.sapphireSettingsService.setSettingOfProvider(
            providerName,
            '_didFillInProviderSettings',
            true,
          );

        this._setRefreshState(providerName, 'finished', options);
        autoPoll();
      },
      onError: () => {
        this._setRefreshState(providerName, 'error', options);
        autoPoll();
      },
    });
  };

  _clearAllTimeouts() {
    for (const providerName of providerNames) {
      this._clearProviderTimeout(providerName);
    }
  }

  _clearProviderTimeout(providerName: ProviderName) {
    // отменяем предыдущий таймер polling
    if (this.state[providerName].timeoutId) {
      clearTimeout(this.state[providerName].timeoutId);
      this._setTimeoutId(providerName, null);
    }
  }

  private _setTimeoutId(providerName: ProviderName, timeoutId: NodeJS.Timeout | null) {
    this.state[providerName].timeoutId = timeoutId;
  }

  private _setRefreshState(
    providerName: ProviderName,
    state: RefreshableState['state'],
    options?: { doNotFire: boolean },
  ) {
    this.state[providerName].state = state;
    if (options?.doNotFire) return;
    this._onDidChangeState.fire(providerName);
  }
}

registerSingleton(IRefreshModelService, RefreshModelService, InstantiationType.Eager);
