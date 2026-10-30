/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { availableTools, InternalToolInfo } from '../../common/prompt/prompts.js';
import {
  mcpServersMentionedInText,
  mergeEnabledMcpServers,
  stableMcpToolName,
} from '../../common/prompt/mcpToolDisclosure.js';
import { removeMCPToolNamePrefix } from '../../common/mcpServiceTypes.js';
import { ChatMode } from '../../common/sapphireSettingsTypes.js';

const toolNames = (chatMode: ChatMode, allowUpdatePlan?: boolean): string[] =>
  (availableTools(chatMode, undefined, { allowUpdatePlan }) ?? []).map((tool) => tool.name);

const mcpTool = (serverName: string, name: string): InternalToolInfo => ({
  name,
  description: name,
  params: {},
  mcpServerName: serverName,
});

const figmaAndGitlab: InternalToolInfo[] = [
  mcpTool('figma-desktop', 'figma-desktop_get_design_context'),
  mcpTool('figma-desktop', 'figma-desktop_get_screenshot'),
  mcpTool('gitlab', 'gitlab_list_issues'),
];

suite('availableTools', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('agent omits update_plan unless a plan is being built', () => {
    assert.ok(!toolNames('agent').includes('update_plan'));
    assert.ok(!toolNames('agent').includes('create_plan'));
    assert.ok(!toolNames('agent').includes('enable_mcp_server'));
    assert.ok(toolNames('agent', true).includes('update_plan'));
    assert.ok(!toolNames('agent', true).includes('create_plan'));
  });

  test('plan mode always includes create_plan and update_plan', () => {
    assert.ok(toolNames('plan').includes('create_plan'));
    assert.ok(toolNames('plan').includes('update_plan'));
    assert.ok(toolNames('plan', false).includes('update_plan'));
    assert.ok(!toolNames('plan').includes('enable_mcp_server'));
    assert.ok(toolNames('plan').includes('go_to_definition'));
    assert.ok(toolNames('plan').includes('find_references'));
    assert.ok(toolNames('plan').includes('grep_search'));
    assert.ok(toolNames('plan').includes('glob_files'));
    assert.ok(toolNames('plan').includes('get_diagnostics'));
    assert.ok(toolNames('plan').includes('search_symbols'));
    assert.ok(toolNames('agent').includes('go_to_definition'));
    assert.ok(toolNames('agent').includes('find_references'));
    assert.ok(toolNames('agent').includes('grep_search'));
    assert.ok(toolNames('agent').includes('glob_files'));
    assert.ok(toolNames('agent').includes('get_diagnostics'));
    assert.ok(toolNames('agent').includes('search_symbols'));
    assert.ok(toolNames('agent').includes('rename_symbol'));
    assert.ok(!toolNames('plan').includes('rename_symbol'));
    assert.ok(toolNames('agent').includes('run_subagent'));
    assert.ok(!toolNames('plan').includes('run_subagent'));
    assert.ok(toolNames('agent').includes('run_parallel_subagents'));
    assert.ok(!toolNames('plan').includes('run_parallel_subagents'));
    assert.ok(toolNames('agent').includes('web_search'));
    assert.ok(toolNames('agent').includes('browse_url'));
    assert.ok(toolNames('agent').includes('browser_navigate'));
    assert.ok(toolNames('agent').includes('browser_click'));
    assert.ok(toolNames('agent').includes('save_memory'));
    assert.ok(!toolNames('plan').includes('web_search'));
    assert.ok(!toolNames('plan').includes('browse_url'));
    assert.ok(!toolNames('plan').includes('browser_navigate'));
    assert.ok(!toolNames('plan').includes('browser_click'));
    assert.ok(!toolNames('plan').includes('save_memory'));
  });

  test('allowedToolNames intersects with agent tools for read-only subagents', () => {
    const tools =
      availableTools('agent', undefined, {
        allowedToolNames: ['read_file', 'glob_files', 'grep_search'],
      }) ?? [];
    const names = tools.map((t) => t.name);
    assert.deepStrictEqual(names.sort(), ['glob_files', 'grep_search', 'read_file'].sort());
    assert.ok(!names.includes('web_search'));
    assert.ok(!names.includes('edit_file'));
    assert.ok(!names.includes('run_parallel_subagents'));
  });

  test('excludedToolNames removes run_subagent from agent tools', () => {
    const tools =
      availableTools('agent', undefined, { excludedToolNames: ['run_subagent'] }) ?? [];
    assert.ok(!tools.some((tool) => tool.name === 'run_subagent'));
    assert.ok(tools.some((tool) => tool.name === 'read_file'));
  });

  test('disableAllTools returns an empty list in agent mode', () => {
    const tools = availableTools('agent', undefined, { disableAllTools: true });
    assert.ok(Array.isArray(tools));
    assert.strictEqual(tools?.length, 0);
  });

  test('chat mode has no builtin tools', () => {
    assert.strictEqual(availableTools('normal', undefined), undefined);
  });

  test('agent defers MCP schemas until that server is enabled', () => {
    const deferred = availableTools('agent', figmaAndGitlab) ?? [];
    const deferredNames = deferred.map((tool) => tool.name);
    assert.ok(deferredNames.includes('enable_mcp_server'));
    assert.ok(!deferredNames.includes('figma-desktop_get_design_context'));
    assert.ok(!deferredNames.includes('gitlab_list_issues'));

    const enable = deferred.find((tool) => tool.name === 'enable_mcp_server');
    assert.ok(enable?.description.includes('figma-desktop'));
    assert.ok(enable?.description.includes('get_design_context'));
    assert.ok(enable?.description.includes('gitlab'));

    const enabled = availableTools('agent', figmaAndGitlab, {
      enabledMcpServerNames: ['figma-desktop'],
    }) ?? [];
    const enabledNames = enabled.map((tool) => tool.name);
    assert.ok(enabledNames.includes('figma-desktop_get_design_context'));
    assert.ok(enabledNames.includes('figma-desktop_get_screenshot'));
    assert.ok(!enabledNames.includes('gitlab_list_issues'));
  });

  test('plan mode does not receive MCP tools even when a server is enabled', () => {
    const tools = availableTools('plan', figmaAndGitlab, {
      enabledMcpServerNames: ['figma-desktop'],
    }) ?? [];
    assert.ok(tools.every((tool) => !tool.mcpServerName));
    assert.ok(!tools.some((tool) => tool.name === 'enable_mcp_server'));
  });
});

suite('mcpToolDisclosure', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  const servers = ['figma-desktop', 'gitlab'];

  test('figma word and figma.com enable figma-desktop', () => {
    assert.deepStrictEqual(mcpServersMentionedInText('посмотри макет в figma', servers), [
      'figma-desktop',
    ]);
    assert.deepStrictEqual(
      mcpServersMentionedInText('https://www.figma.com/design/abc', servers),
      ['figma-desktop'],
    );
  });

  test('a code request enables nothing', () => {
    assert.deepStrictEqual(mcpServersMentionedInText('поправь баг в SidebarChat', servers), []);
  });

  test('a server name enables only that server', () => {
    assert.deepStrictEqual(mcpServersMentionedInText('check gitlab issues', servers), ['gitlab']);
    assert.deepStrictEqual(mcpServersMentionedInText('mygitlab helper', ['gitlab']), []);
  });

  test('figma does not enable a server that is offline', () => {
    assert.deepStrictEqual(mcpServersMentionedInText('открой figma', ['gitlab']), []);
  });

  test('merge keeps persisted servers and adds mentions', () => {
    assert.deepStrictEqual(mergeEnabledMcpServers(['gitlab'], 'figma макет', servers), [
      'gitlab',
      'figma-desktop',
    ]);
  });

  test('stable prefix strips back to the original tool name', () => {
    assert.strictEqual(
      removeMCPToolNamePrefix(stableMcpToolName('figma-desktop', 'get_design_context')),
      'get_design_context',
    );
    assert.strictEqual(
      removeMCPToolNamePrefix(stableMcpToolName('my_server', 'foo_bar')),
      'foo_bar',
    );
  });
});
