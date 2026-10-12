/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { URI } from '../../../../../base/common/uri.js';
import { MAX_TOOL_ABSOLUTE_TIME } from '../../common/prompt/prompts.js';
import { computeDirectoryTree1Deep } from '../../common/directoryStrService.js';

suite('directoryStr cancel', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('MAX_TOOL_ABSOLUTE_TIME is 60s for folder selection race', () => {
    assert.strictEqual(MAX_TOOL_ABSOLUTE_TIME, 60);
  });

  test('computeDirectoryTree1Deep rejects when token is already cancelled', async () => {
    const cts = new CancellationTokenSource();
    cts.cancel();
    const fakeFileService = {
      resolve: async () => {
        throw new Error('resolve should not run after cancel');
      },
    } as any;

    let caught: unknown;
    try {
      await computeDirectoryTree1Deep(
        fakeFileService,
        URI.file('/tmp/example'),
        1,
        cts.token,
      );
    } catch (e) {
      caught = e;
    } finally {
      cts.dispose();
    }
    assert.ok(isCancellationError(caught));
  });
});
