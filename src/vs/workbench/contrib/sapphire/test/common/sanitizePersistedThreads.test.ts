/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CHECKPOINT_SNAPSHOT_MAX_CHARS } from '../../common/agentSecurityPolicy.js';
import { sanitizeThreadsForPersist } from '../../common/sanitizePersistedThreads.js';

suite('sanitizePersistedThreads', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('caps entireFileCode on checkpoint snapshots', () => {
    const big = 'z'.repeat(CHECKPOINT_SNAPSHOT_MAX_CHARS + 50);
    const threads = sanitizeThreadsForPersist({
      t1: {
        id: 't1',
        messages: [
          {
            role: 'checkpoint',
            type: 'user_edit',
            sapphireFileSnapshotOfURI: {
              '/proj/a.ts': { snapshottedDiffAreaOfId: {}, entireFileCode: big },
            },
            userModifications: {
              sapphireFileSnapshotOfURI: {
                '/proj/b.ts': { snapshottedDiffAreaOfId: {}, entireFileCode: big },
              },
            },
          },
          { role: 'user', content: 'hi' },
        ],
      },
    });
    const cp = threads.t1.messages[0] as {
      sapphireFileSnapshotOfURI: {
        [fsPath: string]: { entireFileCode: string };
      };
      userModifications: {
        sapphireFileSnapshotOfURI: {
          [fsPath: string]: { entireFileCode: string };
        };
      };
    };
    assert.strictEqual(
      cp.sapphireFileSnapshotOfURI['/proj/a.ts'].entireFileCode.length,
      CHECKPOINT_SNAPSHOT_MAX_CHARS,
    );
    assert.strictEqual(
      cp.userModifications.sapphireFileSnapshotOfURI['/proj/b.ts'].entireFileCode.length,
      CHECKPOINT_SNAPSHOT_MAX_CHARS,
    );
    assert.strictEqual((threads.t1.messages[1] as { content: string }).content, 'hi');
  });
});
