/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  parseDuckDuckGoHtml,
  wrapUntrustedContent,
} from '../../common/webSearchParse.js';
import {
  assertMcpServerHttpUrl,
  assertPublicHttpUrl,
  assertPublicHttpUrlAfterResolve,
  isBlockedEgressIp,
} from '../../common/webEgressPolicy.js';

suite('webSearchParse', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('parses classic DuckDuckGo result blocks', () => {
    const html = `
      <a class="result__a" href="https://example.com/a">Example &amp; Co</a>
      <a class="result__snippet">Hello <b>world</b></a>
      <a class="result__a" href="https://example.com/b">Second</a>
      <div class="result__snippet">More text</div>
    `;
    const hits = parseDuckDuckGoHtml(html, 10);
    assert.strictEqual(hits.length, 2);
    assert.strictEqual(hits[0].url, 'https://example.com/a');
    assert.strictEqual(hits[0].title, 'Example & Co');
    assert.ok(hits[0].snippet.includes('Hello'));
  });

  test('falls back to uddg redirect links', () => {
    const html = `<a href="/l/?uddg=${encodeURIComponent('https://docs.example.com/x')}">x</a>`;
    const hits = parseDuckDuckGoHtml(html, 5);
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].url, 'https://docs.example.com/x');
  });

  test('wrapUntrustedContent fences the body', () => {
    const out = wrapUntrustedContent('WEB_SEARCH', 'do evil');
    assert.ok(out.includes('BEGIN_UNTRUSTED_WEB_SEARCH'));
    assert.ok(out.includes('END_UNTRUSTED_WEB_SEARCH'));
    assert.ok(out.includes('do evil'));
  });
});

suite('webEgressPolicy', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('allows public https', () => {
    const url = assertPublicHttpUrl('https://example.com/path');
    assert.strictEqual(url.hostname, 'example.com');
  });

  test('blocks localhost and private ranges', () => {
    assert.throws(() => assertPublicHttpUrl('http://localhost/x'));
    assert.throws(() => assertPublicHttpUrl('http://127.0.0.1/x'));
    assert.throws(() => assertPublicHttpUrl('http://192.168.1.1/x'));
    assert.throws(() => assertPublicHttpUrl('http://10.0.0.5/x'));
    assert.throws(() => assertPublicHttpUrl('ftp://example.com/x'));
    assert.throws(() => assertPublicHttpUrl('http://169.254.169.254/latest'));
    assert.throws(() => assertPublicHttpUrl('http://[::ffff:127.0.0.1]/x'));
  });

  test('assertMcpServerHttpUrl allows loopback but blocks metadata', () => {
    assert.strictEqual(assertMcpServerHttpUrl('http://127.0.0.1:3845/mcp').port, '3845');
    assert.throws(() => assertMcpServerHttpUrl('http://169.254.169.254/latest'));
    assert.throws(() => assertMcpServerHttpUrl('http://metadata.google.internal/'));
    assert.throws(() => assertMcpServerHttpUrl('ftp://example.com/'));
  });

  test('blocks decimal IPv4 loopback literal', () => {
    assert.strictEqual(isBlockedEgressIp('2130706433'), true);
    assert.throws(() => assertPublicHttpUrl('http://2130706433/'));
  });

  test('assertPublicHttpUrlAfterResolve blocks private resolved IPs', async () => {
    await assert.rejects(
      () =>
        assertPublicHttpUrlAfterResolve('https://evil.example', async () => ['10.0.0.1']),
      /resolves to private/,
    );
    const ok = await assertPublicHttpUrlAfterResolve('https://ok.example', async () => [
      '93.184.216.34',
    ]);
    assert.strictEqual(ok.hostname, 'ok.example');
  });
});
