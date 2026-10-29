/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import { normalizeThreadsFromStorage, NormalizableChatThread } from '../../common/normalizeChatThreads.js';

suite('normalizeChatThreads', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('fills missing messages and stagingSelections', () => {
    const out = normalizeThreadsFromStorage({
      t1: {
        id: 't1',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastModified: '2026-01-01T00:00:00.000Z',
        // messages / state отсутствуют — как после битого JSON hydrate
      } satisfies NormalizableChatThread,
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
        messages: [{
          role: 'user',
          content: 'hi',
          displayContent: 'hi',
          selections: [],
          state: { stagingSelections: [], isBeingEdited: false },
        }],
        state: {
          currCheckpointIdx: 0,
          stagingSelections: [{ type: 'File', uri: URI.file('/a.ts'), language: 'ts' }],
          linksOfMessageIdx: {},
          chatMode: 'plan',
        },
        filesWithUserChanges: { '/a.ts': true },
      } satisfies NormalizableChatThread,
    });

    const thread = out.t1!;
    assert.strictEqual(thread.messages!.length, 1);
    assert.strictEqual(thread.filesWithUserChanges, undefined);
    assert.strictEqual(thread.state!.stagingSelections!.length, 1);
    assert.strictEqual(thread.state!.currCheckpointIdx, 0);
    assert.strictEqual(thread.state!.chatMode, 'plan');
  });

  test('rewrites retired debug mode to agent', () => {
    const out = normalizeThreadsFromStorage({
      t1: {
        id: 't1',
        messages: [],
        state: {
          currCheckpointIdx: null,
          stagingSelections: [],
          linksOfMessageIdx: {},
          chatMode: 'debug',
        },
      } satisfies NormalizableChatThread,
    });

    assert.strictEqual(out.t1!.state!.chatMode, 'agent');
  });

  test('treats null messages / stagingSelections as empty arrays', () => {
    const out = normalizeThreadsFromStorage({
      t1: {
        id: 't1',
        messages: null,
        state: {
          stagingSelections: null,
        },
      } satisfies NormalizableChatThread,
    });

    assert.deepStrictEqual(out.t1!.messages, []);
    assert.deepStrictEqual(out.t1!.state!.stagingSelections, []);
  });
});
