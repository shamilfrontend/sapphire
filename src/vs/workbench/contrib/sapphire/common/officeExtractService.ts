/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
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
  OfficeKind,
  legacyOfficePayload,
  officeFileName,
  officeKindFromPath,
  tooLargeOfficePayload,
} from './office/officeDocument.js';

export type OfficePdfWriteResult = { ok: true; bytesWritten: number };

export interface IOfficeExtractService {
  readonly _serviceBrand: undefined;
  /** `null`, если путь не office-документ — оставляем обычное чтение текста. */
  extractIfOffice(uri: URI): Promise<OfficeExtractPayload | null>;
  /** Правка текстового слоя `.pdf` через SEARCH/REPLACE (main process пишет байты). */
  editPdf(uri: URI, searchReplaceBlocks: string): Promise<OfficePdfWriteResult>;
  /** Собрать новый текстовый `.pdf` из `newContent` и записать на диск. */
  rewritePdf(uri: URI, newContent: string): Promise<OfficePdfWriteResult>;
}

export const IOfficeExtractService = createDecorator<IOfficeExtractService>('officeExtractService');

/** Расширения, которые нельзя писать как обычный текст через edit/rewrite. */
export function isOfficeBinaryWriteBlocked(fsPath: string): OfficeKind | null {
  const kind = officeKindFromPath(fsPath);
  if (kind === 'xlsx' || kind === 'docx' || kind === 'pptx') {
    return kind;
  }
  return null;
}

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

  async editPdf(uri: URI, searchReplaceBlocks: string): Promise<OfficePdfWriteResult> {
    if (officeKindFromPath(uri.fsPath) !== 'pdf') {
      throw new Error('editPdf only supports .pdf files.');
    }
    return this.channel.call<OfficePdfWriteResult>('editPdf', {
      fsPath: uri.fsPath,
      searchReplaceBlocks,
    });
  }

  async rewritePdf(uri: URI, newContent: string): Promise<OfficePdfWriteResult> {
    if (officeKindFromPath(uri.fsPath) !== 'pdf') {
      throw new Error('rewritePdf only supports .pdf files.');
    }
    // Ensure parent path exists for new files via fileService when needed.
    if (!(await this.fileService.exists(uri))) {
      await this.fileService.createFile(uri, VSBuffer.fromString(''));
    }
    return this.channel.call<OfficePdfWriteResult>('rewritePdf', {
      fsPath: uri.fsPath,
      newContent,
    });
  }
}

registerSingleton(IOfficeExtractService, OfficeExtractService, InstantiationType.Eager);
