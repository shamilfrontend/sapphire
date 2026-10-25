/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import { ChatMessage } from '../../common/chatThreadServiceTypes.js';
import {
  CHAT_THREAD_LOG_RESULT_CAP,
  formatChatThreadLog,
} from '../../common/formatChatThreadLog.js';

suite('formatChatThreadLog', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  const userMsg = (text: string): ChatMessage => ({
    role: 'user',
    content: text,
    displayContent: text,
    selections: null,
    state: { stagingSelections: [], isBeingEdited: false },
  });

  test('includes every reasoning block in order, untruncated', () => {
    const messages: ChatMessage[] = [
      userMsg('сделай xlsx'),
      {
        role: 'assistant',
        displayContent: 'Сначала план.',
        reasoning: 'Думаю про openpyxl и 60 месяцев.',
      },
      {
        role: 'tool',
        type: 'success',
        name: 'run_command',
        id: 't1',
        content: 'ok',
        rawParams: {},
        mcpServerName: undefined,
        params: { command: 'python gen.py', cwd: null, terminalId: null } as never,
        result: { result: 'done', resolveReason: { type: 'done', exitCode: 0 } } as never,
      },
      {
        role: 'assistant',
        displayContent: 'Готово.',
        reasoning: 'Второй ход: проверяю итоги 8248636.',
      },
    ];

    const log = formatChatThreadLog(messages, {
      threadId: 'abc',
      createdAt: '2026-10-02T12:00:00.000Z',
      now: new Date('2026-10-02T13:00:00.000Z'),
    });

    assert.ok(log.includes('Тред: `abc`'));
    assert.ok(log.includes('## Пользователь'));
    assert.ok(log.includes('сделай xlsx'));
    assert.ok(log.includes('### Рассуждение'));
    assert.ok(log.includes('Думаю про openpyxl и 60 месяцев.'));
    assert.ok(log.includes('Второй ход: проверяю итоги 8248636.'));
    assert.ok(log.includes('## Инструмент: `run_command`'));
    assert.ok(log.includes('### Ответ'));
    assert.ok(log.includes('Готово.'));

    const firstReasoning = log.indexOf('Думаю про openpyxl');
    const secondReasoning = log.indexOf('Второй ход: проверяю итоги');
    assert.ok(firstReasoning >= 0 && secondReasoning > firstReasoning);
  });

  test('keeps promoted-only reply when reasoning field is empty', () => {
    const log = formatChatThreadLog([
      {
        role: 'assistant',
        displayContent: 'Текст был только в reasoning.',
        reasoning: '',
      },
    ]);
    assert.ok(log.includes('Текст был только в reasoning.'));
    assert.ok(!log.includes('### Рассуждение'));
  });

  test('truncates huge tool results but never reasoning', () => {
    const huge = 'x'.repeat(CHAT_THREAD_LOG_RESULT_CAP + 100);
    const longThought = 'y'.repeat(CHAT_THREAD_LOG_RESULT_CAP + 50);
    const log = formatChatThreadLog([
      {
        role: 'assistant',
        displayContent: 'ok',
        reasoning: longThought,
      },
      {
        role: 'tool',
        type: 'tool_error',
        name: 'read_file',
        id: 't2',
        content: huge,
        rawParams: {},
        mcpServerName: undefined,
        params: { uri: URI.file('/tmp/a'), startLine: null, endLine: null, pageNumber: 1 } as never,
        result: huge,
      },
    ]);
    assert.ok(log.includes(longThought));
    assert.ok(log.includes('обрезано'));
    assert.ok(!log.includes(huge));
  });

  test('marks checkpoints and empty threads', () => {
    assert.ok(formatChatThreadLog([]).includes('_(пусто)_'));
    const log = formatChatThreadLog([
      {
        role: 'checkpoint',
        type: 'user_edit',
        sapphireFileSnapshotOfURI: {},
        userModifications: { sapphireFileSnapshotOfURI: {} },
      },
    ]);
    assert.ok(log.includes('## Checkpoint (user_edit)'));
  });
});
