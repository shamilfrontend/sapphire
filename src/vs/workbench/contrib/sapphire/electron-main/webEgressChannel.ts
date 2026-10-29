/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as dns } from 'dns';
import { Event } from '../../../../base/common/event.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import {
  assertPublicHttpUrlAfterResolve,
  isBlockedEgressIp,
} from '../common/webEgressPolicy.js';

export class WebEgressChannel implements IServerChannel {
  listen<T>(_: unknown, _event: string): Event<T> {
    return Event.None as Event<T>;
  }

  async call<T>(_: unknown, command: string, arg?: { url?: string }): Promise<T> {
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
    const result = { ok: true as const };
    return result as T;
  }
}
