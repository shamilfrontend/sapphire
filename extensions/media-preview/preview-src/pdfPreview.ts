/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface PdfPreviewSettings {
	readonly src: string | null;
	readonly isGitLfs: boolean;
	readonly pdfJs: string;
	readonly pdfWorker: string;
}

type ExtensionToWebviewMessage =
	| { readonly type: 'zoomIn' }
	| { readonly type: 'zoomOut' }
	| { readonly type: 'prevPage' }
	| { readonly type: 'nextPage' }
	| { readonly type: 'setScale'; readonly scale: number };

type WebviewToExtensionMessage =
	| { readonly type: 'page'; readonly page: number; readonly pageCount: number }
	| { readonly type: 'zoom'; readonly scale: number }
	| { readonly type: 'reopen-as-text' };

interface VsCodeApi {
	postMessage(message: WebviewToExtensionMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface PdfPageViewport {
	readonly height: number;
	readonly width: number;
}

interface PdfPage {
	getViewport(params: { scale: number }): PdfPageViewport;
	render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfPageViewport }): { promise: Promise<void>; cancel(): void };
}

interface PdfDocument {
	readonly numPages: number;
	getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfjsModule {
	GlobalWorkerOptions: { workerSrc: string };
	getDocument(params: {
		data: Uint8Array;
		verbosity: number;
		isEvalSupported: boolean;
		disableRange: boolean;
		disableStream: boolean;
		disableFontFace: boolean;
	}): { promise: Promise<PdfDocument> };
}

interface PdfWorkerModule {
	WorkerMessageHandler: unknown;
}

const vscode = acquireVsCodeApi();

function getSettings(): PdfPreviewSettings {
	const element = document.getElementById('settings');
	if (element) {
		const data = element.getAttribute('data-settings');
		if (data) {
			return JSON.parse(data) as PdfPreviewSettings;
		}
	}
	throw new Error('Could not load settings');
}

function requireElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing element #${id}`);
	}
	return element as T;
}

const settings = getSettings();
const canvas = requireElement<HTMLCanvasElement>('page');
const pageLabel = requireElement<HTMLElement>('page-label');
const prevButton = requireElement<HTMLButtonElement>('prev');
const nextButton = requireElement<HTMLButtonElement>('next');
const zoomInButton = requireElement<HTMLButtonElement>('zoom-in');
const zoomOutButton = requireElement<HTMLButtonElement>('zoom-out');

let pdfDoc: PdfDocument | null = null;
let pageNum = 1;
let scale = 1;
let renderTask: { promise: Promise<void>; cancel(): void } | null = null;

function postState(): void {
	vscode.postMessage({
		type: 'page',
		page: pageNum,
		pageCount: pdfDoc ? pdfDoc.numPages : 1,
	});
	vscode.postMessage({
		type: 'zoom',
		scale,
	});
	pageLabel.textContent = `${pageNum} / ${pdfDoc ? pdfDoc.numPages : 1}`;
}

async function renderPage(): Promise<void> {
	if (!pdfDoc) {
		return;
	}
	const page = await pdfDoc.getPage(pageNum);
	const viewport = page.getViewport({ scale });
	const context = canvas.getContext('2d');
	if (!context) {
		return;
	}
	canvas.height = viewport.height;
	canvas.width = viewport.width;
	if (renderTask) {
		try {
			renderTask.cancel();
		} catch {
			// ignore
		}
	}
	renderTask = page.render({ canvasContext: context, viewport });
	await renderTask.promise;
	postState();
}

async function loadPdf(): Promise<void> {
	if (settings.isGitLfs) {
		document.body.classList.add('git-lfs');
		document.body.classList.remove('loading');
		return;
	}
	if (!settings.src) {
		document.body.classList.add('error');
		document.body.classList.remove('loading');
		return;
	}

	try {
		// PDF.js is loaded from a runtime webview URI, so a static import is not possible.
		// The page and the worker file are different origins, so a module Worker stalls
		// until a long fallback. Parsing on this thread avoids that.
		const [pdfjs, workerModule, bytes] = await Promise.all([
			// eslint-disable-next-line no-restricted-syntax
			import(settings.pdfJs) as Promise<PdfjsModule>,
			// eslint-disable-next-line no-restricted-syntax
			import(settings.pdfWorker) as Promise<PdfWorkerModule>,
			fetch(settings.src).then(async (response) => {
				if (!response.ok) {
					throw new Error(`Failed to fetch PDF (${response.status})`);
				}
				return response.arrayBuffer();
			}),
		]);
		(globalThis as { pdfjsWorker?: { WorkerMessageHandler: unknown } }).pdfjsWorker = {
			WorkerMessageHandler: workerModule.WorkerMessageHandler,
		};
		pdfDoc = await pdfjs.getDocument({
			data: new Uint8Array(bytes),
			verbosity: 0,
			isEvalSupported: false,
			disableRange: true,
			disableStream: true,
			disableFontFace: true,
		}).promise;
		pageNum = 1;
		document.body.classList.remove('loading');
		document.body.classList.add('ready');
		await renderPage();
	} catch (e) {
		console.error(e);
		document.body.classList.add('error');
		document.body.classList.remove('loading');
	}
}

prevButton.addEventListener('click', async () => {
	if (!pdfDoc || pageNum <= 1) {
		return;
	}
	pageNum -= 1;
	await renderPage();
});

nextButton.addEventListener('click', async () => {
	if (!pdfDoc || pageNum >= pdfDoc.numPages) {
		return;
	}
	pageNum += 1;
	await renderPage();
});

zoomInButton.addEventListener('click', async () => {
	scale = Math.min(3, Math.round((scale + 0.1) * 10) / 10);
	await renderPage();
});

zoomOutButton.addEventListener('click', async () => {
	scale = Math.max(0.5, Math.round((scale - 0.1) * 10) / 10);
	await renderPage();
});

window.addEventListener('message', async (event) => {
	const message = event.data as ExtensionToWebviewMessage;
	switch (message.type) {
		case 'zoomIn':
			scale = Math.min(3, Math.round((scale + 0.1) * 10) / 10);
			await renderPage();
			break;
		case 'zoomOut':
			scale = Math.max(0.5, Math.round((scale - 0.1) * 10) / 10);
			await renderPage();
			break;
		case 'prevPage':
			if (pdfDoc && pageNum > 1) {
				pageNum -= 1;
				await renderPage();
			}
			break;
		case 'nextPage':
			if (pdfDoc && pageNum < pdfDoc.numPages) {
				pageNum += 1;
				await renderPage();
			}
			break;
		case 'setScale':
			scale = message.scale;
			await renderPage();
			break;
	}
});

document.querySelectorAll('.open-file-link').forEach((link) => {
	link.addEventListener('click', (e) => {
		e.preventDefault();
		vscode.postMessage({ type: 'reopen-as-text' });
	});
});

loadPdf();
