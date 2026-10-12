/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

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
  listen(_: unknown, _event: string): Event<any> {
    return Event.None;
  }

  async call(_: unknown, command: string, arg?: { fsPath?: string }): Promise<any> {
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
      return tooLargeOfficePayload(fsPath);
    }
    const bytes = await fs.readFile(fsPath);
    return extractOfficeBuffer(bytes, fsPath);
  }
}
