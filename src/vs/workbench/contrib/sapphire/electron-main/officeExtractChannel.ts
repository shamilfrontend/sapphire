/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { Event } from '../../../../base/common/event.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import {
  OFFICE_MAX_FILE_BYTES,
  OfficeExtractPayload,
  officeKindFromPath,
  pdfScanWriteError,
  tooLargeOfficePayload,
} from '../common/office/officeDocument.js';
import { extractOfficeBuffer } from '../node/office/extractOfficeBuffer.js';
import { editPdfTextLayer, rewritePdfFromText } from '../node/office/writePdfBuffer.js';

type OfficeChannelArg = {
  fsPath?: string;
  searchReplaceBlocks?: string;
  newContent?: string;
};

export class OfficeExtractChannel implements IServerChannel {
  private readonly extractCache = new Map<string, { mtimeMs: number; size: number; payload: OfficeExtractPayload }>();

  listen<T>(_: unknown, _event: string): Event<T> {
    return Event.None as Event<T>;
  }

  async call<T>(_: unknown, command: string, arg?: OfficeChannelArg): Promise<T> {
    if (command === 'extract') {
      return (await this.extract(arg)) as T;
    }
    if (command === 'editPdf') {
      return (await this.editPdf(arg)) as T;
    }
    if (command === 'rewritePdf') {
      return (await this.rewritePdf(arg)) as T;
    }
    throw new Error(`Unknown office extract command: ${command}`);
  }

  private async extract(arg?: OfficeChannelArg) {
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
    const cached = this.extractCache.get(fsPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.payload;
    }
    const bytes = await fs.readFile(fsPath);
    const payload = await extractOfficeBuffer(bytes, fsPath);
    this.extractCache.set(fsPath, { mtimeMs: stat.mtimeMs, size: stat.size, payload });
    return payload;
  }

  private async editPdf(arg?: OfficeChannelArg) {
    const fsPath = arg?.fsPath;
    const searchReplaceBlocks = arg?.searchReplaceBlocks;
    if (!fsPath) {
      throw new Error('Missing file path.');
    }
    if (typeof searchReplaceBlocks !== 'string') {
      throw new Error('Missing search_replace_blocks.');
    }
    if (officeKindFromPath(fsPath) !== 'pdf') {
      throw new Error('editPdf only supports .pdf files.');
    }
    const stat = await fs.stat(fsPath);
    if (!stat.isFile()) {
      throw new Error('Not a file.');
    }
    if (stat.size > OFFICE_MAX_FILE_BYTES) {
      throw new Error('File is larger than 25 MB and was not edited.');
    }
    const current = await this.extract({ fsPath });
    const scanError = pdfScanWriteError(current, fsPath);
    if (scanError) {
      throw new Error(scanError);
    }
    const bytes = await fs.readFile(fsPath);
    const next = await editPdfTextLayer(bytes, searchReplaceBlocks, fsPath);
    this.extractCache.delete(fsPath);
    await fs.writeFile(fsPath, Buffer.from(next));
    return { ok: true as const, bytesWritten: next.byteLength };
  }

  private async rewritePdf(arg?: OfficeChannelArg) {
    const fsPath = arg?.fsPath;
    const newContent = arg?.newContent;
    if (!fsPath) {
      throw new Error('Missing file path.');
    }
    if (typeof newContent !== 'string') {
      throw new Error('Missing new_content.');
    }
    if (officeKindFromPath(fsPath) !== 'pdf') {
      throw new Error('rewritePdf only supports .pdf files.');
    }
    let existing = false;
    try {
      const stat = await fs.stat(fsPath);
      existing = stat.isFile();
    } catch {
      existing = false;
    }
    if (existing) {
      const current = await this.extract({ fsPath });
      const scanError = pdfScanWriteError(current, fsPath);
      if (scanError) {
        throw new Error(scanError);
      }
    }
    const next = await rewritePdfFromText(newContent);
    this.extractCache.delete(fsPath);
    await fs.writeFile(fsPath, Buffer.from(next));
    return { ok: true as const, bytesWritten: next.byteLength };
  }
}
