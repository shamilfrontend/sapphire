/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  manualEditBaselinesForCheckpoint,
  rememberFirstBefore,
} from '../../common/manualEditCheckpoint.js';

suite('manualEditCheckpoint', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('first checkpoint without history stores the text from before the edit', () => {
    const baselines = manualEditBaselinesForCheckpoint(
      [['/proj/notes.ts', 'const before = 1;\n']],
      {},
    );
    assert.deepStrictEqual(baselines['/proj/notes.ts'], {
      snapshottedDiffAreaOfId: {},
      entireFileCode: 'const before = 1;\n',
    });
  });

  test('a later keystroke does not replace the first baseline', () => {
    const store = new Map<string, string>();
    rememberFirstBefore(store, '/proj/notes.ts', 'const before = 1;\n');
    rememberFirstBefore(store, '/proj/notes.ts', 'const before = 12;\n');
    assert.strictEqual(store.get('/proj/notes.ts'), 'const before = 1;\n');

    const baselines = manualEditBaselinesForCheckpoint(store.entries(), {});
    assert.strictEqual(baselines['/proj/notes.ts'].entireFileCode, 'const before = 1;\n');
  });

  test('a file already in checkpoint history is left out', () => {
    const baselines = manualEditBaselinesForCheckpoint(
      [
        ['/proj/already.ts', 'old\n'],
        ['/proj/fresh.ts', 'fresh before\n'],
      ],
      { '/proj/already.ts': 3 },
    );
    assert.strictEqual(baselines['/proj/already.ts'], undefined);
    assert.strictEqual(baselines['/proj/fresh.ts'].entireFileCode, 'fresh before\n');
    assert.deepStrictEqual(baselines['/proj/fresh.ts'].snapshottedDiffAreaOfId, {});
  });
});
