/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	OfficeBlockModel,
	OfficeCellKind,
	OfficeCellModel,
	OfficeDocumentModel,
	OfficeImageModel,
	OfficeShapeModel,
	OfficeSlideModel,
	cellId,
	colToLetters,
} from '../../common/office/officeModel.js';
import { officeFileName, officeKindFromPath } from '../../common/office/officeDocument.js';
import {
	attr,
	colIndex,
	decodeXml,
	joinZip,
	readZipEntries,
	relsOwner,
	xmlText,
} from './ooxmlPackage.js';

const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const BUILTIN_TIME_FMT = new Set([18, 19, 20, 21, 22, 45, 46, 47]);
const PREVIEW_IMAGE_BYTES = 1_500_000;
const PREVIEW_IMAGE_TOTAL = 6_000_000;
const DEFAULT_SLIDE_CX = 12_192_000;
const DEFAULT_SLIDE_CY = 6_858_000;

export type ReadOfficeModelOptions = {
	/** data URL картинок для вкладки. Extract для агента их не просит. */
	images?: boolean;
};

function isDateFormatCode(code: string): boolean {
	const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
	return /[ydhs]/i.test(stripped);
}

function formatHasTime(code: string): boolean {
	const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
	return /h/i.test(stripped);
}

function dateStyles(stylesXml: string | undefined): Map<number, boolean> {
	const dates = new Map<number, boolean>();
	if (!stylesXml) {
		return dates;
	}
	const custom = new Map<number, string>();
	for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
		const id = attr(match[1], 'numFmtId');
		const code = attr(match[1], 'formatCode');
		if (id !== undefined && code !== undefined) {
			custom.set(Number(id), decodeXml(code));
		}
	}
	const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
	let index = 0;
	for (const xf of xfs.matchAll(/<xf\b([^>]*)\/?>/g)) {
		const id = Number(attr(xf[1], 'numFmtId') ?? '0');
		const code = custom.get(id);
		const isDate = code !== undefined ? isDateFormatCode(code) : BUILTIN_DATE_FMT.has(id);
		if (isDate) {
			dates.set(index, code !== undefined ? formatHasTime(code) : BUILTIN_TIME_FMT.has(id));
		}
		index++;
	}
	return dates;
}

export function excelSerialToString(serial: number, withTime: boolean): string {
	if (!Number.isFinite(serial)) {
		return String(serial);
	}
	const whole = Math.floor(serial);
	const fraction = serial - whole;
	const days = whole > 59 ? whole - 1 : whole;
	const date = new Date(Date.UTC(1900, 0, 1) + (days - 1) * 86_400_000);
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, '0');
	const d = String(date.getUTCDate()).padStart(2, '0');
	if (!withTime || fraction < 1 / 86_400) {
		return `${y}-${m}-${d}`;
	}
	const totalSeconds = Math.round(fraction * 86_400);
	const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
	const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
	return `${y}-${m}-${d} ${hh}:${mm}`;
}

function sharedStrings(xml: string | undefined): string[] {
	if (!xml) {
		return [];
	}
	const items: string[] = [];
	for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
		const inner = si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
		const texts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
		items.push(texts.join(''));
	}
	return items;
}

function sheetPaths(entries: Map<string, string>): { name: string; path: string }[] {
	const workbook = entries.get('xl/workbook.xml') ?? '';
	const rels = entries.get('xl/_rels/workbook.xml.rels') ?? '';
	const targets = new Map<string, string>();
	for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
		const id = attr(rel[1], 'Id');
		const target = attr(rel[1], 'Target');
		if (id && target) {
			targets.set(id, joinZip(relsOwner('xl/_rels/workbook.xml.rels'), target));
		}
	}
	const sheets: { name: string; path: string }[] = [];
	for (const sheet of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
		const name = decodeXml(attr(sheet[1], 'name') ?? 'Sheet');
		const rid = attr(sheet[1], 'r:id') ?? attr(sheet[1], 'id');
		const path = rid ? targets.get(rid) : undefined;
		if (path) {
			sheets.push({ name, path });
		}
	}
	if (sheets.length === 0) {
		for (const key of entries.keys()) {
			if (/^xl\/worksheets\/sheet\d+\.xml$/.test(key)) {
				sheets.push({ name: key, path: key });
			}
		}
		sheets.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
	}
	return sheets;
}

function parseDimension(xml: string): { rows: number; cols: number } | null {
	const ref = /<dimension\b[^>]*ref="([^"]+)"/.exec(xml)?.[1];
	if (!ref) {
		return null;
	}
	const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
	if (!match) {
		return null;
	}
	const c1 = colIndex(match[1]);
	const r1 = Number(match[2]);
	const c2 = match[3] ? colIndex(match[3]) : c1;
	const r2 = match[4] ? Number(match[4]) : r1;
	return { rows: Math.max(0, r2 - r1 + 1), cols: Math.max(0, c2 - c1 + 1) };
}

function cellRowCol(ref: string, fallbackRow: number): { row: number; col: number; ref: string } {
	const match = /^([A-Z]+)(\d+)$/.exec(ref);
	if (!match) {
		const col = colIndex(ref);
		const resolved = `${colToLetters(col)}${fallbackRow}`;
		return { row: fallbackRow, col, ref: resolved };
	}
	return { row: Number(match[2]), col: colIndex(match[1]), ref };
}

function readCell(
	attrs: string,
	inner: string,
	fallbackRow: number,
	sheetIndex: number,
	shared: string[],
	dates: Map<number, boolean>,
): OfficeCellModel {
	const refAttr = attr(attrs, 'r') ?? '';
	const pos = cellRowCol(refAttr, fallbackRow);
	const styleRaw = attr(attrs, 's');
	const style = styleRaw === undefined ? undefined : Number(styleRaw);
	const type = attr(attrs, 't');
	const styleIndex = style === undefined ? 0 : style;
	const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1];
	let text = '';
	let kind: OfficeCellKind = 'empty';
	let dateHasTime: boolean | undefined;
	if (formula && formula.trim()) {
		kind = 'formula';
		text = `=${decodeXml(formula).trim()}`;
	} else {
		const texts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
		if (type === 'inlineStr' || (type === 'str' && texts.length)) {
			kind = 'inline';
			text = texts.join('').replace(/[\r\n]+/g, ' ');
		} else {
			const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
			if (rawValue === undefined) {
				text = texts.join('').replace(/[\r\n]+/g, ' ');
				kind = text ? 'inline' : 'empty';
			} else {
				const raw = decodeXml(rawValue).trim();
				if (type === 's') {
					kind = 'shared';
					text = (shared[Number(raw)] ?? '').replace(/[\r\n]+/g, ' ');
				} else if (type === 'b') {
					kind = 'bool';
					text = raw === '1' ? 'TRUE' : 'FALSE';
				} else if (type === 'e') {
					kind = 'error';
					text = raw;
				} else if (dates.has(styleIndex)) {
					kind = 'date';
					dateHasTime = dates.get(styleIndex) === true;
					const n = Number(raw);
					text = Number.isFinite(n) ? excelSerialToString(n, dateHasTime) : raw;
				} else if (raw === '') {
					kind = 'empty';
					text = '';
				} else {
					kind = 'number';
					text = raw;
				}
			}
		}
	}
	return {
		id: cellId(sheetIndex, pos.col, pos.row),
		ref: pos.ref,
		row: pos.row,
		col: pos.col,
		text,
		kind,
		style,
		dateHasTime,
	};
}

function readXlsx(stringEntries: Map<string, string>, fileName: string): OfficeDocumentModel {
	const sheets = sheetPaths(stringEntries);
	const shared = sharedStrings(stringEntries.get('xl/sharedStrings.xml'));
	const dates = dateStyles(stringEntries.get('xl/styles.xml'));
	return {
		kind: 'xlsx',
		fileName,
		sheets: sheets.map((sheet, index) => {
			const xml = stringEntries.get(sheet.path) ?? '';
			const dim = parseDimension(xml);
			const cells: OfficeCellModel[] = [];
			let fallbackRow = 0;
			for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
				fallbackRow += 1;
				const rowAttr = attr(row[1], 'r');
				const rowNumber = rowAttr && Number(rowAttr) > 0 ? Number(rowAttr) : fallbackRow;
				for (const cell of row[2].matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
					const attrs = cell[1] || cell[2] || '';
					const inner = cell[1] ? '' : (cell[3] ?? '');
					cells.push(readCell(attrs, inner, rowNumber, index, shared, dates));
				}
			}
			return {
				index,
				name: sheet.name,
				path: sheet.path,
				rows: dim?.rows ?? 0,
				cols: dim?.cols ?? 0,
				cells,
			};
		}),
	};
}

function paragraphPlain(xml: string): string {
	const withBreaks = xml
		.replace(/<w:tab\b[^>]*\/>/g, '\t')
		.replace(/<w:br\b[^>]*\/>/g, '\n')
		.replace(/<w:cr\b[^>]*\/>/g, '\n');
	return [...withBreaks.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
		.map((m) => decodeXml(m[1]))
		.join('');
}

function readDocx(documentXml: string, fileName: string): OfficeDocumentModel {
	const blocks: OfficeBlockModel[] = [];
	let paragraph = 0;
	let table = 0;
	const chunks = documentXml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
	for (const block of chunks) {
		if (block.startsWith('<w:tbl')) {
			const id = `t${table}`;
			table += 1;
			const rows: { cells: { id: string; text: string }[] }[] = [];
			let rowIndex = 0;
			for (const row of block.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
				const cells: { id: string; text: string }[] = [];
				let col = 0;
				for (const cell of row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
					const paras = [...cell[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => paragraphPlain(p[0]).trim());
					cells.push({
						id: `${id}:r${rowIndex}:c${col}`,
						text: paras.filter(Boolean).join(' '),
					});
					col += 1;
				}
				rows.push({ cells });
				rowIndex += 1;
			}
			blocks.push({ type: 'table', id, rows });
			continue;
		}
		const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(block)?.[1] ?? '';
		const heading = /^Heading(\d)$/i.exec(style);
		const text = paragraphPlain(block).trim();
		blocks.push({
			type: 'paragraph',
			id: `p${paragraph}`,
			text,
			headingLevel: heading ? Math.min(6, Number(heading[1])) : undefined,
		});
		paragraph += 1;
	}
	return { kind: 'docx', fileName, blocks };
}

function shapeBox(xml: string): { x: number; y: number; cx: number; cy: number } {
	const xfrm = /<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(xml)?.[0] ?? '';
	const off = /<a:off\b([^>]*)\/?>/.exec(xfrm)?.[1] ?? '';
	const ext = /<a:ext\b([^>]*)\/?>/.exec(xfrm)?.[1] ?? '';
	return {
		x: Number(attr(off, 'x') ?? 0),
		y: Number(attr(off, 'y') ?? 0),
		cx: Number(attr(ext, 'cx') ?? 0),
		cy: Number(attr(ext, 'cy') ?? 0),
	};
}

function drawingParagraphs(xml: string): string {
	const paras = xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
	return paras
		.map((para) => [...para.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(''))
		.map((line) => line.trim())
		.filter(Boolean)
		.join('\n');
}

function textShapes(xml: string): OfficeShapeModel[] {
	const shapes: OfficeShapeModel[] = [];
	for (const match of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<p:cxnSp\b[\s\S]*?<\/p:cxnSp>/g)) {
		if (!/<a:t\b/.test(match[0])) {
			continue;
		}
		const box = shapeBox(match[0]);
		shapes.push({
			id: '',
			text: drawingParagraphs(match[0]),
			...box,
		});
	}
	if (shapes.length === 0 && /<a:t\b/.test(xml)) {
		shapes.push({ id: '', text: drawingParagraphs(xml), x: 0, y: 0, cx: 0, cy: 0 });
	}
	return shapes;
}

function slideImages(
	xml: string,
	rels: string,
	entries: Map<string, Buffer>,
	relsPath: string,
	allowImages: boolean,
	budget: { used: number },
): OfficeImageModel[] {
	const targets = new Map<string, string>();
	for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
		const id = attr(rel[1], 'Id');
		const target = attr(rel[1], 'Target');
		if (id && target) {
			targets.set(id, joinZip(relsOwner(relsPath), target));
		}
	}
	const images: OfficeImageModel[] = [];
	let index = 0;
	for (const pic of xml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)) {
		const embed = /r:embed="([^"]+)"/.exec(pic[0])?.[1];
		const box = shapeBox(pic[0]);
		let dataUrl: string | undefined;
		if (allowImages && embed) {
			const path = targets.get(embed);
			const bytes = path ? entries.get(path) : undefined;
			dataUrl = bytes ? imageDataUrl(path ?? '', bytes, budget) : undefined;
		}
		images.push({ id: `pic${index}`, ...box, dataUrl });
		index += 1;
	}
	return images;
}

function imageDataUrl(path: string, bytes: Buffer, budget: { used: number }): string | undefined {
	if (bytes.byteLength > PREVIEW_IMAGE_BYTES || budget.used + bytes.byteLength > PREVIEW_IMAGE_TOTAL) {
		return undefined;
	}
	const ext = path.split('.').pop()?.toLowerCase();
	const mime =
		ext === 'png' ? 'image/png'
			: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
				: ext === 'gif' ? 'image/gif'
					: ext === 'webp' ? 'image/webp'
						: undefined;
	if (!mime) {
		return undefined;
	}
	budget.used += bytes.byteLength;
	return `data:${mime};base64,${bytes.toString('base64')}`;
}

function notesPath(rels: string, relsPath: string): string | undefined {
	for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
		const type = attr(rel[1], 'Type') ?? '';
		const target = attr(rel[1], 'Target');
		if (target && type.includes('notesSlide')) {
			return joinZip(relsOwner(relsPath), target);
		}
	}
	return undefined;
}

function readPptx(
	stringEntries: Map<string, string>,
	rawEntries: Map<string, Buffer>,
	fileName: string,
	images: boolean,
): OfficeDocumentModel {
	const presentation = stringEntries.get('ppt/presentation.xml') ?? '';
	const sldSz = /<p:sldSz\b([^>]*)\/?>/.exec(presentation)?.[1] ?? '';
	const slideCx = Number(attr(sldSz, 'cx') ?? DEFAULT_SLIDE_CX) || DEFAULT_SLIDE_CX;
	const slideCy = Number(attr(sldSz, 'cy') ?? DEFAULT_SLIDE_CY) || DEFAULT_SLIDE_CY;
	const slideNames = [...stringEntries.keys()]
		.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	const budget = { used: 0 };
	const slides: OfficeSlideModel[] = slideNames.map((path, index) => {
		const xml = stringEntries.get(path) ?? '';
		const relsPath = path.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
		const rels = stringEntries.get(relsPath) ?? '';
		const shapes = textShapes(xml).map((shape, shapeIndex) => ({
			...shape,
			id: `s${index}:sh${shapeIndex}`,
		}));
		const noteFile = notesPath(rels, relsPath);
		const notesText = noteFile ? drawingParagraphs(stringEntries.get(noteFile) ?? '') : '';
		return {
			index,
			path,
			shapes,
			images: slideImages(xml, rels, rawEntries, relsPath, images, budget),
			notes: { id: `s${index}:notes`, text: notesText },
		};
	});
	return { kind: 'pptx', fileName, slides, slideCx, slideCy };
}

function stringMap(entries: Map<string, Buffer>): Map<string, string> {
	const strings = new Map<string, string>();
	for (const [name, bytes] of entries) {
		if (name.endsWith('.xml') || name.endsWith('.rels')) {
			strings.set(name, xmlText(bytes));
		}
	}
	return strings;
}

export function readOfficeModelFromEntries(
	fileName: string,
	entries: Map<string, Buffer>,
	options?: ReadOfficeModelOptions,
): OfficeDocumentModel {
	const name = officeFileName(fileName);
	const kind = officeKindFromPath(name);
	if (kind !== 'xlsx' && kind !== 'docx' && kind !== 'pptx') {
		throw new Error('Office model only supports .xlsx, .xlsm, .docx, and .pptx.');
	}
	const strings = stringMap(entries);
	if (kind === 'xlsx') {
		return readXlsx(strings, name);
	}
	if (kind === 'docx') {
		return readDocx(strings.get('word/document.xml') ?? '', name);
	}
	return readPptx(strings, entries, name, options?.images === true);
}

export async function readOfficeModel(
	bytes: Buffer,
	fileName: string,
	options?: ReadOfficeModelOptions,
): Promise<OfficeDocumentModel> {
	const entries = await readZipEntries(bytes);
	return readOfficeModelFromEntries(fileName, entries, options);
}
