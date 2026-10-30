/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** http(s), включая localhost. Прочие private/link-local адреса запрещены. */
export function assertAgentBrowserUrl(raw: string): string {
	const trimmed = raw.trim();
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error('browser_navigate: URL is invalid');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('browser_navigate: only http and https URLs are allowed');
	}
	if (parsed.username || parsed.password) {
		throw new Error('browser_navigate: URLs with embedded credentials are not allowed');
	}
	const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (!host) {
		throw new Error('browser_navigate: URL has no host');
	}
	if (isLoopbackHost(host)) {
		return parsed.href;
	}
	if (isBlockedHost(host)) {
		throw new Error('browser_navigate: private and link-local addresses are not allowed (localhost is allowed)');
	}
	return parsed.href;
}

function isLoopbackHost(host: string): boolean {
	return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isBlockedHost(host: string): boolean {
	if (host === '0.0.0.0' || host === '::' || host.endsWith('.local') || host.endsWith('.internal')) {
		return true;
	}
	if (host.includes(':')) {
		const lower = host.toLowerCase();
		return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
	}
	const parts = host.split('.').map(part => Number(part));
	if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
		return false;
	}
	const [a, b] = parts;
	if (a === 10 || a === 127 || a === 0) {
		return true;
	}
	if (a === 169 && b === 254) {
		return true;
	}
	if (a === 192 && b === 168) {
		return true;
	}
	if (a === 172 && b >= 16 && b <= 31) {
		return true;
	}
	return false;
}
