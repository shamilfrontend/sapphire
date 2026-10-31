/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OfficeCellModel, OfficeTextEdit } from '../../common/office/officeModel.js';
import { attr, escapeXml, joinZip, readZipEntries, relsOwner, writeZipEntries, xmlText } from './ooxmlPackage.js';
import { excelSerialToString, readOfficeModelFromEntries } from './readOfficeModel.js';

function preserveAttr(text: string): string {
	return /^\s|\s$/.test(text) || text.includes('  ') ? ' xml:space="preserve"' : '';
}

function dateToSerial(text: string, withTime: boolean): number | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(text.trim());
	if (!match) {
		return undefined;
	}
	const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	if (!Number.isFinite(utc)) {
		return undefined;
	}
	const daysFromEpoch = Math.round((utc - Date.UTC(1900, 0, 1)) / 86_400_000);
	let serial = daysFromEpoch + 1;
	if (serial >= 60) {
		serial += 1;
	}
	if (withTime && match[4] !== undefined) {
		const seconds = Number(match[4]) * 3600 + Number(match[5]) * 60;
		serial += seconds / 86_400;
	}
	const check = excelSerialToString(serial, withTime && match[4] !== undefined);
	const expected = withTime && match[4] !== undefined ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : `${match[1]}-${match[2]}-${match[3]}`;
	return check === expected ? serial : undefined;
}

function isPlainNumber(text: string): boolean {
	return /^-?\d+(?:\.\d+)?$/.test(text.trim());
}

function withoutType(attrs: string): string {
	return attrs.replace(/\s+t="[^"]*"/g, '');
}

function renderCell(attrs: string, text: string, cell: OfficeCellModel | undefined, sharedIndex: number | undefined): string {
	const base = withoutType(attrs);
	const trimmed = text;
	if (trimmed.startsWith('=')) {
		return `<c${base}><f>${escapeXml(trimmed.slice(1))}</f></c>`;
	}
	const kind = cell?.kind;
	if ((kind === 'date' || kind === 'number') && cell?.kind === 'date') {
		const serial = dateToSerial(trimmed, cell.dateHasTime === true);
		if (serial !== undefined) {
			return `<c${base}><v>${serial}</v></c>`;
		}
	}
	if (kind === 'bool' && /^(TRUE|FALSE)$/i.test(trimmed)) {
		return `<c${base} t="b"><v>${trimmed.toUpperCase() === 'TRUE' ? 1 : 0}</v></c>`;
	}
	if ((kind === 'number' || kind === 'date' || kind === 'empty' || kind === undefined) && isPlainNumber(trimmed)) {
		return `<c${base}><v>${trimmed.trim()}</v></c>`;
	}
	if (kind === 'shared' && sharedIndex !== undefined) {
		return `<c${base} t="s"><v>${sharedIndex}</v></c>`;
	}
	return `<c${base} t="inlineStr"><is><t${preserveAttr(trimmed)}>${escapeXml(trimmed)}</t></is></c>`;
}

function appendShared(xml: string, text: string): { xml: string; index: number } {
	const existing = (xml.match(/<si\b/g) ?? []).length;
	const si = `<si><t${preserveAttr(text)}>${escapeXml(text)}</t></si>`;
	if (!xml.includes('</sst>')) {
		throw new Error('Workbook shared strings have no closing tag.');
	}
	let next = xml.replace('</sst>', `${si}</sst>`);
	next = next.replace(/\buniqueCount="(\d+)"/, (_, n) => `uniqueCount="${Number(n) + 1}"`);
	next = next.replace(/\bcount="(\d+)"/, (_, n) => `count="${Number(n) + 1}"`);
	return { xml: next, index: existing };
}

function replaceCellElement(xml: string, ref: string, rendered: string): { xml: string; replaced: boolean } {
	const re = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
	let replaced = false;
	const next = xml.replace(re, (full, selfAttrs: string | undefined, openAttrs: string | undefined) => {
		const attrs = selfAttrs || openAttrs || '';
		if (attr(attrs, 'r') !== ref || replaced) {
			return full;
		}
		replaced = true;
		return rendered;
	});
	return { xml: next, replaced };
}

function insertCellElement(xml: string, ref: string, rendered: string): string {
	const rowNumber = Number(/^([A-Z]+)(\d+)$/.exec(ref)?.[2] ?? '');
	if (!rowNumber) {
		throw new Error(`Could not insert cell ${ref}.`);
	}
	const self = new RegExp(`<row\\b([^>]*\\br="${rowNumber}"[^>]*)/>`);
	if (self.test(xml)) {
		return xml.replace(self, `<row$1>${rendered}</row>`);
	}
	let found = false;
	const next = xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, (full, attrs: string, inner: string) => {
		if (Number(attr(attrs, 'r')) !== rowNumber || found) {
			return full;
		}
		found = true;
		return `<row${attrs}>${inner}${rendered}</row>`;
	});
	if (found) {
		return next;
	}
	if (xml.includes('</sheetData>')) {
		return xml.replace('</sheetData>', `<row r="${rowNumber}">${rendered}</row></sheetData>`);
	}
	throw new Error(`Could not insert cell ${ref}.`);
}

function patchXlsx(entries: Map<string, Buffer>, edits: Map<string, string>, fileName: string): Map<string, Buffer> {
	const model = readOfficeModelFromEntries(fileName, entries);
	if (model.kind !== 'xlsx') {
		return entries;
	}
	let sharedXml = xmlText(entries.get('xl/sharedStrings.xml'));
	const bySheet = new Map<number, Map<string, string>>();
	for (const [id, text] of edits) {
		const sheetIndex = /^s(\d+):/.exec(id)?.[1];
		if (sheetIndex === undefined) {
			throw new Error(`Unknown office edit: ${id}`);
		}
		const bucket = bySheet.get(Number(sheetIndex)) ?? new Map<string, string>();
		bucket.set(id, text);
		bySheet.set(Number(sheetIndex), bucket);
	}
	for (const [sheetIndex, sheetEdits] of bySheet) {
		const sheet = model.sheets[sheetIndex];
		if (!sheet) {
			throw new Error(`Unknown office edit: sheet ${sheetIndex}.`);
		}
		let xml = xmlText(entries.get(sheet.path));
		if (!xml) {
			throw new Error(`Worksheet ${sheet.path} is missing.`);
		}
		for (const [id, text] of sheetEdits) {
			const cell = sheet.cells.find((item) => item.id === id);
			if (cell && cell.text === text) {
				continue;
			}
			let sharedIndex: number | undefined;
			if (cell?.kind === 'shared' && !text.startsWith('=') && sharedXml.includes('</sst>')) {
				const appended = appendShared(sharedXml, text);
				sharedXml = appended.xml;
				sharedIndex = appended.index;
			}
			const attrs = cell ? ` r="${cell.ref}"${cell.style !== undefined ? ` s="${cell.style}"` : ''}` : ` r="${id.slice(id.indexOf(':') + 1)}"`;
			const rendered = renderCell(attrs, text, cell, sharedIndex);
			const ref = cell?.ref ?? id.slice(id.indexOf(':') + 1);
			const replaced = replaceCellElement(xml, ref, rendered);
			xml = replaced.replaced ? replaced.xml : insertCellElement(xml, ref, rendered);
		}
		entries.set(sheet.path, Buffer.from(xml, 'utf8'));
	}
	if (entries.has('xl/sharedStrings.xml') || sharedXml.includes('<si')) {
		entries.set('xl/sharedStrings.xml', Buffer.from(sharedXml, 'utf8'));
	}
	return entries;
}

function setMarkedTexts(xml: string, tag: 'w:t' | 'a:t', text: string): string {
	let seen = false;
	const next = xml.replace(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'g'), (_full, attrs: string) => {
		if (!seen) {
			seen = true;
			const cleaned = attrs.replace(/\s+xml:space="[^"]*"/, '');
			return `<${tag}${cleaned}${preserveAttr(text)}>${escapeXml(text)}</${tag}>`;
		}
		return `<${tag}${attrs}></${tag}>`;
	});
	if (seen) {
		return next;
	}
	if (tag === 'w:t') {
		return xml.replace(/<\/w:p>/, `<w:r><w:t${preserveAttr(text)}>${escapeXml(text)}</w:t></w:r></w:p>`);
	}
	return xml.replace(/<\/a:p>/, `<a:r><a:t${preserveAttr(text)}>${escapeXml(text)}</a:t></a:r></a:p>`);
}

function patchTable(block: string, tableId: string, edits: Map<string, string>): string {
	let rowIndex = 0;
	return block.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (rowXml) => {
		let col = 0;
		const next = rowXml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cellXml) => {
			const id = `${tableId}:r${rowIndex}:c${col}`;
			col += 1;
			const text = edits.get(id);
			if (text === undefined) {
				return cellXml;
			}
			edits.delete(id);
			return setMarkedTexts(cellXml, 'w:t', text);
		});
		rowIndex += 1;
		return next;
	});
}

function patchDocx(entries: Map<string, Buffer>, edits: Map<string, string>): Map<string, Buffer> {
	const path = 'word/document.xml';
	const xml = xmlText(entries.get(path));
	if (!xml) {
		throw new Error('word/document.xml is missing.');
	}
	let paragraph = 0;
	let table = 0;
	const re = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
	let out = '';
	let last = 0;
	for (const match of xml.matchAll(re)) {
		const start = match.index ?? 0;
		out += xml.slice(last, start);
		const block = match[0];
		if (block.startsWith('<w:tbl')) {
			const id = `t${table}`;
			table += 1;
			out += patchTable(block, id, edits);
		} else {
			const id = `p${paragraph}`;
			paragraph += 1;
			const text = edits.get(id);
			if (text === undefined) {
				out += block;
			} else {
				edits.delete(id);
				out += setMarkedTexts(block, 'w:t', text);
			}
		}
		last = start + block.length;
	}
	out += xml.slice(last);
	if (edits.size > 0) {
		throw new Error(`Unknown office edit: ${[...edits.keys()][0]}`);
	}
	entries.set(path, Buffer.from(out, 'utf8'));
	return entries;
}

function patchShapeList(xml: string, slideIndex: number, edits: Map<string, string>): string {
	let shapeIndex = 0;
	const next = xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>|<p:cxnSp\b[\s\S]*?<\/p:cxnSp>/g, (shape) => {
		if (!/<a:t\b/.test(shape)) {
			return shape;
		}
		const id = `s${slideIndex}:sh${shapeIndex}`;
		shapeIndex += 1;
		const text = edits.get(id);
		if (text === undefined) {
			return shape;
		}
		edits.delete(id);
		return setMarkedTexts(shape, 'a:t', text);
	});
	if (shapeIndex === 0) {
		const id = `s${slideIndex}:sh0`;
		const text = edits.get(id);
		if (text !== undefined) {
			edits.delete(id);
			return setMarkedTexts(xml, 'a:t', text);
		}
	}
	return next;
}

function patchPptx(entries: Map<string, Buffer>, edits: Map<string, string>, fileName: string): Map<string, Buffer> {
	const model = readOfficeModelFromEntries(fileName, entries);
	if (model.kind !== 'pptx') {
		return entries;
	}
	for (const slide of model.slides) {
		const notesId = slide.notes.id;
		const slideEdits = [...edits.keys()].filter((id) => id.startsWith(`s${slide.index}:sh`));
		if (slideEdits.length > 0) {
			const xml = xmlText(entries.get(slide.path));
			entries.set(slide.path, Buffer.from(patchShapeList(xml, slide.index, edits), 'utf8'));
		}
		if (edits.has(notesId)) {
			const relsPath = slide.path.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
			const rels = xmlText(entries.get(relsPath));
			let noteFile: string | undefined;
			for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
				const type = attr(rel[1], 'Type') ?? '';
				const target = attr(rel[1], 'Target');
				if (target && type.includes('notesSlide')) {
					noteFile = joinZip(relsOwner(relsPath), target);
				}
			}
			if (!noteFile || !entries.has(noteFile)) {
				throw new Error(`Speaker notes for slide ${slide.index + 1} are missing.`);
			}
			const text = edits.get(notesId) ?? '';
			edits.delete(notesId);
			entries.set(noteFile, Buffer.from(setMarkedTexts(xmlText(entries.get(noteFile)), 'a:t', text), 'utf8'));
		}
	}
	if (edits.size > 0) {
		throw new Error(`Unknown office edit: ${[...edits.keys()][0]}`);
	}
	return entries;
}

export async function patchOfficeBuffer(bytes: Buffer, fileName: string, edits: readonly OfficeTextEdit[]): Promise<Buffer> {
	if (edits.length === 0) {
		return bytes;
	}
	const entries = await readZipEntries(bytes);
	const pending = new Map<string, string>();
	for (const edit of edits) {
		pending.set(edit.id, edit.text);
	}
	const model = readOfficeModelFromEntries(fileName, entries);
	let next: Map<string, Buffer>;
	if (model.kind === 'xlsx') {
		next = patchXlsx(entries, pending, fileName);
	} else if (model.kind === 'docx') {
		next = patchDocx(entries, pending);
	} else {
		next = patchPptx(entries, pending, fileName);
	}
	return writeZipEntries(next);
}
