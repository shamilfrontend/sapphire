/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getAgentBrowserViewCreationDefaults } from '../../../../platform/browserView/common/browserView.js';
import { IPlaywrightService } from '../../../../platform/browserView/common/playwrightService.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { BrowserViewSharingState, IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';

export const SAPPHIRE_BROWSER_SESSION = 'sapphire';

const PAGE_READY_TIMEOUT_MS = 8_000;
const SUMMARY_MAX_CHARS = 12_000;
const SCREENSHOT_MAX_CHARS = 1_500_000;

export type SapphireBrowserToolResult = {
	pageId: string;
	url: string;
	summary: string;
	imageDataUrl: string | null;
};

const CLICK_FN = `async (page, selector) => { await page.locator(selector).click({ timeout: 8000 }); }`;
const TYPE_FN = `async (page, selector, text, submit) => { const loc = page.locator(selector); await loc.fill(String(text), { timeout: 8000 }); if (submit) { await loc.press('Enter'); } }`;
const SCROLL_FN = `async (page, delta) => { await page.mouse.wheel(0, delta); }`;
const SCREENSHOT_FN = `async (page) => { const buf = await page.screenshot({ type: 'png' }); return buf.toString('base64'); }`;

let lastPageId: string | undefined;

export function resetSapphireBrowserPageForTests(): void {
	lastPageId = undefined;
}

function clipSummary(summary: string): string {
	if (summary.length <= SUMMARY_MAX_CHARS) {
		return summary;
	}
	return `${summary.slice(0, SUMMARY_MAX_CHARS)}\n…[truncated]`;
}

function pageResult(pageId: string, url: string, summary: string, imageDataUrl: string | null = null): SapphireBrowserToolResult {
	return { pageId, url, summary: clipSummary(summary), imageDataUrl };
}

function requireKnownPage(browserViewService: IBrowserViewWorkbenchService, pageId: string) {
	const input = browserViewService.getKnownBrowserViews().get(pageId);
	if (!input) {
		lastPageId = lastPageId === pageId ? undefined : lastPageId;
		throw new Error(`Browser page "${pageId}" is not open. Call browser_navigate first.`);
	}
	return input;
}

/** Список открытых вкладок для system prompt (без DOM / cookies). */
export function formatOpenBrowserTabsForPrompt(
	editorService: IEditorService,
	browserViewService: IBrowserViewWorkbenchService,
): string {
	const views = [...browserViewService.getKnownBrowserViews().values()];
	if (views.length === 0) {
		return 'none open';
	}
	const active = editorService.activeEditor;
	const visible = new Set(editorService.visibleEditors);
	return views.map(input => {
		const title = (input.title || 'Browser').replace(/\s+/g, ' ').trim();
		const url = input.url || 'about:blank';
		const shared = input.model?.sharingState === BrowserViewSharingState.Shared ? 'shared' : 'not-shared';
		const hint = input === active ? 'active' : visible.has(input) ? 'visible' : 'hidden';
		return `- [${input.id}] ${title} (${url}) (${hint}, ${shared})`;
	}).join('\n');
}

function resolvePageId(
	browserViewService: IBrowserViewWorkbenchService,
	editorService: IEditorService,
	pageId: string | undefined,
): string {
	if (pageId) {
		requireKnownPage(browserViewService, pageId);
		return pageId;
	}

	const active = editorService.activeEditor;
	if (active instanceof BrowserEditorInput) {
		return active.id;
	}
	for (const editor of editorService.visibleEditors) {
		if (editor instanceof BrowserEditorInput) {
			return editor.id;
		}
	}
	if (lastPageId && browserViewService.getKnownBrowserViews().has(lastPageId)) {
		return lastPageId;
	}
	const first = browserViewService.getKnownBrowserViews().keys().next().value;
	if (typeof first === 'string') {
		return first;
	}
	throw new Error('No browser page is open. Call browser_navigate first or open the integrated browser.');
}

async function ensurePageShared(
	browserViewService: IBrowserViewWorkbenchService,
	editorService: IEditorService,
	pageId: string,
): Promise<string> {
	const input = requireKnownPage(browserViewService, pageId);
	const model = await input.resolve();
	if (model.sharingState === BrowserViewSharingState.Shared) {
		lastPageId = pageId;
		return pageId;
	}
	const shared = await model.setSharedWithAgent(true);
	if (!shared) {
		throw new Error('User declined sharing this browser tab with the agent.');
	}
	lastPageId = shared.id;
	const sharedInput = browserViewService.getKnownBrowserViews().get(shared.id) ?? input;
	await editorService.openEditor(sharedInput);
	return shared.id;
}

async function preparePage(
	browserViewService: IBrowserViewWorkbenchService,
	playwrightService: IPlaywrightService,
	editorService: IEditorService,
	pageId: string | undefined,
): Promise<{ pageId: string; input: BrowserEditorInput }> {
	const resolved = resolvePageId(browserViewService, editorService, pageId);
	const sharedId = await ensurePageShared(browserViewService, editorService, resolved);
	const input = requireKnownPage(browserViewService, sharedId);
	await editorService.openEditor(input);
	// После share пользовательской вкладки Playwright может ещё не видеть page — ждём discovery.
	await playwrightService.waitForPageAndGetSummary(
		SAPPHIRE_BROWSER_SESSION,
		sharedId,
		input.url || 'about:blank',
		PAGE_READY_TIMEOUT_MS,
	);
	return { pageId: sharedId, input };
}

export async function navigateSapphireBrowser(
	browserViewService: IBrowserViewWorkbenchService,
	playwrightService: IPlaywrightService,
	editorService: IEditorService,
	url: string,
): Promise<SapphireBrowserToolResult> {
	const existing = lastPageId ? browserViewService.getKnownBrowserViews().get(lastPageId) : undefined;
	if (existing) {
		await editorService.openEditor(existing);
		const model = await existing.resolve();
		await model.loadURL(url);
		const summary = await playwrightService.getSummary(SAPPHIRE_BROWSER_SESSION, existing.id);
		return pageResult(existing.id, url, summary);
	}

	const input = await browserViewService.createBrowserView({
		...getAgentBrowserViewCreationDefaults(SAPPHIRE_BROWSER_SESSION),
		initialUrl: url,
		openSource: 'cdpCreated',
	}, { preserveFocus: false });
	lastPageId = input.id;
	const summary = await playwrightService.waitForPageAndGetSummary(
		SAPPHIRE_BROWSER_SESSION,
		input.id,
		url,
		PAGE_READY_TIMEOUT_MS,
	);
	return pageResult(input.id, url, summary);
}

async function runOnPage(
	browserViewService: IBrowserViewWorkbenchService,
	playwrightService: IPlaywrightService,
	editorService: IEditorService,
	pageId: string | undefined,
	fn: string,
	args: unknown[],
): Promise<{ pageId: string; url: string; summary: string; result: unknown }> {
	const prepared = await preparePage(browserViewService, playwrightService, editorService, pageId);
	const invoked = await playwrightService.invokeFunction(SAPPHIRE_BROWSER_SESSION, prepared.pageId, fn, args);
	if (invoked.error) {
		throw new Error(invoked.error);
	}
	return { pageId: prepared.pageId, url: prepared.input.url || '', summary: invoked.summary, result: invoked.result };
}

export async function snapshotSapphireBrowser(
	browserViewService: IBrowserViewWorkbenchService,
	playwrightService: IPlaywrightService,
	editorService: IEditorService,
	pageId: string | undefined,
): Promise<SapphireBrowserToolResult> {
	const prepared = await preparePage(browserViewService, playwrightService, editorService, pageId);
	const summary = await playwrightService.getSummary(SAPPHIRE_BROWSER_SESSION, prepared.pageId);
	return pageResult(prepared.pageId, prepared.input.url || '', summary);
}

export async function clickSapphireBrowser(
	browserViewService: IBrowserViewWorkbenchService,
	playwrightService: IPlaywrightService,
	editorService: IEditorService,
	pageId: string | undefined,
	ref: string,
): Promise<SapphireBrowserToolResult> {
	const ran = await runOnPage(browserViewService, playwrightService, editorService, pageId, CLICK_FN, [`aria-ref=${ref}`]);
	return pageResult(ran.pageId, ran.url, ran.summary);
}

export async function typeSapphireBrowser(
	browserViewService: IBrowserViewWorkbenchService,
	playwrightService: IPlaywrightService,
	editorService: IEditorService,
	pageId: string | undefined,
	ref: string,
	text: string,
	submit: boolean,
): Promise<SapphireBrowserToolResult> {
	const ran = await runOnPage(
		browserViewService,
		playwrightService,
		editorService,
		pageId,
		TYPE_FN,
		[`aria-ref=${ref}`, text, submit],
	);
	return pageResult(ran.pageId, ran.url, ran.summary);
}

export async function scrollSapphireBrowser(
	browserViewService: IBrowserViewWorkbenchService,
	playwrightService: IPlaywrightService,
	editorService: IEditorService,
	pageId: string | undefined,
	direction: 'up' | 'down',
): Promise<SapphireBrowserToolResult> {
	const ran = await runOnPage(
		browserViewService,
		playwrightService,
		editorService,
		pageId,
		SCROLL_FN,
		[direction === 'up' ? -600 : 600],
	);
	return pageResult(ran.pageId, ran.url, ran.summary);
}

export async function screenshotSapphireBrowser(
	browserViewService: IBrowserViewWorkbenchService,
	playwrightService: IPlaywrightService,
	editorService: IEditorService,
	pageId: string | undefined,
): Promise<SapphireBrowserToolResult> {
	const ran = await runOnPage(browserViewService, playwrightService, editorService, pageId, SCREENSHOT_FN, []);
	const raw = typeof ran.result === 'string' ? ran.result : '';
	const imageDataUrl = raw && raw.length <= SCREENSHOT_MAX_CHARS ? `data:image/png;base64,${raw}` : null;
	return pageResult(ran.pageId, ran.url, ran.summary, imageDataUrl);
}
