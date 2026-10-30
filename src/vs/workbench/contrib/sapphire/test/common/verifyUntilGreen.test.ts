/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	shouldApplyVerifyUntilGreen,
	userRequestedVerifyUntilGreen,
	verifyUntilGreenPrompt,
} from '../../common/verifyUntilGreen.js';

suite('verifyUntilGreen', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detects /verify slash', () => {
		assert.strictEqual(userRequestedVerifyUntilGreen('/verify fix the build'), true);
		assert.strictEqual(userRequestedVerifyUntilGreen('please /verify this'), true);
		assert.strictEqual(userRequestedVerifyUntilGreen('path/verify/file'), false);
	});

	test('applies only in agent with setting or slash', () => {
		assert.strictEqual(shouldApplyVerifyUntilGreen('agent', true, ''), true);
		assert.strictEqual(shouldApplyVerifyUntilGreen('agent', false, '/verify'), true);
		assert.strictEqual(shouldApplyVerifyUntilGreen('agent', false, 'hello'), false);
		assert.strictEqual(shouldApplyVerifyUntilGreen('plan', true, '/verify'), false);
	});

	test('prompt mentions diagnostics and round limit', () => {
		const p = verifyUntilGreenPrompt(3);
		assert.ok(p.includes('get_diagnostics'));
		assert.ok(p.includes('3'));
	});
});
