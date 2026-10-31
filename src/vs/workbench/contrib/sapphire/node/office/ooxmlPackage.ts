/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Readable } from 'stream';
import type { Entry, ZipFile } from 'yauzl';
import { ZipFile as YazlZip } from 'yazl';

const UNCOMPRESSED_CAP = 80 * 1024 * 1024;

function streamToBuffer(stream: Readable): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on('data', (chunk: Buffer) => chunks.push(chunk));
		stream.on('end', () => resolve(Buffer.concat(chunks)));
		stream.on('error', reject);
	});
}

/** Все части пакета, включая картинки и vba. Каталоги пропускаются. */
export function readZipEntries(bytes: Buffer): Promise<Map<string, Buffer>> {
	return import('yauzl').then((yauzl) => new Promise((resolve, reject) => {
		yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, opened) => {
			if (err || !opened) {
				reject(err ?? new Error('Could not open zip'));
				return;
			}
			const zipfile: ZipFile = opened;
			const entries = new Map<string, Buffer>();
			let uncompressed = 0;
			const fail = (error: unknown) => {
				zipfile.close();
				reject(error instanceof Error ? error : new Error(String(error)));
			};
			zipfile.on('error', fail);
			zipfile.on('end', () => resolve(entries));
			zipfile.on('entry', (entry: Entry) => {
				const name = entry.fileName.replace(/\\/g, '/').replace(/^\/+/, '');
				if (!name || name.endsWith('/')) {
					zipfile.readEntry();
					return;
				}
				uncompressed += entry.uncompressedSize;
				if (uncompressed > UNCOMPRESSED_CAP) {
					fail(new Error('Uncompressed office package exceeds 80 MB'));
					return;
				}
				zipfile.openReadStream(entry, (streamErr, stream) => {
					if (streamErr || !stream) {
						fail(streamErr ?? new Error('Could not read zip entry'));
						return;
					}
					streamToBuffer(stream).then((buf) => {
						entries.set(name, buf);
						zipfile.readEntry();
					}, fail);
				});
			});
			zipfile.readEntry();
		});
	}));
}

export function writeZipEntries(entries: Map<string, Buffer>): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const zip = new YazlZip();
		const chunks: Buffer[] = [];
		for (const [name, content] of entries) {
			zip.addBuffer(content, name);
		}
		zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
		zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
		zip.outputStream.on('error', reject);
		zip.end();
	});
}

export function xmlText(bytes: Buffer | undefined): string {
	if (!bytes) {
		return '';
	}
	return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

export function decodeXml(value: string): string {
	return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (ent) => {
		switch (ent) {
			case '&amp;':
				return '&';
			case '&lt;':
				return '<';
			case '&gt;':
				return '>';
			case '&quot;':
				return '"';
			case '&apos;':
				return '\'';
			default: {
				const hex = ent.startsWith('&#x');
				const num = parseInt(ent.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
				return Number.isFinite(num) ? String.fromCodePoint(num) : ent;
			}
		}
	});
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

export function attr(tag: string, name: string): string | undefined {
	const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
	return match?.[1];
}

export function colIndex(cellRef: string): number {
	const letters = /^([A-Z]+)/.exec(cellRef)?.[1];
	if (!letters) {
		return 1;
	}
	let n = 0;
	for (const ch of letters) {
		n = n * 26 + (ch.charCodeAt(0) - 64);
	}
	return n;
}

export function relsOwner(relsPath: string): string {
	return relsPath.replace(/\/_rels\/([^/]+)\.rels$/, '/$1');
}

export function joinZip(baseFile: string, target: string): string {
	if (target.startsWith('/')) {
		return target.replace(/^\/+/, '');
	}
	const parts = baseFile.split('/').slice(0, -1);
	for (const part of target.split('/')) {
		if (part === '..') {
			parts.pop();
		} else if (part && part !== '.') {
			parts.push(part);
		}
	}
	return parts.join('/');
}
