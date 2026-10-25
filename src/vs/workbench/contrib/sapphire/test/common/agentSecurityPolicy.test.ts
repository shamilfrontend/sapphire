/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import {
  assertNotSecretToolUri,
  assertUriInsideWorkspace,
  buildMcpStdioEnv,
  capEntireFileCodeForStorage,
  CHECKPOINT_SNAPSHOT_MAX_CHARS,
  isUriInsideWorkspaceFolders,
  looksLikeSecretMemoryContent,
} from '../../common/agentSecurityPolicy.js';

suite('agentSecurityPolicy', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  const ws = URI.file('/proj');
  const inside = URI.file('/proj/src/a.ts');
  const outside = URI.file('/etc/passwd');
  const envFile = URI.file('/proj/.env');

  test('isUriInsideWorkspaceFolders', () => {
    assert.strictEqual(isUriInsideWorkspaceFolders(inside, [ws]), true);
    assert.strictEqual(isUriInsideWorkspaceFolders(outside, [ws]), false);
    assert.strictEqual(isUriInsideWorkspaceFolders(inside, []), false);
  });

  test('assertUriInsideWorkspace denies outside unless elevated', () => {
    assert.doesNotThrow(() => assertUriInsideWorkspace(inside, [ws], false));
    assert.throws(() => assertUriInsideWorkspace(outside, [ws], false));
    assert.doesNotThrow(() => assertUriInsideWorkspace(outside, [ws], true));
  });

  test('assertNotSecretToolUri blocks .env inside workspace', () => {
    assert.doesNotThrow(() => assertNotSecretToolUri(inside, [ws]));
    assert.throws(() => assertNotSecretToolUri(envFile, [ws]));
  });

  test('buildMcpStdioEnv allowlists host env and merges server env', () => {
    const env = buildMcpStdioEnv(
      { CUSTOM: '1', PATH: '/custom' },
      { PATH: '/usr/bin', HOME: '/home/u', SECRET_TOKEN: 'leak', API_KEY: 'x' },
    );
    assert.strictEqual(env.PATH, '/custom');
    assert.strictEqual(env.HOME, '/home/u');
    assert.strictEqual(env.CUSTOM, '1');
    assert.strictEqual(env.SECRET_TOKEN, undefined);
    assert.strictEqual(env.API_KEY, undefined);
  });

  test('capEntireFileCodeForStorage trims large snapshots', () => {
    const big = 'x'.repeat(CHECKPOINT_SNAPSHOT_MAX_CHARS + 10);
    assert.strictEqual(capEntireFileCodeForStorage(big).length, CHECKPOINT_SNAPSHOT_MAX_CHARS);
    assert.strictEqual(capEntireFileCodeForStorage('ok'), 'ok');
  });

  test('looksLikeSecretMemoryContent', () => {
    assert.strictEqual(looksLikeSecretMemoryContent('theme', 'dark'), false);
    assert.strictEqual(looksLikeSecretMemoryContent('api_key', 'abc'), true);
    assert.strictEqual(looksLikeSecretMemoryContent('note', 'sk-abcdefghijklmnop'), true);
  });
});
