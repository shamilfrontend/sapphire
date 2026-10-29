/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { MAX_TOOL_ABSOLUTE_TIME } from '../../common/prompt/prompts.js';
import { computeDirectoryTree1Deep } from '../../common/directoryStrService.js';

function asFileService(partial: Partial<IFileService>): IFileService {
  return partial as IFileService;
}

suite('directoryStr cancel', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('MAX_TOOL_ABSOLUTE_TIME is 60s for folder selection race', () => {
    assert.strictEqual(MAX_TOOL_ABSOLUTE_TIME, 60);
  });

  test('computeDirectoryTree1Deep rejects when token is already cancelled', async () => {
    const cts = new CancellationTokenSource();
    cts.cancel();
    const fakeFileService = asFileService({
      resolve: async () => {
        throw new Error('resolve should not run after cancel');
      },
    });

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
