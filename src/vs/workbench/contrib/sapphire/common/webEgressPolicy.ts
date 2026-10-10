/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Бросает, если URL не безопасный публичный http(s) (защита от SSRF). */
export function assertPublicHttpUrl(urlStr: string): URL {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed, got ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    throw new Error(`Browsing localhost / loopback is not allowed: ${host}`);
  }
  // IPv4: private / link-local / CGNAT
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
      throw new Error(`Browsing private / link-local addresses is not allowed: ${host}`);
    }
  }
  // IPv6: unique local / link-local
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    throw new Error(`Browsing private IPv6 addresses is not allowed: ${host}`);
  }
  return url;
}
