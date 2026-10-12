/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  matchSearchReplaceBlocks,
  SearchReplaceBlockInput,
} from '../../common/searchReplaceMatch.js';

const done = (orig: string, final: string): SearchReplaceBlockInput => ({
  state: 'done',
  orig,
  final,
});

suite('searchReplaceMatch', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('exact unique match returns the line range', () => {
    const result = matchSearchReplaceBlocks('alpha\nbeta\ngamma\n', [done('beta', 'BETA')]);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepStrictEqual(result.replacements, [{ startLine: 2, endLine: 2, final: 'BETA' }]);
  });

  test('two identical ORIGINAL blocks are not unique and have no replacement', () => {
    const file = 'alpha\nbeta\nalpha\n';
    const result = matchSearchReplaceBlocks(file, [done('alpha', 'ALPHA')]);
    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.ok(!('replacements' in result));
    assert.ok(result.message.includes('lines 1, 3'));
    assert.ok(result.message.includes('alpha'));
    assert.ok(!result.message.includes('JSON'));
  });

  test('CRLF and trailing whitespace still match', () => {
    const crlf = matchSearchReplaceBlocks('const a = 1;\nconst b = 2;\n', [
      done('const a = 1;\r\nconst b = 2;', 'const a = 2;\nconst b = 3;'),
    ]);
    assert.strictEqual(crlf.ok, true);
    if (crlf.ok) {
      assert.strictEqual(crlf.replacements[0].startLine, 1);
      assert.strictEqual(crlf.replacements[0].endLine, 2);
    }

    const trailing = matchSearchReplaceBlocks('const a = 1;\nconst b = 2;\n', [
      done('const a = 1;  \nconst b = 2;\t', 'const a = 3;\nconst b = 4;'),
    ]);
    assert.strictEqual(trailing.ok, true);
    if (trailing.ok) {
      assert.deepStrictEqual(trailing.replacements, [
        { startLine: 1, endLine: 2, final: 'const a = 3;\nconst b = 4;' },
      ]);
    }
  });

  test('a shared leading indent matches; a space inside a line does not', () => {
    const indented = matchSearchReplaceBlocks('    const x = 1;\n    const y = 2;\n', [
      done('  const x = 1;\n  const y = 2;', '  const x = 3;\n  const y = 4;'),
    ]);
    assert.strictEqual(indented.ok, true);
    if (indented.ok) {
      assert.strictEqual(indented.replacements[0].startLine, 1);
      assert.strictEqual(indented.replacements[0].endLine, 2);
    }

    const glued = matchSearchReplaceBlocks("const name = 'foo bar';\n", [
      done("const name = 'foobar';", "const name = 'x';"),
    ]);
    assert.strictEqual(glued.ok, false);
    if (!glued.ok) {
      assert.ok(glued.message.includes('foo bar'));
    }
  });

  test('not_found includes numbered file lines', () => {
    const file = 'keep-me\nUNIQUE_FILE_TOKEN\nother\n';
    const result = matchSearchReplaceBlocks(file, [done('missing symbol', 'gone')]);
    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.ok(result.message.includes('UNIQUE_FILE_TOKEN'));
    assert.ok(result.message.includes('2|'));
    assert.ok(result.message.includes('missing symbol'));
  });

  test('an empty file accepts a single SEARCH/REPLACE as a full write', () => {
    const result = matchSearchReplaceBlocks('', [
      done(
        "```markdown\n# missing\n```",
        "```markdown\n# Текущее состояние (Q3'26)\n\nbody\n```",
      ),
    ]);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepStrictEqual(result.replacements, [
      {
        startLine: 1,
        endLine: 1,
        final: "# Текущее состояние (Q3'26)\n\nbody",
      },
    ]);
  });

  test('a markdown fence copied from a plan is stripped before matching', () => {
    const file = "# Текущее состояние (Q3'26)\n\n## Содержание\n";
    const result = matchSearchReplaceBlocks(file, [
      done(
        "```markdown\n# Текущее состояние (Q3'26)\n```",
        "```markdown\n# Текущее состояние (Q3'26)\n\n## Содержание\n- пункт\n```",
      ),
    ]);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.strictEqual(result.replacements[0].startLine, 1);
    assert.strictEqual(result.replacements[0].endLine, 1);
    assert.ok(!result.replacements[0].final.includes('```'));
    assert.ok(result.replacements[0].final.includes('- пункт'));
  });

  test('a real fenced block in the file still matches exactly', () => {
    const file = 'intro\n```\ncode\n```\n';
    const result = matchSearchReplaceBlocks(file, [done('```\ncode\n```', '```\nCODE\n```')]);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepStrictEqual(result.replacements, [
      { startLine: 2, endLine: 4, final: '```\nCODE\n```' },
    ]);
  });

  test('an unfinished block yields no replacements', () => {
    const result = matchSearchReplaceBlocks('foo\n', [
      { state: 'writingFinal', orig: 'foo', final: 'bar' },
    ]);
    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.ok(result.message.includes('>>>>>>> UPDATED'));
  });
});
