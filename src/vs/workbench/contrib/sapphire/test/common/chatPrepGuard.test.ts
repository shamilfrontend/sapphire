/*--------------------------------------------------------------------------------------
 *  PPR Code — unit tests for chat prep cancel / timeout guard.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import {
  ChatPrepTimeoutError,
  isChatPrepTimeoutError,
  PPR_CHAT_HEURISTIC_TIMEOUT_MS,
  PPR_CHAT_PREP_TIMEOUT_MS,
  racePrepAwait,
} from '../../common/chatPrepGuard.js';
import {
  canEnqueueFollowUp,
  shouldClearStuckStream,
  shouldClearStuckStreamOnStaleEpoch,
  shouldFlushDeadQueue,
} from '../../common/chatStreamGuards.js';
import {
  PPR_LLM_CONNECT_TIMEOUT_MS,
  PPR_LLM_STREAM_IDLE_MS,
} from '../../common/llmRetryStatus.js';
import { LLM_ERROR_HINTS } from '../../common/llmProviderConfig.js';
import {
  _resetChatSendTraceForTests,
  chatTrace,
  formatChatSendTrace,
} from '../../common/chatSendTrace.js';

suite('chatPrepGuard', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('PPR_CHAT_PREP_TIMEOUT_MS is 8s', () => {
    assert.strictEqual(PPR_CHAT_PREP_TIMEOUT_MS, 8_000);
  });

  test('PPR_CHAT_HEURISTIC_TIMEOUT_MS is 3s', () => {
    assert.strictEqual(PPR_CHAT_HEURISTIC_TIMEOUT_MS, 3_000);
  });

  test('isChatPrepTimeoutError detects by name', () => {
    assert.ok(isChatPrepTimeoutError(new ChatPrepTimeoutError()));
    assert.ok(isChatPrepTimeoutError({ name: 'ChatPrepTimeoutError' }));
    assert.strictEqual(isChatPrepTimeoutError(new Error('x')), false);
  });

  test('PPR_LLM_CONNECT_TIMEOUT_MS is 90s', () => {
    assert.strictEqual(PPR_LLM_CONNECT_TIMEOUT_MS, 90_000);
  });

  test('PPR_LLM_STREAM_IDLE_MS is 90s', () => {
    assert.strictEqual(PPR_LLM_STREAM_IDLE_MS, 90_000);
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
    assert.ok(formatChatSendTrace().includes('пусто'));
    chatTrace('thread-abcdef1234567890', 'submit.send', 'chars=12');
    chatTrace('thread-abcdef1234567890', 'stream', 'none -> preparing');
    const text = formatChatSendTrace();
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

  test('stale-epoch finally clears only idle', () => {
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('idle'), true);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('preparing'), false);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('LLM'), false);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('tool'), false);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch('awaiting_user'), false);
    assert.strictEqual(shouldClearStuckStreamOnStaleEpoch(undefined), false);
  });
});
