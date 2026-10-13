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
  formatProjectIndexError,
  kindFromPath,
  localRoleFromPath,
  parsePurposeLlmJson,
  shouldSkipPath,
} from '../../common/projectIndex/projectIndexAnalyze.js';
import type { ProjectIndexFileRecord } from '../../common/projectIndex/projectIndexTypes.js';

suite('projectIndex', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('kindFromPath maps code and office', () => {
    assert.strictEqual(kindFromPath('src/a.ts'), 'code');
    assert.strictEqual(kindFromPath('data.csv'), 'csv');
    assert.strictEqual(kindFromPath('plan.xlsx'), 'xlsx');
    assert.strictEqual(kindFromPath('pic.png'), null);
    assert.strictEqual(kindFromPath('icons/code.svg'), null);
  });

  test('shouldSkipPath skips .build artifacts', () => {
    assert.strictEqual(
      shouldSkipPath('.build/web/extensions/csharp/syntaxes/csharp.tmLanguage.json'),
      true,
    );
    assert.strictEqual(shouldSkipPath('src/a.ts'), false);
  });

  test('shouldSkipPath skips secret paths', () => {
    assert.strictEqual(shouldSkipPath('.env'), true);
    assert.strictEqual(shouldSkipPath('config/secrets.yaml'), true);
    assert.strictEqual(shouldSkipPath('certs/server.pem'), true);
  });

  test('parsePurposeLlmJson ignores trailing text after JSON object', () => {
    const parsed = parsePurposeLlmJson(
      '{"purpose":"x","tags":["a"],"when_useful":"y"}\nextra note',
    );
    assert.strictEqual(parsed.purpose, 'x');
    assert.deepStrictEqual(parsed.tags, ['a']);
    assert.strictEqual(parsed.when_useful, 'y');
  });

  test('formatProjectIndexError reads message from plain objects', () => {
    assert.strictEqual(formatProjectIndexError(new Error('boom')), 'boom');
    assert.strictEqual(formatProjectIndexError({ message: 'llm failed' }), 'llm failed');
    assert.strictEqual(formatProjectIndexError({ code: 1 }), '{"code":1}');
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
