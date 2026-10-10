/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  COMPACT_TOOL_MAX_CHARS,
  compactOldToolResults,
  compactToolResult,
} from '../../common/compactChatContext.js';
import { TrimableChatMessage } from '../../common/trimChatContext.js';

const ascii = (n: number, ch = 'a'): string => ch.repeat(n);

const recent = (label: string): TrimableChatMessage => ({ role: 'user', content: label });

suite('compactChatContext', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('a large middle read_file becomes a digest that names the path', () => {
    const dump = ascii(4000);
    const tail = ['a', 'b', 'c', 'd'];
    const rawParams = { uri: '/proj/src/app.ts' };
    const messages: TrimableChatMessage[] = [
      { role: 'user', content: 'start' },
      { role: 'assistant', content: 'looking' },
      {
        role: 'tool',
        content: `/proj/src/app.ts\n\`\`\`\n${dump}\n\`\`\``,
        name: 'read_file',
        rawParams,
      },
      ...tail.map(recent),
    ];

    compactOldToolResults(messages);

    const tool = messages[2];
    assert.strictEqual(tool.role, 'tool');
    if (tool.role === 'tool') {
      assert.ok(tool.content.includes('/proj/src/app.ts'));
      assert.ok(tool.content.includes('read_file'));
      assert.ok(tool.content.includes('omitted'));
      assert.ok(tool.content.length < dump.length);
      assert.ok(tool.content.length <= COMPACT_TOOL_MAX_CHARS);
      assert.strictEqual(tool.rawParams, rawParams);
    }
    assert.strictEqual(messages[1].content, 'looking');
    assert.deepStrictEqual(
      messages.slice(3).map((m) => m.content),
      tail,
    );
  });

  test('the last four messages stay intact, including a huge tool result', () => {
    const dump = ascii(4000);
    const messages: TrimableChatMessage[] = [
      { role: 'user', content: 'start' },
      { role: 'tool', content: dump, name: 'read_file', rawParams: { uri: '/old.ts' } },
      { role: 'tool', content: dump, name: 'read_file', rawParams: { uri: '/recent.ts' } },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];

    compactOldToolResults(messages);

    assert.ok(messages[1].content.includes('/old.ts'));
    assert.ok(messages[1].content.length < dump.length);
    assert.strictEqual(messages[2].content, dump);
    assert.strictEqual(messages[3].content, 'a');
    assert.strictEqual(messages[4].content, 'b');
    assert.strictEqual(messages[5].content, 'c');
  });

  test('a short tool result is not replaced by a longer digest', () => {
    const short = 'ok';
    const messages: TrimableChatMessage[] = [
      { role: 'user', content: 'start' },
      {
        role: 'tool',
        content: short,
        name: 'read_file',
        rawParams: { uri: '/proj/src/very/long/path/file.ts' },
      },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ];

    compactOldToolResults(messages);

    assert.strictEqual(messages[1].content, short);
  });

  test('search, edit, and command digests keep the useful facts', () => {
    const search = compactToolResult(
      'search_for_files',
      { query: 'trimChatContext' },
      ['/proj/a.ts', '/proj/b.ts', '(more on next page...)', ascii(2000)].join('\n'),
    );
    assert.ok(search.includes('trimChatContext'));
    assert.ok(search.includes('/proj/a.ts'));
    assert.ok(search.includes('More omitted'));
    assert.ok(search.length <= COMPACT_TOOL_MAX_CHARS);

    const edit = compactToolResult(
      'edit_file',
      { uri: '/proj/a.ts' },
      `Change successfully made to /proj/a.ts. Lint errors found after change:\nError 1:\nLines Affected: 1-2\nError message: boom\n\n${ascii(2000)}`,
    );
    assert.ok(edit.includes('/proj/a.ts'));
    assert.ok(edit.includes('applied'));
    assert.ok(edit.includes('boom'));

    const command = compactToolResult(
      'run_command',
      { command: 'npm test' },
      `${ascii(3000)}\n(exit code 1)`,
    );
    assert.ok(command.includes('npm test'));
    assert.ok(command.includes('exit code 1'));
    assert.ok(!command.includes(ascii(100)));
  });

  test('glob, web, memory, and parallel subagent digests stay short', () => {
    const glob = compactToolResult(
      'glob_files',
      { pattern: '**/*.ts' },
      ['/proj/a.ts\tmtime=1\tsize=2', '/proj/b.ts\tmtime=3\tsize=4', '(truncated)', ascii(2000)].join(
        '\n',
      ),
    );
    assert.ok(glob.includes('**/*.ts'));
    assert.ok(glob.includes('2 files') || glob.includes('3 files'));
    assert.ok(glob.includes('More omitted') || glob.includes('truncated') || glob.includes('file'));
    assert.ok(glob.length <= COMPACT_TOOL_MAX_CHARS);

    const web = compactToolResult(
      'web_search',
      { query: 'vscode uri' },
      ['1. Title', 'https://example.com', 'snippet', '', '2. Other', ascii(2000)].join('\n'),
    );
    assert.ok(web.includes('vscode uri'));
    assert.ok(web.includes('omitted'));

    const browse = compactToolResult(
      'browse_url',
      { url: 'https://example.com/docs' },
      ascii(3000),
    );
    assert.ok(browse.includes('example.com'));
    assert.ok(browse.includes('omitted'));

    const mem = compactToolResult(
      'save_memory',
      { type: 'decision', key: 'package-manager' },
      'Memory saved: key="package-manager".',
    );
    assert.ok(mem.includes('package-manager'));
    assert.ok(mem.includes('saved'));

    const parallel = compactToolResult(
      'run_parallel_subagents',
      {
        tasks: [
          { description: 'a', prompt: 'p1' },
          { description: 'b', prompt: 'p2' },
        ],
      },
      ascii(2000),
    );
    assert.ok(parallel.includes('2 tasks'));
    assert.ok(parallel.length <= COMPACT_TOOL_MAX_CHARS);
  });

  test('code nav digests keep path and location count', () => {
    const body = [
      '/proj/a.ts:10-12',
      'export function foo() {',
      '',
      '/proj/b.ts:3-3',
      'foo();',
      '',
      ascii(2000),
    ].join('\n');
    const def = compactToolResult(
      'go_to_definition',
      { uri: '/proj/caller.ts', line: '20', symbol: 'foo' },
      body,
    );
    assert.ok(def.includes('/proj/caller.ts'));
    assert.ok(def.includes('foo'));
    assert.ok(def.includes('2 locations'));
    assert.ok(def.length <= COMPACT_TOOL_MAX_CHARS);

    const empty = compactToolResult(
      'find_references',
      { uri: '/proj/a.ts', line: '1' },
      'No references found for this symbol.',
    );
    assert.ok(empty.includes('No references'));
  });
});
