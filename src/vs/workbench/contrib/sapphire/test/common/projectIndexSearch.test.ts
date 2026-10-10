/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { searchProjectIndex } from '../../common/projectIndex/projectIndexSearch.js';
import {
  analyzeTextFile,
  contentHash,
  kindFromPath,
  localRoleFromPath,
} from '../../common/projectIndex/projectIndexAnalyze.js';
import type { ProjectIndexFileRecord } from '../../common/projectIndex/projectIndexTypes.js';

suite('projectIndex', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('kindFromPath maps code and office', () => {
    assert.strictEqual(kindFromPath('src/a.ts'), 'code');
    assert.strictEqual(kindFromPath('data.csv'), 'csv');
    assert.strictEqual(kindFromPath('plan.xlsx'), 'xlsx');
    assert.strictEqual(kindFromPath('pic.png'), null);
  });

  test('localRoleFromPath includes parent and symbols', () => {
    const role = localRoleFromPath('src/cart/Checkout.tsx', ['CheckoutForm']);
    assert.ok(role.includes('Checkout.tsx'));
    assert.ok(role.includes('CheckoutForm'));
  });

  test('analyzeTextFile extracts exports and relative imports', () => {
    const text = `
import { x } from './helper';
export function CheckoutForm() {}
export const TOTAL = 1;
`;
    const existing = new Set(['src/cart/helper.ts', 'src/cart/Checkout.tsx']);
    const result = analyzeTextFile({
      relPath: 'src/cart/Checkout.tsx',
      text,
      existingPaths: existing,
    });
    assert.ok(result.symbols.some((s) => s.symbolName === 'CheckoutForm'));
    assert.ok(result.edges.some((e) => e.toPath === 'src/cart/helper.ts'));
  });

  test('contentHash changes with content', () => {
    const a = contentHash('hello', 1, 5);
    const b = contentHash('hello!', 1, 6);
    assert.notStrictEqual(a, b);
  });

  test('searchProjectIndex ranks purpose hits', () => {
    const files: ProjectIndexFileRecord[] = [
      {
        path: 'src/cart/Checkout.tsx',
        mtime: 1,
        size: 10,
        kind: 'code',
        hash: 'a',
        localRole: 'cart checkout',
        purpose: 'Форма оформления заказа',
        tags: ['cart'],
        llmStatus: 'done',
        updatedAt: 1,
      },
      {
        path: 'README.md',
        mtime: 1,
        size: 10,
        kind: 'other',
        hash: 'b',
        localRole: 'readme',
        purpose: 'Документация',
        tags: [],
        llmStatus: 'done',
        updatedAt: 1,
      },
    ];
    const { hits } = searchProjectIndex({
      query: 'оформление заказа cart',
      files,
      chunks: [],
      symbols: [],
      pageNumber: 1,
    });
    assert.ok(hits.length >= 1);
    assert.strictEqual(hits[0].path, 'src/cart/Checkout.tsx');
  });
});
