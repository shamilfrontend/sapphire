/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { Event } from '../../../../base/common/event.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import {
  OFFICE_MAX_FILE_BYTES,
  officeKindFromPath,
  tooLargeOfficePayload,
} from '../common/office/officeDocument.js';
import { extractOfficeBuffer } from '../node/office/extractOfficeBuffer.js';

export class OfficeExtractChannel implements IServerChannel {
  listen<T>(_: unknown, _event: string): Event<T> {
    return Event.None as Event<T>;
  }

  async call<T>(_: unknown, command: string, arg?: { fsPath?: string }): Promise<T> {
    if (command !== 'extract') {
      throw new Error(`Unknown office extract command: ${command}`);
    }
    const fsPath = arg?.fsPath;
    if (!fsPath) {
      throw new Error('Missing file path.');
    }
    const kind = officeKindFromPath(fsPath);
    if (!kind || kind === 'legacy') {
      throw new Error('Not an office document.');
    }
    const stat = await fs.stat(fsPath);
    if (!stat.isFile()) {
      throw new Error('Not a file.');
    }
    if (stat.size > OFFICE_MAX_FILE_BYTES) {
      return tooLargeOfficePayload(fsPath) as T;
    }
    const bytes = await fs.readFile(fsPath);
    return (await extractOfficeBuffer(bytes, fsPath)) as T;
  }
}
