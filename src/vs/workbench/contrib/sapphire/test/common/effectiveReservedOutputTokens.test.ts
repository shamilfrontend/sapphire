/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { effectiveReservedOutputTokens } from '../../common/modelCapabilities.js';

suite('effectiveReservedOutputTokens', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('uses the model reserve (glm-5.3-flash)', () => {
    assert.strictEqual(effectiveReservedOutputTokens(128_000, 16_384), 16_384);
  });

  test('caps the reserve to the context window', () => {
    assert.strictEqual(effectiveReservedOutputTokens(8_000, 16_384), 8_000);
  });

  test('defaults a missing reserve to 4096', () => {
    assert.strictEqual(effectiveReservedOutputTokens(32_000, null), 4_096);
    assert.strictEqual(effectiveReservedOutputTokens(32_000, undefined), 4_096);
  });
});
