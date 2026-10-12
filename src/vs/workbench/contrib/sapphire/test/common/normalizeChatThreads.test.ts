/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { normalizeThreadsFromStorage } from '../../common/normalizeChatThreads.js';

suite('normalizeChatThreads', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('fills missing messages and stagingSelections', () => {
    const out = normalizeThreadsFromStorage({
      t1: {
        id: 't1',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastModified: '2026-01-01T00:00:00.000Z',
        // messages / state отсутствуют — как после битого JSON hydrate
      } as any,
    });

    const thread = out.t1!;
    assert.ok(Array.isArray(thread.messages));
    assert.strictEqual(thread.messages!.length, 0);
    assert.ok(thread.state);
    assert.ok(Array.isArray(thread.state!.stagingSelections));
    assert.strictEqual(thread.state!.stagingSelections!.length, 0);
    assert.strictEqual(thread.state!.currCheckpointIdx, null);
    assert.deepStrictEqual(thread.state!.linksOfMessageIdx, {});
  });

  test('drops filesWithUserChanges and keeps valid messages', () => {
    const out = normalizeThreadsFromStorage({
      t1: {
        id: 't1',
        messages: [{ role: 'user', content: 'hi', displayContent: 'hi', selections: [], state: {} }],
        state: {
          currCheckpointIdx: 0,
          stagingSelections: [{ type: 'File', uri: {} as any, language: 'ts' }],
          linksOfMessageIdx: {},
        },
        filesWithUserChanges: { '/a.ts': true },
      } as any,
    });

    const thread = out.t1!;
    assert.strictEqual(thread.messages!.length, 1);
    assert.strictEqual((thread as any).filesWithUserChanges, undefined);
    assert.strictEqual(thread.state!.stagingSelections!.length, 1);
    assert.strictEqual(thread.state!.currCheckpointIdx, 0);
  });

  test('treats null messages / stagingSelections as empty arrays', () => {
    const out = normalizeThreadsFromStorage({
      t1: {
        id: 't1',
        messages: null,
        state: {
          stagingSelections: null,
        },
      } as any,
    });

    assert.deepStrictEqual(out.t1!.messages, []);
    assert.deepStrictEqual(out.t1!.state!.stagingSelections, []);
  });
});
