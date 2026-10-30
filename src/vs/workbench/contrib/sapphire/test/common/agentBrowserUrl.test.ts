/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { assertAgentBrowserUrl } from '../../common/agentBrowserUrl.js';

suite('agentBrowserUrl', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('allows public https and localhost', () => {
		assert.strictEqual(assertAgentBrowserUrl('https://example.com/docs'), 'https://example.com/docs');
		assert.strictEqual(assertAgentBrowserUrl('http://localhost:3000/app'), 'http://localhost:3000/app');
		assert.strictEqual(assertAgentBrowserUrl('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/');
	});

	test('rejects private networks, file urls, and credentials', () => {
		assert.throws(() => assertAgentBrowserUrl('http://192.168.1.10/'), /private/);
		assert.throws(() => assertAgentBrowserUrl('http://10.0.0.5/'), /private/);
		assert.throws(() => assertAgentBrowserUrl('file:///tmp/index.html'), /http/);
		assert.throws(() => assertAgentBrowserUrl('https://user:secret@example.com/'), /credentials/);
	});
});
