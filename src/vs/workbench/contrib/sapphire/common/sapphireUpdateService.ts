/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { SapphireCheckUpdateRespose } from './sapphireUpdateServiceTypes.js';

export interface ISapphireUpdateService {
  readonly _serviceBrand: undefined;
  check: (explicit: boolean) => Promise<SapphireCheckUpdateRespose>;
}

export const ISapphireUpdateService = createDecorator<ISapphireUpdateService>('SapphireUpdateService');

// реализация через IPC-канал
class SapphireUpdateService implements ISapphireUpdateService {
  readonly _serviceBrand: undefined;

  private readonly sapphireUpdateService: ISapphireUpdateService;

  constructor(
    @IMainProcessService mainProcessService: IMainProcessService, // (only usable on client side)
  ) {
    // IPC-прокси к sapphireUpdateMainService.ts
    this.sapphireUpdateService = ProxyChannel.toService<ISapphireUpdateService>(
      mainProcessService.getChannel('sapphire-channel-update'),
    );
  }

  // IPC channel требует async, даже если реализация синхронная
  check: ISapphireUpdateService['check'] = async (explicit) => {
    const res = await this.sapphireUpdateService.check(explicit);
    return res;
  };
}

registerSingleton(ISapphireUpdateService, SapphireUpdateService, InstantiationType.Eager);
