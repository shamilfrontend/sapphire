/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatMessage } from '../../common/chatThreadServiceTypes.js';
import {
  applyCompactionReplace,
  buildCompactionTranscript,
  buildContextSummaryMessage,
  CONTEXT_COMPACTION_KEEP_RECENT,
  CONTEXT_SUMMARY_LLM_PREFIX,
  contextSummaryToLlmContent,
  expandTailStartForToolBatch,
  shouldCompactContext,
  splitMessagesForCompaction,
} from '../../common/contextCompaction.js';

const user = (text: string): ChatMessage => ({
  role: 'user',
  content: text,
  displayContent: text,
  selections: null,
  state: { stagingSelections: [], isBeingEdited: false },
});

const assistant = (text: string): ChatMessage => ({
  role: 'assistant',
  displayContent: text,
  reasoning: '',
});

const tool = (name: string, content: string): ChatMessage =>
  ({
    role: 'tool',
    name,
    id: `id-${name}-${content.slice(0, 8)}`,
    content,
    rawParams: {},
    mcpServerName: undefined,
    type: 'success',
    result: {},
    params: {},
  }) as ChatMessage;

suite('contextCompaction', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('splitMessagesForCompaction keeps a recent tail and a compressible prefix', () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push(user(`u${i}`));
      messages.push(assistant(`a${i}`));
    }
    const split = splitMessagesForCompaction(messages, 8);
    assert.ok(split);
    assert.strictEqual(split!.tail.length, 8);
    assert.strictEqual(split!.prefix.length + split!.tail.length, messages.length);
    assert.ok(split!.prefix.length >= 2);
  });

  test('splitMessagesForCompaction returns null when the thread is short', () => {
    const messages = [user('a'), assistant('b'), user('c')];
    assert.strictEqual(splitMessagesForCompaction(messages, 8), null);
  });

  test('expandTailStartForToolBatch pulls the assistant before trailing tools into the tail', () => {
    const messages: ChatMessage[] = [
      user('old'),
      assistant('old-a'),
      user('recent'),
      assistant('calling tools'),
      tool('read_file', 'file contents'),
      tool('run_command', 'ok'),
    ];
    // Пробный старт с первого tool «осиротил» бы tool-сообщения от assistant.
    const start = expandTailStartForToolBatch(messages, 4);
    assert.strictEqual(start, 3);
    assert.strictEqual(messages[start].role, 'assistant');
  });

  test('shouldCompactContext requires threshold, growth since last compact, and a valid split', () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < CONTEXT_COMPACTION_KEEP_RECENT + 4; i++) {
      messages.push(user(`m${i}`));
    }

    assert.strictEqual(
      shouldCompactContext({
        percentFull: 50,
        messages,
        lastCompactedAtMessageCount: undefined,
      }),
      false,
    );

    assert.strictEqual(
      shouldCompactContext({
        percentFull: 90,
        messages,
        lastCompactedAtMessageCount: messages.length,
      }),
      false,
    );

    assert.strictEqual(
      shouldCompactContext({
        percentFull: 90,
        messages,
        lastCompactedAtMessageCount: undefined,
      }),
      true,
    );

    assert.strictEqual(
      shouldCompactContext({
        percentFull: 90,
        messages,
        lastCompactedAtMessageCount: messages.length - 1,
      }),
      true,
    );
  });

  test('buildCompactionTranscript skips checkpoints and includes roles', () => {
    const messages: ChatMessage[] = [
      user('Build cart'),
      {
        role: 'checkpoint',
        type: 'user_edit',
        sapphireFileSnapshotOfURI: {},
        userModifications: { sapphireFileSnapshotOfURI: {} },
      },
      assistant('I will edit app.ts'),
      tool('edit_file', 'patched'),
    ];
    const transcript = buildCompactionTranscript(messages);
    assert.ok(transcript.includes('USER: Build cart'));
    assert.ok(transcript.includes('ASSISTANT: I will edit app.ts'));
    assert.ok(transcript.includes('TOOL edit_file'));
    assert.ok(!transcript.includes('checkpoint'));
  });

  test('buildContextSummaryMessage and applyCompactionReplace produce summary + tail', () => {
    const tail = [user('continue'), assistant('ok')];
    const summary = buildContextSummaryMessage({
      summaryText: 'Built the cart; open: tests',
      compactedFromTokens: 90_000,
      compactedToTokens: 400,
    });
    assert.strictEqual(summary.role, 'context_summary');
    assert.strictEqual(summary.compactedFromTokens, 90_000);

    const next = applyCompactionReplace(summary, tail);
    assert.strictEqual(next.length, 3);
    assert.strictEqual(next[0].role, 'context_summary');
    assert.strictEqual(next[1], tail[0]);
    assert.strictEqual(next[2], tail[1]);
  });

  test('contextSummaryToLlmContent wraps with the wire prefix', () => {
    const content = contextSummaryToLlmContent({ content: 'Goals: ship cart' });
    assert.ok(content.startsWith(CONTEXT_SUMMARY_LLM_PREFIX));
    assert.ok(content.includes('Goals: ship cart'));
  });
});
