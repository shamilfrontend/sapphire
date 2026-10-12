/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { LLM_IDE_TITLE } from '../common/llmProviderConfig.js';
import { ISapphireUpdateService } from '../common/sapphireUpdateService.js';
import { SapphireCheckUpdateRespose } from '../common/sapphireUpdateServiceTypes.js';

export class SapphireMainUpdateService extends Disposable implements ISapphireUpdateService {
  _serviceBrand: undefined;

  constructor(
    @IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
    @IUpdateService private readonly _updateService: IUpdateService,
  ) {
    super();
  }

  async check(explicit: boolean): Promise<SapphireCheckUpdateRespose> {
    const isDevMode = !this._envMainService.isBuilt; // см. abstractUpdateService.ts

    if (isDevMode) {
      return { message: null } as const;
    }

    // Без explicit не показываем UI, если автообновления отключены
    if (this._updateService.state.type === StateType.Disabled) {
      if (!explicit) {
        return { message: null } as const;
      }
      return {
        message: `Автообновления ${LLM_IDE_TITLE} отключены.`,
      } as const;
    }

    this._updateService.checkForUpdates(false); // неявная проверка, результат интерпретируем сами

    console.log('updateState', this._updateService.state);

    if (this._updateService.state.type === StateType.Uninitialized) {
      // Сервис обновлений ещё не инициализирован
      return { message: explicit ? 'Checking for updates soon...' : null } as const;
    }

    if (this._updateService.state.type === StateType.Idle) {
      // Обновлений нет
      return { message: explicit ? 'No updates found!' : null } as const;
    }

    if (this._updateService.state.type === StateType.CheckingForUpdates) {
      // Идёт проверка
      return { message: explicit ? 'Checking for updates...' : null } as const;
    }

    if (this._updateService.state.type === StateType.AvailableForDownload) {
      // Есть обновление, нужна ручная загрузка (часто Linux)
      return { message: 'A new update is available!', action: 'download' } as const;
    }

    if (this._updateService.state.type === StateType.Downloading) {
      // Загрузка обновления
      return { message: explicit ? 'Currently downloading update...' : null } as const;
    }

    if (this._updateService.state.type === StateType.Downloaded) {
      // Скачано, можно применить
      return {
        message: explicit ? 'An update is ready to be applied!' : null,
        action: 'apply',
      } as const;
    }

    if (this._updateService.state.type === StateType.Updating) {
      // Применение обновления
      return { message: explicit ? 'Applying update...' : null } as const;
    }

    if (this._updateService.state.type === StateType.Ready) {
      // Готово к перезапуску
      return { message: `Restart ${LLM_IDE_TITLE} to update!`, action: 'restart' } as const;
    }

    return null;
  }
}
