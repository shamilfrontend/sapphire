/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  extractHeuristicQueryTokens,
  isExcludedHeuristicPath,
  mergeHeuristicFileSelections,
  pathSearchQueriesFromTokens,
  pickTopHeuristicUris,
  shouldSkipHeuristicRetrieve,
  textSearchQueriesFromTokens,
} from '../../common/heuristicFileRetrieve.js';
import { StagingSelectionItem } from '../../common/chatThreadServiceTypes.js';

suite('heuristicFileRetrieve', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  const fileA = URI.file('/proj/src/ChatToolCards.tsx');
  const fileB = URI.file('/proj/src/trimChatContext.ts');
  const fileNode = URI.file('/proj/node_modules/foo/index.js');

  suite('extractHeuristicQueryTokens', () => {
    test('returns empty for short / greeting queries', () => {
      assert.deepStrictEqual(extractHeuristicQueryTokens('hi'), []);
      assert.deepStrictEqual(extractHeuristicQueryTokens('привет'), []);
    });

    test('extracts path-like and identifier tokens, drops stop-words', () => {
      const tokens = extractHeuristicQueryTokens(
        'please fix ChatToolCards.tsx and trimChatContext in the project',
      );
      const texts = tokens.map((t) => t.text);
      assert.ok(texts.some((t) => /ChatToolCards/i.test(t)));
      assert.ok(texts.some((t) => t === 'trimChatContext'));
      assert.ok(!texts.map((t) => t.toLowerCase()).includes('please'));
      assert.ok(!texts.map((t) => t.toLowerCase()).includes('fix'));
      assert.ok(!texts.map((t) => t.toLowerCase()).includes('project'));
    });

    test('path tokens sort before identifiers', () => {
      const tokens = extractHeuristicQueryTokens(
        'update foo/bar.ts and also HeuristicRetrieve please',
      );
      assert.ok(tokens.length >= 2);
      assert.strictEqual(tokens[0].kind, 'path');
    });

    test('russian stop-words dropped', () => {
      const tokens = extractHeuristicQueryTokens(
        'пожалуйста исправь heuristicFileRetrieve в проекте сейчас',
      );
      const lower = tokens.map((t) => t.text.toLowerCase());
      assert.ok(lower.includes('heuristicfileretrieve'));
      assert.ok(!lower.includes('пожалуйста'));
      assert.ok(!lower.includes('исправь'));
      assert.ok(!lower.includes('проекте'));
    });
  });

  suite('pathSearchQueriesFromTokens / textSearchQueriesFromTokens', () => {
    test('text search takes up to 2 longest identifiers', () => {
      const tokens = extractHeuristicQueryTokens(
        'compare ChatToolCards with trimChatContext and estimateTokens somehow',
      );
      const textQs = textSearchQueriesFromTokens(tokens);
      assert.ok(textQs.length <= 2);
      if (textQs.length >= 2) {
        assert.ok(textQs[0].length >= textQs[1].length);
      }
      const pathQs = pathSearchQueriesFromTokens(tokens);
      assert.ok(pathQs.length >= 1);
    });
  });

  suite('isExcludedHeuristicPath', () => {
    test('excludes node_modules and .git', () => {
      assert.strictEqual(isExcludedHeuristicPath(fileNode.fsPath), true);
      assert.strictEqual(isExcludedHeuristicPath('/proj/.git/config'), true);
      assert.strictEqual(isExcludedHeuristicPath(fileA.fsPath), false);
    });
  });

  suite('shouldSkipHeuristicRetrieve', () => {
    test('false when empty', () => {
      assert.strictEqual(shouldSkipHeuristicRetrieve([]), false);
      assert.strictEqual(shouldSkipHeuristicRetrieve(null), false);
    });

    test('true when Folder present', () => {
      assert.strictEqual(
        shouldSkipHeuristicRetrieve([{ type: 'Folder', uri: URI.file('/proj/src') }]),
        true,
      );
    });

    test('true when >= 2 file-like attachments', () => {
      const a: StagingSelectionItem = { type: 'File', uri: fileA, language: 'typescript' };
      const b: StagingSelectionItem = {
        type: 'CodeSelection',
        uri: fileB,
        language: 'typescript',
        range: [1, 2],
      };
      assert.strictEqual(shouldSkipHeuristicRetrieve([a]), false);
      assert.strictEqual(shouldSkipHeuristicRetrieve([a, b]), true);
    });
  });

  suite('pickTopHeuristicUris', () => {
    test('ranks path over text, skips excluded and omitted and already selected', () => {
      const picked = pickTopHeuristicUris(
        [
          { uri: fileNode, score: 999, source: 'path' },
          { uri: fileB, score: 400, source: 'text' },
          { uri: fileA, score: 900, source: 'path' },
        ],
        [{ type: 'File', uri: fileB, language: 'typescript' }],
        { omittedFsPaths: [] },
      );
      assert.strictEqual(picked.length, 1);
      assert.strictEqual(picked[0].fsPath, fileA.fsPath);
    });

    test('respects omit set and topN', () => {
      const picked = pickTopHeuristicUris(
        [
          { uri: fileA, score: 900, source: 'path' },
          { uri: fileB, score: 800, source: 'path' },
        ],
        [],
        { omittedFsPaths: new Set([fileA.fsPath]), topN: 3 },
      );
      assert.strictEqual(picked.length, 1);
      assert.strictEqual(picked[0].fsPath, fileB.fsPath);
    });
  });

  suite('mergeHeuristicFileSelections', () => {
    test('no-op when disabled', () => {
      const base: StagingSelectionItem[] = [{ type: 'File', uri: fileB, language: 'typescript' }];
      const out = mergeHeuristicFileSelections(base, [{ uri: fileA, language: 'typescript' }], {
        enabled: false,
      });
      assert.deepStrictEqual(out, base);
      assert.notStrictEqual(out, base);
    });

    test('appends with fromHeuristic and skips duplicates', () => {
      const base: StagingSelectionItem[] = [{ type: 'File', uri: fileB, language: 'typescript' }];
      const out = mergeHeuristicFileSelections(
        base,
        [
          { uri: fileB, language: 'typescript' },
          { uri: fileA, language: 'tsx' },
        ],
        { enabled: true },
      );
      assert.strictEqual(out.length, 2);
      assert.strictEqual(out[1].type, 'File');
      if (out[1].type === 'File') {
        assert.strictEqual(out[1].uri.fsPath, fileA.fsPath);
        assert.strictEqual(out[1].fromHeuristic, true);
      }
    });
  });
});
