/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import {
  buildChatHistorySummary,
  CHAT_HISTORY_ASSISTANT_SNIPPET_CHARS,
  CHAT_HISTORY_USER_SNIPPET_CHARS,
  formatToolActionLine,
  getChatThreadTitle,
} from '../../common/chatHistorySummary.js';
import { ChatMessage } from '../../common/chatThreadServiceTypes.js';

suite('chatHistorySummary', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  const userMsg = (text: string): ChatMessage => ({
    role: 'user',
    content: text,
    displayContent: text,
    selections: null,
    state: { stagingSelections: [], isBeingEdited: false },
  });

  const assistantMsg = (text: string): ChatMessage => ({
    role: 'assistant',
    displayContent: text,
    reasoning: '',
  });

  const toolSuccess = (
    name: string,
    params: Record<string, unknown>,
    rawParams: Record<string, unknown> = {},
  ): ChatMessage =>
    ({
      role: 'tool',
      type: 'success',
      name,
      content: 'ok',
      id: 't1',
      rawParams,
      mcpServerName: undefined,
      params,
      result: {},
    }) as ChatMessage;

  test('getChatThreadTitle uses first user displayContent', () => {
    const title = getChatThreadTitle({
      id: 'a',
      lastModified: '2026-01-01T00:00:00.000Z',
      messages: [userMsg('  Implement login form  ')],
    });
    assert.strictEqual(title, 'Implement login form');
  });

  test('overview excludes current thread and lists others', () => {
    const summary = buildChatHistorySummary({
      currentThreadId: 'current',
      openThreadIds: ['current', 'other'],
      allThreads: {
        current: {
          id: 'current',
          lastModified: '2026-01-02T00:00:00.000Z',
          messages: [userMsg('ignore me')],
        },
        other: {
          id: 'other',
          lastModified: '2026-01-01T12:00:00.000Z',
          messages: [
            userMsg('Build the cart'),
            toolSuccess('edit_file', { uri: URI.file('/proj/cart.ts') }, { uri: '/proj/cart.ts' }),
          ],
          state: {
            activePlan: {
              planUriFsPath: '/proj/.sapphire/plans/cart.plan.md',
              name: 'Cart plan',
              status: 'ready',
            },
          },
        },
        empty: {
          id: 'empty',
          lastModified: '2026-01-03T00:00:00.000Z',
          messages: [],
        },
      },
    });

    assert.ok(summary.includes('thread_id=other'));
    assert.ok(summary.includes('Build the cart'));
    assert.ok(summary.includes('edit_file'));
    assert.ok(summary.includes('Cart plan'));
    assert.ok(!summary.includes('ignore me'));
    assert.ok(!summary.includes('thread_id=current'));
    assert.ok(!summary.includes('thread_id=empty'));
  });

  test('detail truncates long assistant text and formats tools', () => {
    const longAssistant = 'A'.repeat(CHAT_HISTORY_ASSISTANT_SNIPPET_CHARS + 50);
    const longUser = 'U'.repeat(CHAT_HISTORY_USER_SNIPPET_CHARS + 50);
    const threadId = 'hist-1';
    const summary = buildChatHistorySummary({
      currentThreadId: 'current',
      threadId,
      allThreads: {
        current: { id: 'current', lastModified: '2026-01-02T00:00:00.000Z', messages: [] },
        [threadId]: {
          id: threadId,
          lastModified: '2026-01-01T00:00:00.000Z',
          messages: [
            userMsg(longUser),
            assistantMsg(longAssistant),
            toolSuccess(
              'run_command',
              { command: 'npm test', cwd: null, terminalId: 'x' },
              { command: 'npm test' },
            ),
          ],
        },
      },
    });

    assert.ok(summary.includes('Chat thread detail: hist-1'));
    assert.ok(summary.includes('USER:'));
    assert.ok(summary.includes('ASSISTANT:'));
    assert.ok(summary.includes('TOOL: run_command npm test'));
    assert.ok(summary.includes('…'));
    assert.ok(!summary.includes(longAssistant));
  });

  test('detail rejects current thread id', () => {
    const summary = buildChatHistorySummary({
      currentThreadId: 'current',
      threadId: 'current',
      allThreads: {
        current: {
          id: 'current',
          lastModified: '2026-01-01T00:00:00.000Z',
          messages: [userMsg('secret')],
        },
      },
    });
    assert.ok(summary.includes('not found or is the current thread'));
    assert.ok(!summary.includes('secret'));
  });

  test('formatToolActionLine uses uri and command', () => {
    const edit = toolSuccess(
      'rewrite_file',
      { uri: URI.file('/a/b.ts') },
      { uri: '/a/b.ts' },
    ) as Extract<ChatMessage, { role: 'tool' }>;
    assert.strictEqual(formatToolActionLine(edit), 'rewrite_file /a/b.ts (ok)');

    const cmd = toolSuccess(
      'run_command',
      { command: 'ls -la', cwd: null, terminalId: 't' },
      { command: 'ls -la' },
    ) as Extract<ChatMessage, { role: 'tool' }>;
    assert.strictEqual(formatToolActionLine(cmd), 'run_command ls -la (ok)');
  });

  test('overview recent-across mixes actions from multiple threads', () => {
    const summary = buildChatHistorySummary({
      currentThreadId: 'current',
      allThreads: {
        current: {
          id: 'current',
          lastModified: '2026-01-03T00:00:00.000Z',
          messages: [userMsg('now')],
        },
        newer: {
          id: 'newer-thread',
          lastModified: '2026-01-02T00:00:00.000Z',
          messages: [
            userMsg('newer work'),
            toolSuccess(
              'edit_file',
              { uri: URI.file('/proj/newer.ts') },
              { uri: '/proj/newer.ts' },
            ),
          ],
        },
        older: {
          id: 'older-thread',
          lastModified: '2026-01-01T00:00:00.000Z',
          messages: [
            userMsg('older work'),
            toolSuccess(
              'run_command',
              { command: 'npm test', cwd: null, terminalId: 'x' },
              { command: 'npm test' },
            ),
          ],
        },
      },
    });

    assert.ok(summary.includes('Recent actions across threads:'));
    assert.ok(summary.includes('edit_file'));
    assert.ok(summary.includes('run_command'));
    assert.ok(summary.includes('[newer-th…]') || summary.includes('newer-th'));
    assert.ok(summary.includes('[older-th…]') || summary.includes('older-th'));
  });

  test('formatToolActionLine for get_chat_history', () => {
    const overview = toolSuccess('get_chat_history', { threadId: null }, {}) as Extract<
      ChatMessage,
      { role: 'tool' }
    >;
    assert.strictEqual(formatToolActionLine(overview), 'get_chat_history overview (ok)');

    const detail = toolSuccess(
      'get_chat_history',
      { threadId: 'abcdefgh-ijkl' },
      { thread_id: 'abcdefgh-ijkl' },
    ) as Extract<ChatMessage, { role: 'tool' }>;
    assert.strictEqual(formatToolActionLine(detail), 'get_chat_history abcdefgh (ok)');
  });
});
