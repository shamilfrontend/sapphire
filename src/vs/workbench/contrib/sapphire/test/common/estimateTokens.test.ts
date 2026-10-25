/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  cutTailFreeingTokens,
  estimateImageTokens,
  estimateMessageTokens,
  estimateTextTokens,
  estimateToolCallTokens,
  IMAGE_VISION_TOKENS,
  MESSAGE_FRAMING_TOKENS,
  outputTokensPerSecond,
  TokenEstimateCalibrator,
} from '../../common/estimateTokens.js';

suite('estimateTokens', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  suite('estimateTextTokens', () => {
    test('empty string is 0', () => {
      assert.strictEqual(estimateTextTokens(''), 0);
    });

    test('ASCII is ~4 chars per token', () => {
      assert.strictEqual(estimateTextTokens('abcd'), 1); // 4 * 0.25
      assert.strictEqual(estimateTextTokens('hello'), 2); // 5 * 0.25 = 1.25 → ceil 2
    });

    test('Cyrillic is denser than ASCII of the same length', () => {
      const ascii = estimateTextTokens('abcdefghij'); // 10 * 0.25 = 2.5 → 3
      const cyrillic = estimateTextTokens('абвгдежзий'); // 10 * 0.6 = 6
      assert.strictEqual(ascii, 3);
      assert.strictEqual(cyrillic, 6);
      assert.ok(cyrillic > ascii);
    });

    test('CJK is ~1 token per char', () => {
      assert.strictEqual(estimateTextTokens('你好'), 2);
    });

    test('non-empty input is at least 1', () => {
      assert.strictEqual(estimateTextTokens('a'), 1);
      assert.strictEqual(estimateTextTokens('я'), 1);
    });
  });

  suite('estimateImageTokens / estimateMessageTokens', () => {
    test('fixed vision weight per image', () => {
      assert.strictEqual(estimateImageTokens(0), 0);
      assert.strictEqual(estimateImageTokens(1), IMAGE_VISION_TOKENS);
      assert.strictEqual(estimateImageTokens(3), IMAGE_VISION_TOKENS * 3);
      assert.strictEqual(estimateImageTokens(-2), 0);
    });

    test('message tokens add framing and imageCount', () => {
      const text = estimateTextTokens('hello');
      assert.strictEqual(
        estimateMessageTokens({ content: 'hello' }),
        text + MESSAGE_FRAMING_TOKENS,
      );
      assert.strictEqual(
        estimateMessageTokens({ content: 'hello', imageCount: 1 }),
        text + IMAGE_VISION_TOKENS + MESSAGE_FRAMING_TOKENS,
      );
    });

    test('empty content still pays framing', () => {
      assert.strictEqual(estimateMessageTokens({ content: '' }), MESSAGE_FRAMING_TOKENS);
    });
  });

  suite('estimateToolCallTokens', () => {
    test('name + JSON + framing', () => {
      const name = 'read_file';
      const argumentsJson = '{"uri":"a.ts"}';
      assert.strictEqual(
        estimateToolCallTokens({ name, argumentsJson }),
        estimateTextTokens(name) + estimateTextTokens(argumentsJson) + MESSAGE_FRAMING_TOKENS,
      );
    });
  });

  suite('cutTailFreeingTokens', () => {
    test('no-op when tokensToFree <= 0', () => {
      const text = 'abcdefghij';
      assert.deepStrictEqual(cutTailFreeingTokens(text, 0, 4), { text, tokensFreed: 0 });
      assert.deepStrictEqual(cutTailFreeingTokens(text, -1, 4), { text, tokensFreed: 0 });
    });

    test('no-op when text is already at minKeep', () => {
      const text = 'abcd';
      assert.deepStrictEqual(cutTailFreeingTokens(text, 10, 4), { text, tokensFreed: 0 });
    });

    test('ASCII frees 0.25 token per char', () => {
      const result = cutTailFreeingTokens('abcdefghij', 1, 4);
      assert.strictEqual(result.text, 'abcdef');
      assert.strictEqual(result.tokensFreed, 1);
    });

    test('Cyrillic frees more tokens per char than ASCII', () => {
      const ascii = cutTailFreeingTokens('abcdefghij', 1, 4);
      const cyrillic = cutTailFreeingTokens('абвгдежзий', 1, 4);
      assert.ok(cyrillic.text.length > ascii.text.length);
      assert.ok(cyrillic.tokensFreed >= ascii.tokensFreed);
    });
  });

  suite('outputTokensPerSecond', () => {
    test('divides completion tokens by seconds since the first chunk', () => {
      assert.strictEqual(outputTokensPerSecond(100, 1_000, 3_000), 50);
    });

    test('rounds to an integer and reports at least 1', () => {
      assert.strictEqual(outputTokensPerSecond(3, 0, 2_000), 2); // 1.5 → 2
      assert.strictEqual(outputTokensPerSecond(1, 0, 10_000), 1); // 0.1 → 1
    });

    test('zero tokens are undefined', () => {
      assert.strictEqual(outputTokensPerSecond(0, 0, 5_000), undefined);
    });

    test('windows shorter than 200ms are undefined', () => {
      assert.strictEqual(outputTokensPerSecond(100, 0, 199), undefined);
      assert.strictEqual(outputTokensPerSecond(100, 0, 200), 500);
    });
  });

  suite('TokenEstimateCalibrator', () => {
    test('observe below 50 is ignored', () => {
      const cal = new TokenEstimateCalibrator();
      cal.observe(49, 200);
      cal.observe(200, 49);
      assert.strictEqual(cal.getFactor(), 1);
      assert.strictEqual(cal.apply(100), 100);
    });

    test('EMA with default alpha 0.2', () => {
      const cal = new TokenEstimateCalibrator();
      cal.observe(100, 150); // ratio 1.5 → 0.2*1.5 + 0.8*1 = 1.1
      assert.strictEqual(cal.getFactor(), 1.1);
      assert.strictEqual(cal.apply(100), 110);
    });

    test('clamps factor to [0.5, 2.0]', () => {
      const high = new TokenEstimateCalibrator({ alpha: 1 });
      high.observe(50, 1000);
      assert.strictEqual(high.getFactor(), 2);

      const low = new TokenEstimateCalibrator({ alpha: 1 });
      low.observe(200, 50);
      assert.strictEqual(low.getFactor(), 0.5);
    });

    test('apply rounds and floors at 0', () => {
      const cal = new TokenEstimateCalibrator();
      assert.strictEqual(cal.apply(1.4), 1);
      assert.strictEqual(cal.apply(-10), 0);
    });

    test('non-finite and non-positive ratios are ignored', () => {
      const cal = new TokenEstimateCalibrator();
      cal.observe(100, Number.POSITIVE_INFINITY);
      cal.observe(100, Number.NaN);
      cal.observe(100, 0);
      assert.strictEqual(cal.getFactor(), 1);
    });
  });
});
