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
  layerFromPath,
  localRoleFromPath,
  parsePurposeLlmJson,
  resolveAssetSpecifier,
  shouldSkipPath,
} from '../../common/projectIndex/projectIndexAnalyze.js';
import {
  buildProjectIndexImpact,
  formatProjectIndexImpact,
} from '../../common/projectIndex/projectIndexImpact.js';
import {
  buildTourPromptInput,
  formatTourForAgent,
  isTourStale,
  parseTourLlmJson,
  tourStepAt,
} from '../../common/projectIndex/projectIndexTour.js';
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
    assert.ok(result.symbols.some((s) => s.symbolName === 'CheckoutForm' && s.startLine >= 1));
    assert.ok(result.edges.some((e) => e.toPath === 'src/cart/helper.ts' && e.type === 'imports'));
  });

  test('analyzeTextFile links HTML link/script and CSS @import', () => {
    const existing = new Set(['index.html', 'styles.css', 'app.js', 'theme.css']);
    const html = analyzeTextFile({
      relPath: 'index.html',
      text: '<link rel="stylesheet" href="styles.css"><script src="./app.js"></script>',
      existingPaths: existing,
    });
    assert.ok(html.edges.some((e) => e.type === 'imports' && e.toPath === 'styles.css'));
    assert.ok(html.edges.some((e) => e.type === 'imports' && e.toPath === 'app.js'));
    assert.ok(!html.edges.some((e) => e.toPath.includes('http')));

    const css = analyzeTextFile({
      relPath: 'styles.css',
      text: '@import url("theme.css");\nbody { background: url(https://cdn.example/bg.png); }',
      existingPaths: existing,
    });
    assert.ok(css.edges.some((e) => e.type === 'imports' && e.toPath === 'theme.css'));
    assert.ok(!css.edges.some((e) => /cdn\.example/.test(e.toPath)));
  });

  test('resolveAssetSpecifier accepts bare relative paths', () => {
    const existing = new Set(['app/styles.css']);
    assert.strictEqual(
      resolveAssetSpecifier('app/index.html', 'styles.css', existing),
      'app/styles.css',
    );
    assert.strictEqual(
      resolveAssetSpecifier('app/index.html', 'https://cdn.example/a.css', existing),
      null,
    );
  });

  test('analyzeTextFile resolves nested methods and calls, skips packages', () => {
    const text = [
      "import { pay } from './billing';",
      "import React from 'react';",
      '',
      'export class Cart {',
      '  checkout() {',
      '    pay();',
      '  }',
      '}',
      '',
      'export function unused() {',
      '  return 1;',
      '}',
      '',
    ].join('\n');
    const existing = new Set(['src/cart/Checkout.tsx', 'src/cart/billing.ts']);
    const result = analyzeTextFile({
      relPath: 'src/cart/Checkout.tsx',
      text,
      existingPaths: existing,
    });
    const method = result.symbols.find((s) => s.symbolName === 'Cart.checkout');
    if (!method) {
      throw new Error('missing Cart.checkout');
    }
    assert.strictEqual(method.owner, 'Cart');
    assert.strictEqual(method.startLine, 5);
    assert.strictEqual(method.endLine, 7);
    assert.ok(result.symbols.some((s) => s.symbolName === 'Cart' && s.kind === 'class'));
    assert.ok(result.edges.some((e) => e.type === 'contains' && e.toSymbol === 'Cart.checkout'));
    assert.ok(
      result.edges.some(
        (e) =>
          e.type === 'calls' &&
          e.fromSymbol === 'Cart.checkout' &&
          e.toPath === 'src/cart/billing.ts' &&
          e.toSymbol === 'pay',
      ),
    );
    assert.ok(!result.edges.some((e) => e.toPath.includes('react')));
  });

  test('analyzeTextFile links a same-file call', () => {
    const text = ['function pay() {', '  return 1;', '}', 'function checkout() {', '  pay();', '}', ''].join('\n');
    const result = analyzeTextFile({
      relPath: 'src/pay.ts',
      text,
      existingPaths: new Set(['src/pay.ts']),
    });
    assert.ok(
      result.edges.some(
        (e) => e.type === 'calls' && e.fromSymbol === 'checkout' && e.toSymbol === 'pay' && e.toPath === 'src/pay.ts',
      ),
    );
  });

  test('analyzeTextFile resolves .js specifier to .ts and namespace calls', () => {
    const text = [
      "import { helper } from './helper.js';",
      "import * as billing from './billing.js';",
      'export function run() {',
      '  billing.pay();',
      '  return helper;',
      '}',
      '',
    ].join('\n');
    const existing = new Set([
      'src/vs/workbench/contrib/sapphire/common/run.ts',
      'src/vs/workbench/contrib/sapphire/common/helper.ts',
      'src/vs/workbench/contrib/sapphire/common/billing.ts',
    ]);
    const result = analyzeTextFile({
      relPath: 'src/vs/workbench/contrib/sapphire/common/run.ts',
      text,
      existingPaths: existing,
    });
    assert.ok(
      result.edges.some(
        (e) =>
          e.type === 'imports' &&
          e.toPath === 'src/vs/workbench/contrib/sapphire/common/helper.ts',
      ),
    );
    assert.ok(
      result.edges.some(
        (e) =>
          e.type === 'calls' &&
          e.fromSymbol === 'run' &&
          e.toPath === 'src/vs/workbench/contrib/sapphire/common/billing.ts' &&
          e.toSymbol === 'pay',
      ),
    );
  });

  test('analyzeTextFile resolves vs/ alias and skips packages', () => {
    const text = [
      "import { URI } from 'vs/base/common/uri.js';",
      "import React from 'react';",
      'export function useUri() {',
      '  return URI;',
      '}',
      '',
    ].join('\n');
    const existing = new Set([
      'src/app.ts',
      'src/vs/base/common/uri.ts',
    ]);
    const result = analyzeTextFile({
      relPath: 'src/app.ts',
      text,
      existingPaths: existing,
    });
    assert.ok(
      result.edges.some((e) => e.type === 'imports' && e.toPath === 'src/vs/base/common/uri.ts'),
    );
    assert.ok(!result.edges.some((e) => e.toPath.includes('react')));
  });

  test('analyzeTextFile links destructured require calls', () => {
    const text = [
      "const { pay } = require('./billing.js');",
      'export function run() {',
      '  pay();',
      '}',
      '',
    ].join('\n');
    const existing = new Set(['src/run.ts', 'src/billing.ts']);
    const result = analyzeTextFile({
      relPath: 'src/run.ts',
      text,
      existingPaths: existing,
    });
    assert.ok(result.edges.some((e) => e.type === 'imports' && e.toPath === 'src/billing.ts'));
    assert.ok(
      result.edges.some(
        (e) =>
          e.type === 'calls' &&
          e.fromSymbol === 'run' &&
          e.toPath === 'src/billing.ts' &&
          e.toSymbol === 'pay',
      ),
    );
  });

  test('analyzeTextFile keeps export default function symbol', () => {
    const text = ['export default function run() {', '  return 1;', '}', ''].join('\n');
    const result = analyzeTextFile({
      relPath: 'src/run.ts',
      text,
      existingPaths: new Set(['src/run.ts']),
    });
    assert.ok(result.symbols.some((s) => s.symbolName === 'run' && s.kind === 'function'));
  });

  test('analyzeTextFile skips import type edges', () => {
    const text = [
      "import type { X } from './types';",
      "import { type Y, z } from './values';",
      'export function use(zArg: unknown) {',
      '  return zArg;',
      '}',
      '',
    ].join('\n');
    const existing = new Set(['src/a.ts', 'src/types.ts', 'src/values.ts']);
    const result = analyzeTextFile({
      relPath: 'src/a.ts',
      text,
      existingPaths: existing,
    });
    assert.ok(!result.edges.some((e) => e.type === 'imports' && e.toPath === 'src/types.ts'));
    assert.ok(result.edges.some((e) => e.type === 'imports' && e.toPath === 'src/values.ts'));
  });

  test('layerFromPath prefers test over common', () => {
    assert.strictEqual(layerFromPath('src/vs/workbench/browser/foo.ts'), 'browser');
    assert.strictEqual(layerFromPath('src/vs/workbench/electron-main/app.ts'), 'electron-main');
    assert.strictEqual(layerFromPath('src/vs/workbench/contrib/sapphire/common/x.ts'), 'common');
    assert.strictEqual(layerFromPath('src/vs/workbench/contrib/sapphire/node/y.ts'), 'node');
    assert.strictEqual(layerFromPath('src/vs/workbench/contrib/sapphire/test/common/a.test.ts'), 'test');
    assert.strictEqual(layerFromPath('docs/guide/chat.md'), 'docs');
    assert.strictEqual(layerFromPath('src/foo.ts'), 'other');
  });

  test('buildProjectIndexImpact is one hop across calls', () => {
    const files: ProjectIndexFileRecord[] = [
      {
        path: 'src/cart/Checkout.tsx',
        mtime: 1,
        size: 1,
        kind: 'code',
        hash: 'a',
        layer: 'browser',
        localRole: 'checkout',
        llmStatus: 'done',
        updatedAt: 1,
      },
      {
        path: 'src/cart/billing.ts',
        mtime: 1,
        size: 1,
        kind: 'code',
        hash: 'b',
        layer: 'common',
        localRole: 'billing',
        llmStatus: 'done',
        updatedAt: 1,
      },
    ];
    const impact = buildProjectIndexImpact({
      changedPaths: ['src/cart/Checkout.tsx'],
      files,
      symbols: [
        {
          path: 'src/cart/Checkout.tsx',
          symbolName: 'Cart.checkout',
          kind: 'method',
          startLine: 5,
          endLine: 7,
          owner: 'Cart',
        },
      ],
      edges: [
        {
          fromPath: 'src/cart/Checkout.tsx',
          toPath: 'src/cart/billing.ts',
          type: 'calls',
          fromSymbol: 'Cart.checkout',
          toSymbol: 'pay',
        },
        {
          fromPath: 'src/cart/Checkout.tsx',
          toPath: 'src/cart/Checkout.tsx',
          type: 'contains',
          toSymbol: 'Cart.checkout',
        },
      ],
    });
    assert.deepStrictEqual(impact.layers, ['browser', 'common']);
    assert.strictEqual(impact.affected.length, 1);
    assert.strictEqual(impact.affected[0].path, 'src/cart/billing.ts');
    assert.strictEqual(impact.affected[0].symbol, 'pay');
    assert.strictEqual(impact.affected[0].via, 'calls');
    assert.strictEqual(impact.affected[0].hops, 1);
    assert.ok(formatProjectIndexImpact(impact).includes('via calls'));
  });

  test('buildProjectIndexImpact walks a second hop', () => {
    const file = (path: string): ProjectIndexFileRecord => ({
      path,
      mtime: 1,
      size: 1,
      kind: 'code',
      hash: path,
      layer: 'common',
      localRole: path,
      llmStatus: 'done',
      updatedAt: 1,
    });
    const impact = buildProjectIndexImpact({
      changedPaths: ['a.ts'],
      files: [file('a.ts'), file('b.ts'), file('c.ts')],
      symbols: [],
      edges: [
        { fromPath: 'a.ts', toPath: 'b.ts', type: 'imports' },
        { fromPath: 'b.ts', toPath: 'c.ts', type: 'calls', toSymbol: 'run' },
      ],
    });
    const hops = new Map(impact.affected.map((hit) => [hit.path, hit.hops]));
    assert.strictEqual(hops.get('b.ts'), 1);
    assert.strictEqual(hops.get('c.ts'), 2);
  });

  test('parseTourLlmJson filters unknown paths and caps steps', () => {
    const known = new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const raw = JSON.stringify({
      steps: [
        { order: 1, title: 'Start', description: 'Entry', paths: ['src/a.ts', 'missing.ts'] },
        { order: 2, title: 'Mid', description: 'Core', paths: ['src/b.ts'], symbols: ['Foo'] },
        { order: 3, title: 'Bad', description: 'Nope', paths: ['not-in-index.ts'] },
        ...Array.from({ length: 20 }, (_, i) => ({
          order: i + 4,
          title: `S${i}`,
          description: `D${i}`,
          paths: ['src/c.ts'],
        })),
      ],
    });
    const steps = parseTourLlmJson(raw + '\nextra', known);
    assert.ok(steps.length >= 2);
    assert.ok(steps.length <= 12);
    assert.deepStrictEqual(steps[0].paths, ['src/a.ts']);
    assert.ok(!steps.some((s) => s.paths.includes('missing.ts')));
    assert.ok(!steps.some((s) => s.title === 'Bad'));
    assert.deepStrictEqual(steps[1].symbols, ['Foo']);
  });

  test('isTourStale and formatTourForAgent', () => {
    assert.strictEqual(
      isTourStale(
        { generatedAt: 1, basedOn: { files: 10, edges: 10, purposeDone: 5 }, steps: [] },
        { files: 40, edges: 10, purposeDone: 5 },
      ),
      true,
    );
    assert.strictEqual(
      tourStepAt(
        [
          { order: 1, title: 'Start', description: 'Entry', paths: ['src/a.ts'] },
          { order: 2, title: 'Mid', description: 'Core', paths: ['src/b.ts'] },
        ],
        2,
      )?.title,
      'Mid',
    );
    assert.strictEqual(tourStepAt([], 1), null);
    assert.ok(formatTourForAgent(null).includes('No onboarding tour'));
    const text = formatTourForAgent({
      generatedAt: Date.UTC(2026, 0, 1),
      basedOn: { files: 2, edges: 1, purposeDone: 1 },
      steps: [
        {
          order: 1,
          title: 'Auth',
          description: 'Start here',
          paths: ['src/auth.ts'],
          symbols: ['login'],
        },
      ],
    });
    assert.ok(text.includes('## 1. Auth'));
    assert.ok(text.includes('src/auth.ts'));
  });

  test('buildTourPromptInput includes layers and skips contains edges', () => {
    const prompt = buildTourPromptInput({
      files: [
        {
          path: 'src/a.ts',
          mtime: 1,
          size: 1,
          kind: 'code',
          hash: 'a',
          layer: 'browser',
          localRole: 'a',
          purpose: 'UI entry',
          llmStatus: 'done',
          updatedAt: 1,
        },
      ],
      edges: [
        { fromPath: 'src/a.ts', toPath: 'src/b.ts', type: 'imports' },
        { fromPath: 'src/a.ts', toPath: 'src/a.ts', type: 'contains', toSymbol: 'Foo' },
      ],
    });
    assert.ok(prompt.includes('browser:1'));
    assert.ok(prompt.includes('imports'));
    assert.ok(!prompt.includes('contains'));
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
        layer: 'browser',
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
        layer: 'docs',
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
