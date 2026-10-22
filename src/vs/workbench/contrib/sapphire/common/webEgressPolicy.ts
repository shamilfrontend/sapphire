/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

function parseHttpUrl(urlStr: string): URL {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed, got ${url.protocol}`);
  }
  return url;
}

function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  );
}

function isCloudMetadataHost(host: string): boolean {
  return (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host.endsWith('.metadata.google.internal')
  );
}

/** IPv4 private / link-local / CGNAT / loopback (dotted decimal). */
export function isPrivateOrLinkLocalIPv4(host: string): boolean {
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) {
    return false;
  }
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** IPv6 ULA / link-local (hostname без скобок, только если есть ':'). */
export function isPrivateIPv6Host(host: string): boolean {
  if (!host.includes(':')) {
    return false;
  }
  const h = host.toLowerCase();
  return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
}

/** Decimal / octal IPv4 literals (e.g. 2130706433 → 127.0.0.1). */
function decodeNonDottedIPv4Literal(host: string): string | null {
  if (!/^\d+$/.test(host)) {
    return null;
  }
  // octal if leading 0 and only 0-7
  let n: number;
  if (/^0[0-7]+$/.test(host)) {
    n = Number.parseInt(host, 8);
  } else {
    n = Number.parseInt(host, 10);
  }
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) {
    return null;
  }
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

/** True if address string is blocked for public egress (IPv4/IPv6/mapped). */
export function isBlockedEgressIp(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHost(host) || isCloudMetadataHost(host)) {
    return true;
  }
  const decoded = decodeNonDottedIPv4Literal(host);
  if (decoded && isPrivateOrLinkLocalIPv4(decoded)) {
    return true;
  }
  if (isPrivateOrLinkLocalIPv4(host) || isPrivateIPv6Host(host)) {
    return true;
  }
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped && isPrivateOrLinkLocalIPv4(mapped[1])) {
    return true;
  }
  return false;
}

/** Бросает, если URL не безопасный публичный http(s) (защита от SSRF для browse/web). */
export function assertPublicHttpUrl(urlStr: string): URL {
  const url = parseHttpUrl(urlStr);
  const host = url.hostname.toLowerCase();
  if (isBlockedEgressIp(host)) {
    throw new Error(`Browsing private / link-local / metadata addresses is not allowed: ${host}`);
  }
  // Hostname that is not an IP literal still needs DNS resolve (see assertPublicHttpUrlAfterResolve).
  if (isLoopbackHost(host) || isCloudMetadataHost(host)) {
    throw new Error(`Browsing localhost / loopback is not allowed: ${host}`);
  }
  return url;
}

export type DnsLookupFn = (hostname: string) => Promise<string[]>;

/**
 * Hostname blocklist + DNS resolve: любой resolved IP в private/metadata → throw.
 * `lookup` injectable (main process dns.promises.lookup).
 */
export async function assertPublicHttpUrlAfterResolve(
  urlStr: string,
  lookup: DnsLookupFn,
): Promise<URL> {
  const url = assertPublicHttpUrl(urlStr);
  const host = url.hostname;
  // Уже IP literal — resolve не нужен
  if (
    isPrivateOrLinkLocalIPv4(host) ||
    isPrivateIPv6Host(host) ||
    decodeNonDottedIPv4Literal(host) ||
    /^::ffff:/i.test(host)
  ) {
    if (isBlockedEgressIp(host)) {
      throw new Error(`Browsing private / link-local addresses is not allowed: ${host}`);
    }
    return url;
  }
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch (e) {
    throw new Error(
      `Could not resolve host for egress check: ${host} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!addresses.length) {
    throw new Error(`Could not resolve host for egress check: ${host}`);
  }
  for (const addr of addresses) {
    if (isBlockedEgressIp(addr)) {
      throw new Error(
        `Browsing blocked: ${host} resolves to private / link-local / metadata address ${addr}`,
      );
    }
  }
  return url;
}

/**
 * MCP HTTP/SSE: пользователь явно указал URL в mcp.json.
 * Разрешаем loopback/private LAN, блокируем cloud metadata и non-http(s).
 */
export function assertMcpServerHttpUrl(urlStr: string): URL {
  const url = parseHttpUrl(urlStr);
  const host = url.hostname.toLowerCase();
  if (isCloudMetadataHost(host)) {
    throw new Error(`MCP HTTP to cloud metadata hosts is not allowed: ${host}`);
  }
  if (isPrivateOrLinkLocalIPv4(host) && host.startsWith('169.254.')) {
    throw new Error(`MCP HTTP to link-local metadata is not allowed: ${host}`);
  }
  return url;
}
