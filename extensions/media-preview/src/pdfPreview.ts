/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BinarySizeStatusBarEntry } from './binarySizeStatusBarEntry';
import { MediaPreview, PreviewState, isGitLfsPointer, reopenAsText } from './mediaPreview';
import { PreviewStatusBarEntry } from './ownedStatusBarEntry';
import { escapeAttribute } from './util/dom';
import { generateUuid } from './util/uuid';


class PageStatusBarEntry extends PreviewStatusBarEntry {

	constructor() {
		super('status.pdfPreview.page', vscode.l10n.t("PDF Page"), vscode.StatusBarAlignment.Right, 102);
	}

	public show(owner: unknown, page: number, pageCount: number) {
		this.showItem(owner, `${page} / ${pageCount}`);
	}
}

class ZoomStatusBarEntry extends PreviewStatusBarEntry {

	constructor() {
		super('status.pdfPreview.zoom', vscode.l10n.t("PDF Zoom"), vscode.StatusBarAlignment.Right, 101);
	}

	public show(owner: unknown, scale: number) {
		this.showItem(owner, `${Math.round(scale * 100)}%`);
	}
}


class PdfPreviewProvider implements vscode.CustomReadonlyEditorProvider {

	public static readonly viewType = 'vscode.pdfPreview';

	private readonly _previews = new Set<PdfPreview>();
	private _activePreview: PdfPreview | undefined;

	constructor(
		private readonly extensionRoot: vscode.Uri,
		private readonly binarySizeStatusBarEntry: BinarySizeStatusBarEntry,
		private readonly pageStatusBarEntry: PageStatusBarEntry,
		private readonly zoomStatusBarEntry: ZoomStatusBarEntry,
	) { }

	public async openCustomDocument(uri: vscode.Uri) {
		return { uri, dispose: () => { } };
	}

	public async resolveCustomEditor(document: vscode.CustomDocument, webviewEditor: vscode.WebviewPanel): Promise<void> {
		const preview = new PdfPreview(this.extensionRoot, document.uri, webviewEditor, this.binarySizeStatusBarEntry, this.pageStatusBarEntry, this.zoomStatusBarEntry);
		this._previews.add(preview);
		this.setActivePreview(preview);

		webviewEditor.onDidDispose(() => { this._previews.delete(preview); });

		webviewEditor.onDidChangeViewState(() => {
			if (webviewEditor.active) {
				this.setActivePreview(preview);
			} else if (this._activePreview === preview && !webviewEditor.active) {
				this.setActivePreview(undefined);
			}
		});
	}

	public get activePreview() {
		return this._activePreview;
	}

	private setActivePreview(value: PdfPreview | undefined): void {
		this._activePreview = value;
	}
}


class PdfPreview extends MediaPreview {

	private _page = 1;
	private _pageCount = 1;
	private _scale = 1;

	constructor(
		private readonly extensionRoot: vscode.Uri,
		resource: vscode.Uri,
		webviewEditor: vscode.WebviewPanel,
		binarySizeStatusBarEntry: BinarySizeStatusBarEntry,
		private readonly pageStatusBarEntry: PageStatusBarEntry,
		private readonly zoomStatusBarEntry: ZoomStatusBarEntry,
	) {
		super(extensionRoot, resource, webviewEditor, binarySizeStatusBarEntry);

		this._register(webviewEditor.webview.onDidReceiveMessage(message => {
			switch (message.type) {
				case 'page': {
					this._page = message.page;
					this._pageCount = message.pageCount;
					this.updateState();
					break;
				}
				case 'zoom': {
					this._scale = message.scale;
					this.updateState();
					break;
				}
				case 'reopen-as-text': {
					reopenAsText(resource, webviewEditor.viewColumn);
					break;
				}
			}
		}));

		this.updateBinarySize();
		this.render();
		this.updateState();
	}

	public override dispose(): void {
		super.dispose();
		this.pageStatusBarEntry.hide(this);
		this.zoomStatusBarEntry.hide(this);
	}

	public zoomIn() {
		if (this.previewState === PreviewState.Active) {
			this._webviewEditor.webview.postMessage({ type: 'zoomIn' });
		}
	}

	public zoomOut() {
		if (this.previewState === PreviewState.Active) {
			this._webviewEditor.webview.postMessage({ type: 'zoomOut' });
		}
	}

	public prevPage() {
		if (this.previewState === PreviewState.Active) {
			this._webviewEditor.webview.postMessage({ type: 'prevPage' });
		}
	}

	public nextPage() {
		if (this.previewState === PreviewState.Active) {
			this._webviewEditor.webview.postMessage({ type: 'nextPage' });
		}
	}

	protected override updateState() {
		super.updateState();

		if (this.previewState === PreviewState.Disposed) {
			return;
		}

		if (this._webviewEditor.active) {
			this.pageStatusBarEntry.show(this, this._page, this._pageCount);
			this.zoomStatusBarEntry.show(this, this._scale);
		} else {
			this.pageStatusBarEntry.hide(this);
			this.zoomStatusBarEntry.hide(this);
		}
	}

	protected async getWebviewContents(): Promise<string> {
		const version = Date.now().toString();
		const src = await this.getResourcePath(this._webviewEditor, this._resource, version);
		const settings = {
			src,
			isGitLfs: src === null,
			pdfJs: this.extensionResource('media', 'pdfjs', 'pdf.min.mjs').toString(),
			pdfWorker: this.extensionResource('media', 'pdfjs', 'pdf.worker.min.mjs').toString(),
		};

		const nonce = generateUuid();
		const cspSource = this._webviewEditor.webview.cspSource;

		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
	<title>PDF Preview</title>
	<link rel="stylesheet" href="${escapeAttribute(this.extensionResource('media', 'pdfPreview.css'))}" type="text/css" media="screen" nonce="${nonce}">
	<link rel="modulepreload" href="${escapeAttribute(settings.pdfJs)}">
	<link rel="modulepreload" href="${escapeAttribute(settings.pdfWorker)}">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: ${cspSource}; connect-src ${cspSource}; script-src 'nonce-${nonce}' ${cspSource}; worker-src ${cspSource} blob:; style-src ${cspSource} 'nonce-${nonce}';">
	<meta id="settings" data-settings="${escapeAttribute(JSON.stringify(settings))}">
</head>
<body class="loading" data-vscode-context='{ "preventDefaultContextMenuItems": true }'>
	<div class="toolbar">
		<button type="button" id="prev" title="${escapeAttribute(vscode.l10n.t("Previous page"))}">&#9664;</button>
		<span id="page-label">1 / 1</span>
		<button type="button" id="next" title="${escapeAttribute(vscode.l10n.t("Next page"))}">&#9654;</button>
		<button type="button" id="zoom-out" title="${escapeAttribute(vscode.l10n.t("Zoom out"))}">-</button>
		<button type="button" id="zoom-in" title="${escapeAttribute(vscode.l10n.t("Zoom in"))}">+</button>
	</div>
	<div class="loading-indicator"></div>
	<div class="loading-error">
		<p>${vscode.l10n.t("An error occurred while loading the PDF file.")}</p>
		<a href="#" class="open-file-link">${vscode.l10n.t("Open file using VS Code's standard text/binary editor?")}</a>
	</div>
	<div class="git-lfs-info">
		<p>${vscode.l10n.t("The PDF file is stored with Git LFS and is not available for preview.")}</p>
		<a href="#" class="open-file-link">${vscode.l10n.t("Open file using VS Code's standard text/binary editor?")}</a>
	</div>
	<div class="canvas-wrap"><canvas id="page"></canvas></div>
	<script type="module" nonce="${nonce}" src="${escapeAttribute(this.extensionResource('media', 'pdfPreview.js'))}"></script>
</body>
</html>`;
	}

	private async getResourcePath(webviewEditor: vscode.WebviewPanel, resource: vscode.Uri, version: string): Promise<string | null> {
		if (await isGitLfsPointer(resource)) {
			return null;
		}
		if (resource.query) {
			return webviewEditor.webview.asWebviewUri(resource).toString();
		}
		return webviewEditor.webview.asWebviewUri(resource).with({ query: `version=${version}` }).toString();
	}

	private extensionResource(...parts: string[]) {
		return this._webviewEditor.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionRoot, ...parts));
	}
}


export function registerPdfPreviewSupport(context: vscode.ExtensionContext, binarySizeStatusBarEntry: BinarySizeStatusBarEntry): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	const pageStatusBarEntry = new PageStatusBarEntry();
	disposables.push(pageStatusBarEntry);

	const zoomStatusBarEntry = new ZoomStatusBarEntry();
	disposables.push(zoomStatusBarEntry);

	const provider = new PdfPreviewProvider(context.extensionUri, binarySizeStatusBarEntry, pageStatusBarEntry, zoomStatusBarEntry);
	disposables.push(vscode.window.registerCustomEditorProvider(PdfPreviewProvider.viewType, provider, {
		supportsMultipleEditorsPerDocument: true,
		webviewOptions: {
			retainContextWhenHidden: true,
		},
	}));

	disposables.push(vscode.commands.registerCommand('pdfPreview.zoomIn', () => {
		provider.activePreview?.zoomIn();
	}));
	disposables.push(vscode.commands.registerCommand('pdfPreview.zoomOut', () => {
		provider.activePreview?.zoomOut();
	}));
	disposables.push(vscode.commands.registerCommand('pdfPreview.prevPage', () => {
		provider.activePreview?.prevPage();
	}));
	disposables.push(vscode.commands.registerCommand('pdfPreview.nextPage', () => {
		provider.activePreview?.nextPage();
	}));

	return vscode.Disposable.from(...disposables);
}
