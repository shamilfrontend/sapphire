/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildNextEditPrompt, nextEditApplies, parseNextEditResponse } from '../../browser/autocomplete/nextEditSuggest.js';

suite('nextEditSuggest', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses a line edit away from the cursor', () => {
		const edit = parseNextEditResponse('LINE 12\nOLD const x = 1\nNEW const x = 2\n', 4, 20);
		assert.deepStrictEqual(edit, { lineNumber: 12, oldText: 'const x = 1', newText: 'const x = 2' });
		assert.strictEqual(nextEditApplies('const x = 1', 4, edit!), true);
		assert.strictEqual(nextEditApplies('const x = 9', 4, edit!), false);
	});

	test('rejects none, the cursor line, and identical text', () => {
		assert.strictEqual(parseNextEditResponse('NONE', 4, 20), undefined);
		assert.strictEqual(parseNextEditResponse('LINE 4\nOLD a\nNEW b\n', 4, 20), undefined);
		assert.strictEqual(parseNextEditResponse('LINE 5\nOLD a\nNEW b\n', 4, 20), undefined);
		assert.strictEqual(parseNextEditResponse('LINE 10\nOLD same\nNEW same\n', 4, 20), undefined);
	});

	test('prompt numbers the excerpt', () => {
		const prompt = buildNextEditPrompt(['alpha', 'beta', 'gamma'], 2, 'beta');
		assert.ok(prompt.includes('1|alpha'));
		assert.ok(prompt.includes('2|beta'));
		assert.ok(prompt.includes('Cursor line: 2'));
	});
});
