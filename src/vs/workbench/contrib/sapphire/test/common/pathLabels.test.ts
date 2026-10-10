/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getBasename, getFolderName, uniquePathLabels } from '../../common/pathLabels.js';

suite('pathLabels', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  suite('getBasename', () => {
    test('returns last segment', () => {
      assert.strictEqual(getBasename('src/foo/bar.ts'), 'bar.ts');
    });

    test('unixifies windows slashes', () => {
      assert.strictEqual(getBasename('src\\foo\\bar.ts'), 'bar.ts');
    });

    test('parts > 1 keeps trailing segments', () => {
      assert.strictEqual(getBasename('src/foo/bar.ts', 2), 'foo/bar.ts');
    });
  });

  suite('getFolderName', () => {
    test('root is /', () => {
      assert.strictEqual(getFolderName('/'), '/');
      assert.strictEqual(getFolderName(''), '/');
    });

    test('single folder keeps trailing slash', () => {
      assert.strictEqual(getFolderName('src'), 'src/');
      assert.strictEqual(getFolderName('src/'), 'src/');
    });

    test('nested folder uses last two parts', () => {
      assert.strictEqual(getFolderName('a/b/c'), 'b/c/');
      assert.strictEqual(getFolderName('a\\b\\c\\'), 'b/c/');
    });
  });

  suite('uniquePathLabels', () => {
    test('empty list is empty', () => {
      assert.deepStrictEqual(uniquePathLabels([]), []);
    });

    test('duplicate basenames are disambiguated', () => {
      const labels = uniquePathLabels(['src/index.ts', 'lib/index.ts']);
      assert.strictEqual(labels.length, 2);
      assert.notStrictEqual(labels[0], labels[1]);
      assert.ok(labels.some((l) => l.includes('src')));
      assert.ok(labels.some((l) => l.includes('lib')));
    });

    test('windows slashes match unix', () => {
      assert.deepStrictEqual(
        uniquePathLabels(['src\\index.ts', 'lib\\index.ts']),
        uniquePathLabels(['src/index.ts', 'lib/index.ts']),
      );
    });
  });
});
