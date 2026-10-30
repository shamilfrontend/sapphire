/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';

/** Marker in SapphireFileSnapshot.entireFileCode for binary PDF checkpoints. */
export const PDF_SNAPSHOT_PREFIX = 'sapphire-pdf-b64:';

export function encodePdfSnapshot(bytes: VSBuffer): string {
  return PDF_SNAPSHOT_PREFIX + encodeBase64(bytes);
}

export function isPdfSnapshot(entireFileCode: string): boolean {
  return entireFileCode.startsWith(PDF_SNAPSHOT_PREFIX);
}

export function decodePdfSnapshot(entireFileCode: string): VSBuffer {
  return decodeBase64(entireFileCode.slice(PDF_SNAPSHOT_PREFIX.length));
}
