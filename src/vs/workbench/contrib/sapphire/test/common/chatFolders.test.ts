/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  ChatFolder,
  chatDateGroup,
  collectDescendantFolderIds,
  folderWouldCreateCycle,
  normalizeChatFolders,
  reorderFolderAmongSiblings,
} from '../../common/chatFolders.js';

suite('chatFolders', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  const folders: ChatFolder[] = [
    { id: 'a', name: 'A', parentId: null, order: 0 },
    { id: 'b', name: 'B', parentId: 'a', order: 0 },
    { id: 'c', name: 'C', parentId: 'b', order: 0 },
  ];

  test('collectDescendantFolderIds walks nested folders', () => {
    assert.deepStrictEqual(collectDescendantFolderIds(folders, 'a').sort(), ['b', 'c']);
    assert.deepStrictEqual(collectDescendantFolderIds(folders, 'c'), []);
  });

  test('folderWouldCreateCycle rejects self and descendants', () => {
    assert.strictEqual(folderWouldCreateCycle(folders, 'a', 'c'), true);
    assert.strictEqual(folderWouldCreateCycle(folders, 'a', 'a'), true);
    assert.strictEqual(folderWouldCreateCycle(folders, 'c', 'a'), false);
    assert.strictEqual(folderWouldCreateCycle(folders, 'b', null), false);
  });

  test('normalizeChatFolders drops invalid rows and repairs missing parents', () => {
    const result = normalizeChatFolders([
      { id: 'a', name: 'A', parentId: 'missing', order: 1 },
      { id: 1, name: 'bad' },
      { id: 'b', name: 'B', parentId: 'a', order: 0 },
    ]);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].parentId, null);
    assert.strictEqual(result[1].parentId, 'a');
  });

  test('reorderFolderAmongSiblings inserts before a neighbor and appends at the end', () => {
    const list: ChatFolder[] = [
      { id: 'a', name: 'A', parentId: null, order: 0 },
      { id: 'b', name: 'B', parentId: null, order: 1 },
      { id: 'c', name: 'C', parentId: null, order: 2 },
      { id: 'nested', name: 'N', parentId: 'a', order: 0 },
    ];
    const rootIds = (items: ChatFolder[] | null) =>
      items
        ?.filter((folder) => folder.parentId === null)
        .sort((a, b) => a.order - b.order)
        .map((folder) => folder.id);
    const before = reorderFolderAmongSiblings(list, 'c', 'a');
    assert.deepStrictEqual(rootIds(before), ['c', 'a', 'b']);
    assert.deepStrictEqual(
      before
        ?.filter((folder) => folder.parentId === null)
        .sort((a, b) => a.order - b.order)
        .map((folder) => folder.order),
      [0, 1, 2],
    );
    assert.strictEqual(before?.find((folder) => folder.id === 'nested')?.order, 0);

    const appended = reorderFolderAmongSiblings(list, 'a', null);
    assert.deepStrictEqual(rootIds(appended), ['b', 'c', 'a']);
    assert.strictEqual(reorderFolderAmongSiblings(list, 'missing', 'a'), null);
    assert.strictEqual(reorderFolderAmongSiblings(list, 'a', 'nested'), null);
  });

  test('chatDateGroup uses local calendar days without overlap', () => {
    const now = new Date(2026, 8, 23, 15, 0, 0);
    const at = (year: number, month: number, day: number, hour: number) =>
      new Date(year, month, day, hour).toISOString();
    assert.strictEqual(chatDateGroup(at(2026, 8, 23, 0), now), 'today');
    assert.strictEqual(chatDateGroup(at(2026, 8, 23, 23), now), 'today');
    assert.strictEqual(chatDateGroup(at(2026, 8, 22, 23), now), 'yesterday');
    assert.strictEqual(chatDateGroup(at(2026, 8, 21, 12), now), 'week');
    assert.strictEqual(chatDateGroup(at(2026, 8, 16, 12), now), 'week');
    assert.strictEqual(chatDateGroup(at(2026, 8, 15, 12), now), 'month');
    assert.strictEqual(chatDateGroup(at(2026, 7, 24, 12), now), 'month');
    assert.strictEqual(chatDateGroup(at(2026, 7, 23, 12), now), 'older');
    assert.strictEqual(chatDateGroup('not-a-date', now), 'older');
  });
});
