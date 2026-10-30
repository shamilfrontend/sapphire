/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	agentWorktreeBranchName,
	agentWorktreePath,
	gitWorktreeAddCommand,
	worktreePromptAddon,
} from '../../common/agentWorktree.js';

suite('agentWorktree', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('builds stable path and branch', () => {
		const path = agentWorktreePath('/repo', 'abc-123-def');
		assert.ok(path.includes('.sapphire'));
		assert.ok(path.includes('worktrees'));
		assert.ok(agentWorktreeBranchName('abc-123').startsWith('sapphire-agent-'));
	});

	test('git add command quotes path', () => {
		const cmd = gitWorktreeAddCommand('/tmp/my wt', 'sapphire-agent-x');
		assert.ok(cmd.includes('git worktree add'));
		assert.ok(cmd.includes('sapphire-agent-x'));
	});

	test('prompt mentions isolation root', () => {
		assert.ok(worktreePromptAddon('/repo/.sapphire/worktrees/x').includes('/repo/.sapphire/worktrees/x'));
	});
});
