/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { promises as dns } from 'dns';
import { Event } from '../../../../base/common/event.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import {
  assertPublicHttpUrlAfterResolve,
  isBlockedEgressIp,
} from '../common/webEgressPolicy.js';

export class WebEgressChannel implements IServerChannel {
  listen(_: unknown, _event: string): Event<any> {
    return Event.None;
  }

  async call(_: unknown, command: string, arg?: { url?: string }): Promise<any> {
    if (command !== 'assertPublicHttpUrl') {
      throw new Error(`Unknown web egress command: ${command}`);
    }
    const urlStr = arg?.url;
    if (!urlStr || typeof urlStr !== 'string') {
      throw new Error('Missing url.');
    }
    await assertPublicHttpUrlAfterResolve(urlStr, async (hostname) => {
      if (isBlockedEgressIp(hostname)) {
        return [hostname];
      }
      const results = await dns.lookup(hostname, { all: true, verbatim: true });
      return results.map((r) => r.address);
    });
    return { ok: true as const };
  }
}
