/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import {
  InstantiationType,
  registerSingleton,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import {
  OFFICE_MAX_FILE_BYTES,
  OfficeExtractPayload,
  legacyOfficePayload,
  officeFileName,
  officeKindFromPath,
  tooLargeOfficePayload,
} from './office/officeDocument.js';

export interface IOfficeExtractService {
  readonly _serviceBrand: undefined;
  /** `null`, если путь не office-документ — оставляем обычное чтение текста. */
  extractIfOffice(uri: URI): Promise<OfficeExtractPayload | null>;
}

export const IOfficeExtractService = createDecorator<IOfficeExtractService>('officeExtractService');

class OfficeExtractService implements IOfficeExtractService {
  readonly _serviceBrand: undefined;

  private readonly channel: IChannel;

  constructor(
    @IFileService private readonly fileService: IFileService,
    @IMainProcessService mainProcessService: IMainProcessService,
  ) {
    this.channel = mainProcessService.getChannel('sapphire-channel-officeExtract');
  }

  async extractIfOffice(uri: URI): Promise<OfficeExtractPayload | null> {
    const kind = officeKindFromPath(uri.fsPath);
    if (!kind) {
      return null;
    }
    if (kind === 'legacy') {
      return legacyOfficePayload(uri.fsPath);
    }
    try {
      const stat = await this.fileService.stat(uri);
      if (stat.isDirectory) {
        return null;
      }
      if (stat.size > OFFICE_MAX_FILE_BYTES) {
        return tooLargeOfficePayload(uri.fsPath);
      }
    } catch {
      return {
        kind,
        outline: `# ${officeFileName(uri.fsPath)}`,
        body: '',
        truncated: false,
        error: 'No contents; File does not exist.',
      };
    }
    try {
      return await this.channel.call<OfficeExtractPayload>('extract', { fsPath: uri.fsPath });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not parse office file.';
      return {
        kind,
        outline: `# ${officeFileName(uri.fsPath)}`,
        body: '',
        truncated: false,
        error: message.replace(/[^\t\n\r\x20-\x7E\u00A0-\uFFFF]/g, '').slice(0, 200),
      };
    }
  }
}

registerSingleton(IOfficeExtractService, OfficeExtractService, InstantiationType.Eager);
