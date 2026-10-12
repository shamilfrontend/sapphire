/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  omittedToolBodyPrompt,
  parallelReadOnlyToolNames,
  parallelReadOnlyToolPrompt,
  segmentToolCalls,
} from '../../common/toolCallSchedule.js';

const call = (name: string) => ({ name });

suite('toolCallSchedule', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('two reads in a row are one parallel group', () => {
    const segments = segmentToolCalls([call('read_file'), call('search_for_files')]);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].kind, 'parallel');
    if (segments[0].kind === 'parallel') {
      assert.deepStrictEqual(
        segments[0].calls.map((c) => c.name),
        ['read_file', 'search_for_files'],
      );
    }
  });

  test('new read-only search tools are parallelizable', () => {
    assert.ok(parallelReadOnlyToolNames().includes('grep_search'));
    assert.ok(parallelReadOnlyToolNames().includes('glob_files'));
    assert.ok(parallelReadOnlyToolNames().includes('web_search'));
    assert.ok(parallelReadOnlyToolNames().includes('browse_url'));
    assert.ok(parallelReadOnlyToolNames().includes('get_diagnostics'));
    assert.ok(parallelReadOnlyToolNames().includes('search_symbols'));
    assert.ok(!parallelReadOnlyToolNames().includes('rename_symbol'));
    assert.ok(!parallelReadOnlyToolNames().includes('save_memory'));
    assert.ok(!parallelReadOnlyToolNames().includes('run_parallel_subagents'));
    const segments = segmentToolCalls([
      call('grep_search'),
      call('glob_files'),
      call('web_search'),
      call('browse_url'),
      call('get_diagnostics'),
      call('search_symbols'),
    ]);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].kind, 'parallel');
  });

  test('save_memory and run_parallel_subagents stay serial', () => {
    const segments = segmentToolCalls([
      call('read_file'),
      call('save_memory'),
      call('run_parallel_subagents'),
      call('read_file'),
    ]);
    assert.deepStrictEqual(
      segments.map((segment) => segment.kind),
      ['serial', 'serial', 'serial', 'serial'],
    );
  });

  test('rename_symbol stays serial like other edits', () => {
    const segments = segmentToolCalls([call('read_file'), call('rename_symbol'), call('read_file')]);
    assert.deepStrictEqual(
      segments.map((segment) => segment.kind),
      ['serial', 'serial', 'serial'],
    );
    if (segments[1].kind === 'serial') {
      assert.strictEqual(segments[1].call.name, 'rename_symbol');
    }
  });

  test('run_subagent is not parallelizable', () => {
    assert.ok(!parallelReadOnlyToolNames().includes('run_subagent'));
    const segments = segmentToolCalls([call('read_file'), call('run_subagent'), call('read_file')]);
    assert.deepStrictEqual(
      segments.map((segment) => segment.kind),
      ['serial', 'serial', 'serial'],
    );
    if (segments[1].kind === 'serial') {
      assert.strictEqual(segments[1].call.name, 'run_subagent');
    }
  });

  test('reads around an edit stay in order: group, edit, single read', () => {
    const segments = segmentToolCalls([
      call('read_file'),
      call('ls_dir'),
      call('edit_file'),
      call('read_file'),
    ]);
    assert.strictEqual(segments.length, 3);
    assert.strictEqual(segments[0].kind, 'parallel');
    assert.strictEqual(segments[1].kind, 'serial');
    assert.strictEqual(segments[2].kind, 'serial');
    if (segments[0].kind === 'parallel') {
      assert.deepStrictEqual(
        segments[0].calls.map((c) => c.name),
        ['read_file', 'ls_dir'],
      );
    }
    if (segments[1].kind === 'serial') {
      assert.strictEqual(segments[1].call.name, 'edit_file');
    }
    if (segments[2].kind === 'serial') {
      assert.strictEqual(segments[2].call.name, 'read_file');
    }
  });

  test('create_plan and an unknown MCP name are barriers', () => {
    const segments = segmentToolCalls([
      call('read_file'),
      call('create_plan'),
      call('read_lint_errors'),
      call('figma.get_design'),
      call('get_chat_history'),
      call('search_in_file'),
    ]);
    assert.deepStrictEqual(
      segments.map((segment) => segment.kind),
      ['serial', 'serial', 'serial', 'serial', 'parallel'],
    );
    if (segments[1].kind === 'serial') {
      assert.strictEqual(segments[1].call.name, 'create_plan');
    }
    if (segments[3].kind === 'serial') {
      assert.strictEqual(segments[3].call.name, 'figma.get_design');
    }
    if (segments[4].kind === 'parallel') {
      assert.deepStrictEqual(
        segments[4].calls.map((c) => c.name),
        ['get_chat_history', 'search_in_file'],
      );
    }
  });

  test('prompt lists every parallel read-only tool', () => {
    const text = parallelReadOnlyToolPrompt();
    for (const name of parallelReadOnlyToolNames()) {
      assert.ok(text.includes(name), name);
    }
    assert.ok(!text.includes('ONE tool call'));
    assert.ok(text.includes('one at a time'));
    assert.ok(omittedToolBodyPrompt().includes('omitted'));
    assert.ok(omittedToolBodyPrompt().includes('read that path again'));
  });

  test('a single read is not grouped', () => {
    const segments = segmentToolCalls([call('read_file')]);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].kind, 'serial');
    if (segments[0].kind === 'serial') {
      assert.strictEqual(segments[0].call.name, 'read_file');
    }
  });

  test('go_to_definition and find_references are parallel read-only', () => {
    assert.ok(parallelReadOnlyToolNames().includes('go_to_definition'));
    assert.ok(parallelReadOnlyToolNames().includes('find_references'));
    const segments = segmentToolCalls([
      call('go_to_definition'),
      call('find_references'),
      call('read_file'),
    ]);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].kind, 'parallel');
  });
});
