/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import {
  InstantiationType,
  registerSingleton,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { assertPublicHttpUrl } from './webEgressPolicy.js';

export const IWebEgressService = createDecorator<IWebEgressService>('WebEgressService');

export interface IWebEgressService {
  readonly _serviceBrand: undefined;
  /** Hostname blocklist + DNS resolve в main (защита от DNS rebinding). */
  assertPublicHttpUrl(url: string): Promise<void>;
}

class WebEgressService implements IWebEgressService {
  readonly _serviceBrand: undefined;
  private readonly channel: IChannel;

  constructor(@IMainProcessService mainProcessService: IMainProcessService) {
    this.channel = mainProcessService.getChannel('sapphire-channel-webEgress');
  }

  async assertPublicHttpUrl(url: string): Promise<void> {
    // Быстрый sync fail в renderer; полный resolve — в main.
    assertPublicHttpUrl(url);
    await this.channel.call('assertPublicHttpUrl', { url });
  }
}

registerSingleton(IWebEgressService, WebEgressService, InstantiationType.Delayed);
