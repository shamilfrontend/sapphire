/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { capEntireFileCodeForStorage } from './agentSecurityPolicy.js';
import type { SapphireFileSnapshot } from './editCodeServiceTypes.js';

type SnapshotMap = { [fsPath: string]: SapphireFileSnapshot | undefined };

type PersistableMessage = {
  role?: unknown;
  sapphireFileSnapshotOfURI?: SnapshotMap;
  userModifications?: {
    sapphireFileSnapshotOfURI?: SnapshotMap;
  } | null;
};

type PersistableThread = {
  messages?: Array<PersistableMessage | null | undefined>;
};

function capSnapshotMap(map: SnapshotMap | undefined): SnapshotMap | undefined {
  if (!map) {
    return map;
  }
  const out: SnapshotMap = {};
  for (const fsPath of Object.keys(map)) {
    const snap = map[fsPath];
    if (!snap) {
      out[fsPath] = snap;
      continue;
    }
    out[fsPath] = {
      ...snap,
      entireFileCode: capEntireFileCodeForStorage(snap.entireFileCode),
    };
  }
  return out;
}

/**
 * Перед persist: обрезает entireFileCode в checkpoint-снимках,
 * чтобы APPLICATION storage не раздувался полными копиями файлов.
 */
export function sanitizeThreadsForPersist<
  T extends Record<string, PersistableThread | undefined>,
>(threads: T): T {
  const out: { [id: string]: PersistableThread | undefined } = {};
  for (const id of Object.keys(threads)) {
    const thread = threads[id];
    if (!thread?.messages) {
      out[id] = thread;
      continue;
    }
    out[id] = {
      ...thread,
      messages: thread.messages.map((m) => {
        if (!m || m.role !== 'checkpoint') {
          return m;
        }
        return {
          ...m,
          sapphireFileSnapshotOfURI: capSnapshotMap(m.sapphireFileSnapshotOfURI),
          userModifications: m.userModifications
            ? {
                ...m.userModifications,
                sapphireFileSnapshotOfURI: capSnapshotMap(
                  m.userModifications.sapphireFileSnapshotOfURI,
                ),
              }
            : m.userModifications,
        };
      }),
    };
  }
  return out as T;
}
