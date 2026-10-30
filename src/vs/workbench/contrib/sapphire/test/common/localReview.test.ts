/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildLocalReviewPrompt, clipReviewText } from '../../common/localReview.js';

suite('localReview', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('clips long diffs', () => {
		const clipped = clipReviewText('abcdef', 3);
		assert.strictEqual(clipped.truncated, true);
		assert.ok(clipped.text.startsWith('abc'));
		assert.strictEqual(clipReviewText('ab', 3).truncated, false);
	});

	test('prompt names working tree and forbids edits', () => {
		const prompt = buildLocalReviewPrompt({
			kind: 'working-tree',
			branch: 'feat',
			base: 'HEAD',
			stat: ' a.ts | 1 +',
			diff: '+const x = 1',
			truncated: false,
		});
		assert.ok(prompt.includes('незакоммиченные'));
		assert.ok(prompt.includes('Не правь файлы'));
		assert.ok(prompt.includes('+const x = 1'));
	});

	test('prompt names branch base', () => {
		const prompt = buildLocalReviewPrompt({
			kind: 'branch',
			branch: 'feat',
			base: 'main',
			stat: '',
			diff: 'diff',
			truncated: true,
		});
		assert.ok(prompt.includes('main'));
		assert.ok(prompt.includes('обрезан'));
	});
});
