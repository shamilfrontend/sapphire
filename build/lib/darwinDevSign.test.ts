/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { hasStableDevSignature } from './darwinDevSign.ts';

suite('darwin dev ad-hoc signature', () => {
	test('linker-signed bundle must be signed once', () => {
		const output = [
			'CodeDirectory v=20400 size=392 flags=0x20002(adhoc,linker-signed) hashes=9+0 location=embedded',
			'Signature=adhoc',
			'Info.plist=not bound',
			'TeamIdentifier=not set',
		].join('\n');
		assert.strictEqual(hasStableDevSignature(output), false);
	});

	test('stable ad-hoc signature is left alone', () => {
		const output = [
			'CodeDirectory v=20500 size=1234 flags=0x2(adhoc) hashes=9+3 location=embedded',
			'Signature=adhoc',
			'Info.plist entries=22',
			'TeamIdentifier=not set',
			'Sealed Resources version=2 rules=13 files=100',
		].join('\n');
		assert.strictEqual(hasStableDevSignature(output), true);
	});

	test('Developer ID signature is left alone', () => {
		const output = [
			'Signature size=9000',
			'Authority=Developer ID Application: Example',
			'Info.plist entries=22',
			'TeamIdentifier=ABCDE12345',
		].join('\n');
		assert.strictEqual(hasStableDevSignature(output), true);
	});

	test('unsigned bundle must be signed', () => {
		assert.strictEqual(hasStableDevSignature('Sapphire.app: code object is not signed at all\n'), false);
	});
});
