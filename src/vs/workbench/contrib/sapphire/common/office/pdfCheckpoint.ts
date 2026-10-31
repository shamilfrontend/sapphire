/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';

/** Marker in SapphireFileSnapshot.entireFileCode for binary office checkpoints. */
export const OFFICE_BINARY_SNAPSHOT_PREFIX = 'sapphire-office-b64:';

/** Older PDF checkpoints. Still restored. */
export const PDF_SNAPSHOT_PREFIX = 'sapphire-pdf-b64:';

export function encodeOfficeBinarySnapshot(bytes: VSBuffer): string {
  return OFFICE_BINARY_SNAPSHOT_PREFIX + encodeBase64(bytes);
}

export function encodePdfSnapshot(bytes: VSBuffer): string {
  return encodeOfficeBinarySnapshot(bytes);
}

export function isOfficeBinarySnapshot(entireFileCode: string): boolean {
  return entireFileCode.startsWith(OFFICE_BINARY_SNAPSHOT_PREFIX) || entireFileCode.startsWith(PDF_SNAPSHOT_PREFIX);
}

export function isPdfSnapshot(entireFileCode: string): boolean {
  return isOfficeBinarySnapshot(entireFileCode);
}

export function decodeOfficeBinarySnapshot(entireFileCode: string): VSBuffer {
  const prefix = entireFileCode.startsWith(OFFICE_BINARY_SNAPSHOT_PREFIX)
    ? OFFICE_BINARY_SNAPSHOT_PREFIX
    : PDF_SNAPSHOT_PREFIX;
  return decodeBase64(entireFileCode.slice(prefix.length));
}

export function decodePdfSnapshot(entireFileCode: string): VSBuffer {
  return decodeOfficeBinarySnapshot(entireFileCode);
}
