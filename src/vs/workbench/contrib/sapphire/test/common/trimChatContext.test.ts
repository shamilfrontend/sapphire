/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  TRIM_TO_LEN,
  TrimableChatMessage,
  trimMessagesToFreeTokens,
} from '../../common/trimChatContext.js';

const ascii = (n: number, ch = 'a'): string => ch.repeat(n);

const snapshot = (messages: TrimableChatMessage[]): string[] => messages.map((m) => m.content);

suite('trimChatContext', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('tokensToFree = 0 leaves messages unchanged', () => {
    const messages: TrimableChatMessage[] = [
      { role: 'user', content: ascii(400) },
      { role: 'assistant', content: ascii(400) },
      {
        role: 'tool',
        content: ascii(4000),
        name: 'read_file',
        rawParams: {},
      },
    ];
    const before = snapshot(messages);
    trimMessagesToFreeTokens(messages, 0);
    assert.deepStrictEqual(snapshot(messages), before);
  });

  test('large middle tool result is trimmed before user and assistant', () => {
    const firstUser = 'hello';
    const toolDump = ascii(4000);
    const assistant = ascii(800);
    const recent = 'ok';
    const messages: TrimableChatMessage[] = [
      { role: 'user', content: firstUser },
      { role: 'assistant', content: assistant },
      { role: 'tool', content: toolDump, name: 'read_file', rawParams: {} },
      { role: 'user', content: recent },
      { role: 'assistant', content: recent },
      { role: 'user', content: recent },
      { role: 'assistant', content: recent },
    ];

    trimMessagesToFreeTokens(messages, 200);

    assert.strictEqual(messages[0].content, firstUser);
    assert.strictEqual(messages[1].content, assistant);
    assert.ok(messages[2].content.length < toolDump.length);
    assert.ok(messages[2].content.endsWith('...'));
    assert.strictEqual(messages[3].content, recent);
    assert.strictEqual(messages[4].content, recent);
    assert.strictEqual(messages[5].content, recent);
    assert.strictEqual(messages[6].content, recent);
  });

  test('first user and last four messages are protected', () => {
    const first = ascii(4000);
    const middleTool = ascii(4000);
    const last = ascii(4000);
    const messages: TrimableChatMessage[] = [
      { role: 'user', content: first },
      { role: 'tool', content: middleTool, name: 'read_file', rawParams: {} },
      { role: 'assistant', content: 'mid' },
      { role: 'user', content: last },
      { role: 'assistant', content: last },
      { role: 'user', content: last },
      { role: 'assistant', content: last },
    ];

    trimMessagesToFreeTokens(messages, 300);

    assert.strictEqual(messages[0].content, first);
    assert.ok(messages[1].content.length < middleTool.length);
    assert.ok(messages[1].content.endsWith('...'));
    assert.strictEqual(messages[3].content, last);
    assert.strictEqual(messages[4].content, last);
    assert.strictEqual(messages[5].content, last);
    assert.strictEqual(messages[6].content, last);
  });

  test('after collapse to TRIM_TO_LEN the same index is not trimmed again', () => {
    const toolDump = ascii(8000);
    const assistantDump = ascii(8000);
    const recent = 'ok';
    const messages: TrimableChatMessage[] = [
      { role: 'user', content: 'start' },
      { role: 'tool', content: toolDump, name: 'read_file', rawParams: {} },
      { role: 'assistant', content: assistantDump },
      { role: 'user', content: recent },
      { role: 'assistant', content: recent },
      { role: 'user', content: recent },
      { role: 'assistant', content: recent },
    ];

    // Может освободиться больше одного слота — второе сообщение тоже обрезаем.
    trimMessagesToFreeTokens(messages, 5000);

    assert.ok(messages[1].content.length <= TRIM_TO_LEN);
    assert.ok(messages[1].content.endsWith('...'));
    assert.ok(messages[2].content.length < assistantDump.length);
    assert.ok(messages[2].content.endsWith('...'));
    assert.strictEqual(messages[0].content, 'start');
  });

  test('ellipsis is appended when content is cut', () => {
    const messages: TrimableChatMessage[] = [
      { role: 'user', content: 'start' },
      { role: 'tool', content: ascii(2000), name: 'ls_dir', rawParams: {} },
      { role: 'assistant', content: 'mid' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ];

    trimMessagesToFreeTokens(messages, 50);
    assert.ok(messages[1].content.endsWith('...'));
  });
});
