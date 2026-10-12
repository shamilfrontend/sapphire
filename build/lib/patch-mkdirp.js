/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

/**
 * vinyl-fs (gulp.dest) creates directories via fs-mkdirp-stream, which does
 * mkdir then immediately stat. Under concurrent writes that race can yield
 * ENOENT on the just-created path and abort the whole compile stream.
 *
 * Wrap the cached mkdirp export so ENOENT from that race is retried.
 * Must be required before gulp / vinyl-fs load.
 */
const MAX_RETRIES = 5;

function patchMkdirp() {
	const mkdirpPath = require.resolve('fs-mkdirp-stream/mkdirp');
	const original = require(mkdirpPath);

	if (original.__pprMkdirpPatched) {
		return;
	}

	function mkdirpWithRetry(dirpath, customMode, callback) {
		if (typeof customMode === 'function') {
			callback = customMode;
			customMode = undefined;
		}

		let attempt = 0;

		function run() {
			original(dirpath, customMode, (err) => {
				if (err && err.code === 'ENOENT' && attempt < MAX_RETRIES) {
					attempt++;
					return setImmediate(run);
				}
				callback(err);
			});
		}

		run();
	}

	mkdirpWithRetry.__pprMkdirpPatched = true;
	require.cache[mkdirpPath].exports = mkdirpWithRetry;
}

patchMkdirp();
