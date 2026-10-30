/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	formatAgentSkillsCatalog,
	parseSkillMarkdown,
	resolveAgentSkillBodies,
	workspaceSkillsAlwaysOnBody,
	workspaceSkillsFileEntry,
	WORKSPACE_SKILLS_ALWAYS_ON_MAX_CHARS,
	WORKSPACE_SKILLS_FILE_SLUG,
} from '../../common/agentSkills.js';

suite('agentSkills', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses SKILL.md frontmatter', () => {
		const skill = parseSkillMarkdown(
			`---
name: Code Review
description: Review PRs carefully
---
# Steps
1. Read the diff
`,
			'code-review',
		);
		assert.ok(skill);
		assert.strictEqual(skill!.slug, 'code-review');
		assert.strictEqual(skill!.description, 'Review PRs carefully');
		assert.ok(skill!.body.includes('Read the diff'));
	});

	test('catalog and slash resolve', () => {
		const a = parseSkillMarkdown('---\nname: alpha\ndescription: A\n---\nbody-a', 'alpha')!;
		const b = parseSkillMarkdown('---\nname: beta\ndescription: B\n---\nbody-b', 'beta')!;
		const catalog = formatAgentSkillsCatalog([a, b]);
		assert.ok(catalog.includes('/alpha:'));
		assert.ok(catalog.includes('/beta:'));
		assert.strictEqual(resolveAgentSkillBodies([a, b], ['beta']), 'body-b');
		assert.strictEqual(resolveAgentSkillBodies([a, b], ['nope']), '');
	});

	test('legacy .skills short stays always-on, long becomes slash-only', () => {
		const short = 'keep always';
		assert.strictEqual(workspaceSkillsAlwaysOnBody(short), short);
		const long = 'x'.repeat(WORKSPACE_SKILLS_ALWAYS_ON_MAX_CHARS + 1);
		assert.strictEqual(workspaceSkillsAlwaysOnBody(long), '');
		const entry = workspaceSkillsFileEntry(long)!;
		assert.strictEqual(entry.slug, WORKSPACE_SKILLS_FILE_SLUG);
		assert.ok(resolveAgentSkillBodies([entry], [WORKSPACE_SKILLS_FILE_SLUG]).startsWith('x'));
	});
});
