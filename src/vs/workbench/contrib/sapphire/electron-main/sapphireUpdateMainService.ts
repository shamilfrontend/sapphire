/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { IUpdateService, State, StateType } from '../../../../platform/update/common/update.js';
import { LLM_IDE_TITLE } from '../common/llmProviderConfig.js';
import { ISapphireUpdateService } from '../common/sapphireUpdateService.js';
import { SapphireCheckUpdateRespose } from '../common/sapphireUpdateServiceTypes.js';

function responseFromUpdateState(
  state: State,
  explicit: boolean,
): SapphireCheckUpdateRespose {
  if (state.type === StateType.Disabled) {
    return {
      message: explicit ? `Автообновления ${LLM_IDE_TITLE} отключены.` : null,
    } as const;
  }
  if (state.type === StateType.Uninitialized) {
    return { message: explicit ? 'Checking for updates soon...' : null } as const;
  }
  if (state.type === StateType.Idle) {
    return { message: explicit ? 'No updates found!' : null } as const;
  }
  if (state.type === StateType.CheckingForUpdates) {
    return { message: explicit ? 'Checking for updates...' : null } as const;
  }
  if (state.type === StateType.AvailableForDownload) {
    return { message: 'A new update is available!', action: 'download' } as const;
  }
  if (state.type === StateType.Downloading) {
    return { message: explicit ? 'Currently downloading update...' : null } as const;
  }
  if (state.type === StateType.Downloaded) {
    return {
      message: explicit ? 'An update is ready to be applied!' : null,
      action: 'apply',
    } as const;
  }
  if (state.type === StateType.Updating) {
    return { message: explicit ? 'Applying update...' : null } as const;
  }
  if (state.type === StateType.Ready) {
    return { message: `Restart ${LLM_IDE_TITLE} to update!`, action: 'restart' } as const;
  }
  return { message: null } as const;
}

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

    const before = this._updateService.state.type;
    await this._updateService.checkForUpdates(false);

    // Ждём смены состояния после check (раньше читали state сразу — race).
    // Явно State: после раннего return по Disabled сужение ломает присваивание из Promise<State>.
    let state: State = this._updateService.state;
    if (state.type === StateType.CheckingForUpdates || state.type === before) {
      state = await new Promise<State>((resolve) => {
        const timeout = setTimeout(() => {
          disposable.dispose();
          resolve(this._updateService.state);
        }, 8000);
        const disposable = this._updateService.onStateChange((next) => {
          if (next.type !== StateType.CheckingForUpdates) {
            clearTimeout(timeout);
            disposable.dispose();
            resolve(next);
          }
        });
      });
    }

    return responseFromUpdateState(state, explicit);
  }
}
