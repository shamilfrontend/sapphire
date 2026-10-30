/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function agentWorktreeBranchName(childId: string): string {
	const short = childId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'agent';
	return `sapphire-agent-${short}`;
}

export function agentWorktreePath(workspaceRoot: string, childId: string): string {
	const short = childId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'agent';
	const root = workspaceRoot.replace(/[/\\]+$/, '');
	const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
	return [root, '.sapphire', 'worktrees', short].join(sep);
}

export function gitWorktreeAddCommand(worktreePath: string, branch: string): string {
	const escapedPath = worktreePath.replace(/"/g, '\\"');
	const escapedBranch = branch.replace(/"/g, '\\"');
	return `git worktree add -B "${escapedBranch}" "${escapedPath}" HEAD`;
}

export function gitWorktreeRemoveCommand(worktreePath: string): string {
	const escapedPath = worktreePath.replace(/"/g, '\\"');
	return `git worktree remove --force "${escapedPath}"`;
}

export function worktreePromptAddon(worktreePath: string): string {
	return [
		`Isolation: your writable workspace root for this sub-agent is:`,
		worktreePath,
		`Prefer absolute paths under that directory for edits. Do not modify files outside it.`,
	].join('\n');
}
