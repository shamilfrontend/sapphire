/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import {
  ChatPrepTimeoutError,
  isChatPrepTimeoutError,
	prepTimeoutMsForPaths,
	SAPPHIRE_CHAT_HEURISTIC_TIMEOUT_MS,
	SAPPHIRE_CHAT_PREP_OCR_TIMEOUT_MS,
	SAPPHIRE_CHAT_PREP_TIMEOUT_MS,
	racePrepAwait,
} from '../../common/chatPrepGuard.js';
import {
  canEnqueueFollowUp,
  hasActiveChatWork,
  isActiveChatRequest,
  shouldClearStuckStream,
  shouldClearStuckStreamOnStaleEpoch,
  shouldFlushDeadQueue,
} from '../../common/chatStreamGuards.js';
import {
  SAPPHIRE_LLM_CONNECT_TIMEOUT_MS,
  SAPPHIRE_LLM_STREAM_IDLE_MS,
} from '../../common/llmRetryStatus.js';
import { LLM_ERROR_HINTS } from '../../common/llmProviderConfig.js';
import {
  _resetChatSendTraceForTests,
  chatTrace,
  formatChatSendTrace,
} from '../../common/chatSendTrace.js';

suite('chatPrepGuard', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

	test('SAPPHIRE_CHAT_PREP_TIMEOUT_MS is 8s', () => {
		assert.strictEqual(SAPPHIRE_CHAT_PREP_TIMEOUT_MS, 8_000);
	});

	test('PDF paths get the longer prep budget', () => {
		assert.strictEqual(SAPPHIRE_CHAT_PREP_OCR_TIMEOUT_MS, 45_000);
		assert.strictEqual(prepTimeoutMsForPaths(['/tmp/notes.md']), SAPPHIRE_CHAT_PREP_TIMEOUT_MS);
		assert.strictEqual(prepTimeoutMsForPaths(['/tmp/scan.PDF']), SAPPHIRE_CHAT_PREP_OCR_TIMEOUT_MS);
	});

  test('SAPPHIRE_CHAT_HEURISTIC_TIMEOUT_MS is 3s', () => {
    assert.strictEqual(SAPPHIRE_CHAT_HEURISTIC_TIMEOUT_MS, 3_000);
  });

  test('isChatPrepTimeoutError detects by name', () => {
    assert.ok(isChatPrepTimeoutError(new ChatPrepTimeoutError()));
    assert.ok(isChatPrepTimeoutError({ name: 'ChatPrepTimeoutError' }));
    assert.strictEqual(isChatPrepTimeoutError(new Error('x')), false);
  });

  test('SAPPHIRE_LLM_CONNECT_TIMEOUT_MS is 90s', () => {
    assert.strictEqual(SAPPHIRE_LLM_CONNECT_TIMEOUT_MS, 90_000);
  });

  test('SAPPHIRE_LLM_STREAM_IDLE_MS is 90s', () => {
    assert.strictEqual(SAPPHIRE_LLM_STREAM_IDLE_MS, 90_000);
  });

  test('connectTimeout hint is defined', () => {
    assert.ok(LLM_ERROR_HINTS.connectTimeout.includes('90 с'));
  });

  test('racePrepAwait resolves when promise wins', async () => {
    const cts = new CancellationTokenSource();
    try {
      const result = await racePrepAwait(Promise.resolve(42), cts.token, 5_000);
      assert.strictEqual(result, 42);
    } finally {
      cts.dispose();
    }
  });

  test('racePrepAwait rejects with CancellationError when token already cancelled', async () => {
    const cts = new CancellationTokenSource();
    cts.cancel();
    let caught: unknown;
    try {
      await racePrepAwait(
        new Promise(() => {
          /* never */
        }),
        cts.token,
        5_000,
      );
    } catch (e) {
      caught = e;
    } finally {
      cts.dispose();
    }
    assert.ok(isCancellationError(caught));
  });

  test('racePrepAwait rejects with CancellationError when token cancels mid-wait', async () => {
    const cts = new CancellationTokenSource();
    let caught: unknown;
    const pending = racePrepAwait(
      new Promise(() => {
        /* never */
      }),
      cts.token,
      30_000,
    );
    setTimeout(() => cts.cancel(), 20);
    try {
      await pending;
    } catch (e) {
      caught = e;
    } finally {
      cts.dispose();
    }
    assert.ok(isCancellationError(caught));
  });

  test('racePrepAwait rejects with ChatPrepTimeoutError on wall-clock timeout', async () => {
    const cts = new CancellationTokenSource();
    let caught: unknown;
    try {
      await racePrepAwait(
        new Promise(() => {
          /* never */
        }),
        cts.token,
        30,
      );
    } catch (e) {
      caught = e;
    } finally {
      cts.dispose();
    }
    assert.ok(caught instanceof ChatPrepTimeoutError);
  });

  test('timeout path cancels CTS so background work stops', async () => {
    const cts = new CancellationTokenSource();
    try {
      await racePrepAwait(
        new Promise(() => {
          /* never */
        }),
        cts.token,
        20,
      );
      assert.fail('expected timeout');
    } catch (e) {
      assert.ok(e instanceof ChatPrepTimeoutError);
      // Как в chatThreadService: на timeout обязательно cancel, не только reject.
      cts.cancel();
      assert.ok(cts.token.isCancellationRequested);
    } finally {
      cts.dispose();
    }
  });
});

/**
 * Follow-up enqueue: только живой агент (LLM/tool/idle), не preparing.
 */
suite('chatSubmitEnqueueGuard', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  const shouldEnqueue = (
    reactIsRunning: unknown,
    serviceIsRunning: string | undefined,
    interrupt?: unknown,
  ): boolean => !!(reactIsRunning && canEnqueueFollowUp(serviceIsRunning, interrupt));

  test('preparing never enqueues (start addUserMessage instead)', () => {
    assert.strictEqual(canEnqueueFollowUp('preparing'), false);
    assert.strictEqual(shouldEnqueue('preparing', 'preparing'), false);
    assert.strictEqual(shouldEnqueue('idle', 'preparing'), false);
  });

  test('stale React isRunning + clean service → do not enqueue', () => {
    assert.strictEqual(shouldEnqueue('idle', undefined), false);
    assert.strictEqual(shouldEnqueue('LLM', undefined), false);
    assert.strictEqual(shouldEnqueue('awaiting_user', undefined), false);
  });

  test('live agent → enqueue', () => {
    assert.strictEqual(shouldEnqueue('idle', 'idle'), true);
    assert.strictEqual(canEnqueueFollowUp('idle', Promise.resolve(() => {})), true);
    assert.strictEqual(shouldEnqueue('LLM', 'LLM'), true);
    assert.strictEqual(shouldEnqueue('tool', 'tool'), true);
  });

  test('idle after committed turn (not_needed) does not enqueue', () => {
    assert.strictEqual(canEnqueueFollowUp('idle', 'not_needed'), false);
    assert.strictEqual(shouldEnqueue('idle', 'idle', 'not_needed'), false);
    assert.strictEqual(canEnqueueFollowUp('LLM', 'not_needed'), true);
  });

  test('neither running → do not enqueue', () => {
    assert.strictEqual(shouldEnqueue(undefined, undefined), false);
    assert.strictEqual(shouldEnqueue(false, undefined), false);
  });
});

suite('chatSendTrace', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('format includes events and omits nothing when empty', () => {
    _resetChatSendTraceForTests();
    assert.ok(formatChatSendTrace().startsWith('Sapphire chat send trace:'));
    assert.ok(formatChatSendTrace().includes('пусто'));
    chatTrace('thread-abcdef1234567890', 'submit.send', 'chars=12');
    chatTrace('thread-abcdef1234567890', 'stream', 'none -> preparing');
    const text = formatChatSendTrace();
    assert.ok(text.startsWith('Sapphire chat send trace ('));
    assert.ok(text.includes('submit.send chars=12'));
    assert.ok(text.includes('none -> preparing'));
    assert.ok(text.includes('[34567890]'));
    _resetChatSendTraceForTests();
  });

  test('format includes events from every thread', () => {
    _resetChatSendTraceForTests();
    chatTrace('thread-aaaaaaa11111111', 'thread.open');
    chatTrace('thread-bbbbbbb22222222', 'submit.send', 'chars=4');
    const text = formatChatSendTrace();
    assert.ok(text.includes('[11111111] thread.open'));
    assert.ok(text.includes('[22222222] submit.send chars=4'));
    _resetChatSendTraceForTests();
  });

  test('format includes tool.end detail', () => {
    _resetChatSendTraceForTests();
    chatTrace('thread-abcdef1234567890', 'stream', 'idle -> tool name=run_command');
    chatTrace(
      'thread-abcdef1234567890',
      'tool.end',
      'name=run_command ms=60012 timeout',
    );
    chatTrace(
      'thread-abcdef1234567890',
      'stream',
      'tool -> idle name=run_command ms=60013',
    );
    const text = formatChatSendTrace();
    assert.ok(text.includes('idle -> tool name=run_command'));
    assert.ok(text.includes('tool.end name=run_command ms=60012 timeout'));
    assert.ok(text.includes('tool -> idle name=run_command ms=60013'));
    _resetChatSendTraceForTests();
  });
});

suite('chatStreamGuards', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('dead queue flush when not a live agent', () => {
    assert.strictEqual(shouldFlushDeadQueue(undefined), true);
    assert.strictEqual(shouldFlushDeadQueue('preparing'), true);
    assert.strictEqual(shouldFlushDeadQueue('awaiting_user'), true);
    assert.strictEqual(shouldFlushDeadQueue('idle'), false);
    assert.strictEqual(shouldFlushDeadQueue('LLM'), false);
    assert.strictEqual(shouldFlushDeadQueue('tool'), false);
  });

  test('stuck stream clear includes preparing', () => {
    assert.strictEqual(shouldClearStuckStream('preparing'), true);
    assert.strictEqual(shouldClearStuckStream('idle'), true);
    assert.strictEqual(shouldClearStuckStream('LLM'), true);
    assert.strictEqual(shouldClearStuckStream('tool'), true);
    assert.strictEqual(shouldClearStuckStream('awaiting_user'), false);
    assert.strictEqual(shouldClearStuckStream(undefined), false);
  });

  test('active chat request blocks index LLM, awaiting_user does not', () => {
    assert.strictEqual(isActiveChatRequest('LLM'), true);
    assert.strictEqual(isActiveChatRequest('tool'), true);
    assert.strictEqual(isActiveChatRequest('preparing'), true);
    assert.strictEqual(isActiveChatRequest('awaiting_user'), false);
    assert.strictEqual(isActiveChatRequest(undefined), false);
    assert.strictEqual(isActiveChatRequest('idle', 'not_needed'), false);
    assert.strictEqual(isActiveChatRequest('idle', undefined), false);
    assert.strictEqual(isActiveChatRequest('idle', Promise.resolve(() => {})), true);
  });

  test('hasActiveChatWork scans every thread', () => {
    assert.strictEqual(hasActiveChatWork({}), false);
    assert.strictEqual(
      hasActiveChatWork({
        a: { isRunning: 'awaiting_user' },
        b: { isRunning: 'idle', interrupt: 'not_needed' },
      }),
      false,
    );
    assert.strictEqual(
      hasActiveChatWork({
        a: { isRunning: 'awaiting_user' },
        b: { isRunning: 'preparing' },
      }),
      true,
    );
  });

  test('stale-epoch finally clears only idle', () => {
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('idle'), true);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('preparing'), false);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('LLM'), false);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('tool'), false);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('awaiting_user'), false);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch(undefined), false);
  });
});
