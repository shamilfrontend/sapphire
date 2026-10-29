/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  formatAgentRetryStatusHint,
  formatGatewayRetryStatusHint,
  SAPPHIRE_LLM_CONNECT_TIMEOUT_MS,
  SAPPHIRE_LLM_STREAM_IDLE_MS,
} from '../../common/llmRetryStatus.js';

suite('llmRetryStatus', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('SAPPHIRE_LLM_STREAM_IDLE_MS is 90s', () => {
    assert.strictEqual(SAPPHIRE_LLM_STREAM_IDLE_MS, 90_000);
  });

  test('SAPPHIRE_LLM_CONNECT_TIMEOUT_MS is 90s', () => {
    assert.strictEqual(SAPPHIRE_LLM_CONNECT_TIMEOUT_MS, 90_000);
  });

  test('formatGatewayRetryStatusHint — 408 with Retry-After', () => {
    assert.strictEqual(
      formatGatewayRetryStatusHint({
        attempt: 2,
        maxAttempts: 3,
        status: 408,
        retryAfterSec: 5,
      }),
      'Провайдер занят (408), повтор 2/3 через ~5 с…',
    );
  });

  test('formatGatewayRetryStatusHint — 429 without wait', () => {
    assert.strictEqual(
      formatGatewayRetryStatusHint({ attempt: 3, maxAttempts: 3, status: 429 }),
      'Лимит запросов (429), повтор 3/3…',
    );
  });

  test('formatAgentRetryStatusHint truncates long messages', () => {
    const long = 'x'.repeat(100);
    const hint = formatAgentRetryStatusHint({
      attempt: 2,
      maxAttempts: 3,
      message: long,
    });
    assert.ok(hint.startsWith('xxx'));
    assert.ok(hint.includes('…'));
    assert.ok(hint.endsWith('Повтор 2/3…'));
    assert.ok(hint.length < 120);
  });

  test('formatAgentRetryStatusHint default when message empty', () => {
    assert.strictEqual(
      formatAgentRetryStatusHint({ attempt: 2, maxAttempts: 3 }),
      'Ошибка ответа Повтор 2/3…',
    );
  });
});
