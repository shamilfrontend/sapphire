/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** Сколько страниц скана распознаём за один разбор. */
export const PDF_OCR_MAX_PAGES = 10;

export const PDF_OCR_TAIL_NOTE = 'Further pages were not recognized.';

export type RecognizeScan = (pages: readonly (Uint8Array | null)[]) => Promise<readonly string[]>;

type PdfImageStore = {
	has(id: string): boolean;
	get(id: string): unknown;
	get(id: string, callback: (obj: unknown) => void): void;
};

type PdfOperatorList = {
	fnArray: number[];
	argsArray: unknown[][];
};

export type OcrPdfPage = {
	getOperatorList(): Promise<PdfOperatorList>;
	objs: PdfImageStore;
	commonObjs: PdfImageStore;
};

export type OcrPdfDocument = {
	numPages: number;
	getPage(n: number): Promise<OcrPdfPage>;
};

export type PdfJsOps = {
	dependency: number;
	paintImageMaskXObject: number;
	paintImageXObject: number;
	paintInlineImageXObject: number;
};

type RawImage = {
	width: number;
	height: number;
	data: Uint8Array;
	kind?: number;
};

type PngImage = {
	data: Buffer;
	width: number;
	height: number;
};

type PngCtor = new (opts: { width: number; height: number }) => PngImage;

type PngApi = PngCtor & {
	sync: { write(png: PngImage): Buffer };
};

type TessWorker = {
	recognize(image: Buffer): Promise<{ data: { text?: string } }>;
};

type CreateWorker = (
	langs: string,
	oem: number,
	options: {
		langPath: string;
		cachePath: string;
		cacheMethod: string;
		gzip: boolean;
		workerBlobURL: boolean;
		logger: () => void;
	},
) => Promise<TessWorker>;

let pngApi: PngApi | undefined;
let workerPromise: Promise<TessWorker> | undefined;

async function loadPng(): Promise<PngApi> {
	if (pngApi) {
		return pngApi;
	}
	const specifier: string = 'pngjs';
	const mod = (await import(specifier)) as { PNG?: PngApi; default?: { PNG?: PngApi } };
	const PNG = mod.PNG ?? mod.default?.PNG;
	if (!PNG?.sync?.write) {
		throw new Error('pngjs PNG export is missing.');
	}
	pngApi = PNG;
	return PNG;
}

async function hasTessdata(dir: string): Promise<boolean> {
	try {
		await fs.access(join(dir, 'eng.traineddata'));
		await fs.access(join(dir, 'rus.traineddata'));
		return true;
	} catch {
		return false;
	}
}

async function tessdataDir(): Promise<string> {
	const here = dirname(fileURLToPath(import.meta.url));
	let dir = here;
	for (let i = 0; i < 12; i++) {
		const beside = join(dir, 'tessdata');
		const fromRepo = join(dir, 'src', 'vs', 'workbench', 'contrib', 'sapphire', 'node', 'office', 'tessdata');
		if (await hasTessdata(beside)) {
			return beside;
		}
		if (await hasTessdata(fromRepo)) {
			return fromRepo;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	throw new Error('Tesseract language data (eng, rus) was not found.');
}

async function createTessWorker(): Promise<TessWorker> {
	const specifier: string = 'tesseract.js';
	const mod = (await import(specifier)) as {
		createWorker?: CreateWorker;
		default?: { createWorker?: CreateWorker };
	};
	const createWorker = mod.createWorker ?? mod.default?.createWorker;
	if (!createWorker) {
		throw new Error('tesseract.js createWorker export is missing.');
	}
	const dir = await tessdataDir();
	return createWorker('rus+eng', 1, {
		langPath: dir,
		cachePath: join(tmpdir(), 'sapphire-tesseract'),
		cacheMethod: 'readOnly',
		gzip: false,
		workerBlobURL: false,
		logger: () => { },
	});
}

function getWorker(): Promise<TessWorker> {
	if (!workerPromise) {
		workerPromise = createTessWorker().catch((err: unknown) => {
			workerPromise = undefined;
			throw err;
		});
	}
	return workerPromise;
}

function asRawImage(value: unknown): RawImage | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const img = value as { width?: unknown; height?: unknown; data?: unknown; kind?: unknown };
	const width = typeof img.width === 'number' ? img.width : 0;
	const height = typeof img.height === 'number' ? img.height : 0;
	const data = img.data;
	if (width < 2 || height < 2 || !data) {
		return undefined;
	}
	let bytes: Uint8Array | undefined;
	if (data instanceof Uint8Array) {
		bytes = data;
	} else if (ArrayBuffer.isView(data)) {
		const view = data as ArrayBufferView;
		bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	if (!bytes || bytes.length < 8) {
		return undefined;
	}
	return {
		width,
		height,
		data: bytes,
		kind: typeof img.kind === 'number' ? img.kind : undefined,
	};
}

function resolveStoreObject(store: PdfImageStore, id: string): Promise<unknown> {
	if (store.has(id)) {
		return Promise.resolve(store.get(id));
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(undefined), 2000);
		try {
			store.get(id, (obj) => {
				clearTimeout(timer);
				resolve(obj);
			});
		} catch {
			clearTimeout(timer);
			resolve(undefined);
		}
	});
}

function popcount(byte: number): number {
	let n = 0;
	let v = byte;
	while (v) {
		n += v & 1;
		v >>= 1;
	}
	return n;
}

/** Бит, которым закрашена бумага: на скане его большинство. */
function backgroundBit(data: Uint8Array): 0 | 1 {
	const step = Math.max(1, Math.floor(data.length / 4096));
	let ones = 0;
	let bits = 0;
	for (let i = 0; i < data.length; i += step) {
		ones += popcount(data[i]);
		bits += 8;
	}
	return ones * 2 >= bits ? 1 : 0;
}

async function writeRgbaPng(width: number, height: number, fill: (rgba: Buffer) => void): Promise<Uint8Array> {
	const PNG = await loadPng();
	const png = new PNG({ width, height });
	fill(png.data);
	return PNG.sync.write(png);
}

async function maskToPng(width: number, height: number, data: Uint8Array): Promise<Uint8Array | undefined> {
	const stride = Math.ceil(width / 8);
	if (data.length < stride * height) {
		return undefined;
	}
	const paper = backgroundBit(data);
	return writeRgbaPng(width, height, (rgba) => {
		let o = 0;
		for (let y = 0; y < height; y++) {
			const row = y * stride;
			for (let x = 0; x < width; x++) {
				const bit = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1;
				const color = bit === paper ? 255 : 0;
				rgba[o++] = color;
				rgba[o++] = color;
				rgba[o++] = color;
				rgba[o++] = 255;
			}
		}
	});
}

async function grayToPng(width: number, height: number, data: Uint8Array): Promise<Uint8Array | undefined> {
	if (data.length < width * height) {
		return undefined;
	}
	return writeRgbaPng(width, height, (rgba) => {
		let o = 0;
		for (let i = 0; i < width * height; i++) {
			const color = data[i];
			rgba[o++] = color;
			rgba[o++] = color;
			rgba[o++] = color;
			rgba[o++] = 255;
		}
	});
}

async function rgbToPng(width: number, height: number, data: Uint8Array, channels: 3 | 4): Promise<Uint8Array | undefined> {
	if (data.length < width * height * channels) {
		return undefined;
	}
	return writeRgbaPng(width, height, (rgba) => {
		let o = 0;
		let s = 0;
		for (let i = 0; i < width * height; i++) {
			rgba[o++] = data[s++];
			rgba[o++] = data[s++];
			rgba[o++] = data[s++];
			rgba[o++] = channels === 4 ? data[s++] : 255;
		}
	});
}

async function imageToPng(img: RawImage): Promise<Uint8Array | undefined> {
	const pixels = img.width * img.height;
	const stride = Math.ceil(img.width / 8);
	if (img.kind === 3 || img.data.length === pixels * 4) {
		return rgbToPng(img.width, img.height, img.data, 4);
	}
	if (img.kind === 2 || img.data.length === pixels * 3) {
		return rgbToPng(img.width, img.height, img.data, 3);
	}
	if (img.data.length === pixels) {
		return grayToPng(img.width, img.height, img.data);
	}
	if (img.data.length >= stride * img.height) {
		return maskToPng(img.width, img.height, img.data);
	}
	return undefined;
}

async function largestPagePng(page: OcrPdfPage, ops: PdfJsOps): Promise<Uint8Array | null> {
	const list = await page.getOperatorList();
	let depName: string | undefined;
	let best: RawImage | undefined;
	let bestArea = 0;
	for (let i = 0; i < list.fnArray.length; i++) {
		const fn = list.fnArray[i];
		const arg0 = list.argsArray[i]?.[0];
		if (fn === ops.dependency && typeof arg0 === 'string') {
			depName = arg0;
			continue;
		}
		const isPaint = fn === ops.paintImageMaskXObject
			|| fn === ops.paintImageXObject
			|| fn === ops.paintInlineImageXObject;
		if (!isPaint) {
			continue;
		}
		const named = typeof arg0 === 'string' ? arg0 : depName;
		let raw = asRawImage(arg0);
		const packedTooSmall = !raw || raw.data.length < raw.width;
		if (packedTooSmall && named) {
			raw = asRawImage(await resolveStoreObject(page.objs, named))
				?? asRawImage(await resolveStoreObject(page.commonObjs, named));
		}
		if (!raw) {
			continue;
		}
		const area = raw.width * raw.height;
		if (area > bestArea) {
			best = raw;
			bestArea = area;
		}
	}
	if (!best) {
		return null;
	}
	return (await imageToPng(best)) ?? null;
}

/** По одному PNG на страницу (самая крупная картинка). `null`, если страницу не из чего собрать. */
export async function collectPagePngs(
	doc: OcrPdfDocument,
	ops: PdfJsOps,
	maxPages: number = PDF_OCR_MAX_PAGES,
): Promise<(Uint8Array | null)[]> {
	const count = Math.min(doc.numPages, maxPages);
	const pages: (Uint8Array | null)[] = [];
	for (let i = 1; i <= count; i++) {
		const page = await doc.getPage(i);
		pages.push(await largestPagePng(page, ops));
	}
	return pages;
}

export async function recognizePngPages(pages: readonly (Uint8Array | null)[]): Promise<string[]> {
	const any = pages.some((page) => page && page.byteLength > 0);
	if (!any) {
		return pages.map(() => '');
	}
	const worker = await getWorker();
	const texts: string[] = [];
	for (const page of pages) {
		if (!page || page.byteLength === 0) {
			texts.push('');
			continue;
		}
		const result = await worker.recognize(Buffer.from(page));
		texts.push((result.data.text ?? '').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim());
	}
	return texts;
}
