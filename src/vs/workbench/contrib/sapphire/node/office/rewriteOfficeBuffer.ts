/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { colToLetters, parseXlsxBody, stripOfficeOutline } from '../../common/office/officeModel.js';
import { officeFileName, officeKindFromPath } from '../../common/office/officeDocument.js';
import { escapeXml, writeZipEntries } from './ooxmlPackage.js';

function contentTypes(overrides: { part: string; type: string }[]): string {
	const body = overrides
		.map((item) => `<Override PartName="${item.part}" ContentType="${item.type}"/>`)
		.join('');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${body}
</Types>`;
}

function packageRels(target: string): string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/>
</Relationships>`;
}

function cellXml(ref: string, text: string): string {
	if (text.startsWith('=')) {
		return `<c r="${ref}"><f>${escapeXml(text.slice(1))}</f></c>`;
	}
	if (/^-?\d+(?:\.\d+)?$/.test(text)) {
		return `<c r="${ref}"><v>${text}</v></c>`;
	}
	if (text === '') {
		return '';
	}
	const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
	return `<c r="${ref}" t="inlineStr"><is><t${space}>${escapeXml(text)}</t></is></c>`;
}

function buildXlsx(fileName: string, text: string): Map<string, string> {
	const body = stripOfficeOutline('xlsx', fileName, text);
	const parsed = parseXlsxBody(body);
	const sheets = parsed.length > 0 ? parsed : [{ name: 'Sheet1', rows: [] as string[][] }];
	const entries = new Map<string, string>();
	const overrides: { part: string; type: string }[] = [
		{
			part: '/xl/workbook.xml',
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
		},
	];
	const sheetRels: string[] = [];
	sheets.forEach((sheet, index) => {
		const n = index + 1;
		const path = `/xl/worksheets/sheet${n}.xml`;
		overrides.push({
			part: path,
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
		});
		sheetRels.push(
			`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`,
		);
		const rows = sheet.rows.map((row, rowIndex) => {
			const cells = row.map((value, colIndex) => cellXml(`${colToLetters(colIndex + 1)}${rowIndex + 1}`, value)).join('');
			return `<row r="${rowIndex + 1}">${cells}</row>`;
		}).join('');
		const lastCol = Math.max(1, ...sheet.rows.map((row) => row.length));
		const lastRow = Math.max(1, sheet.rows.length);
		const ref = `A1:${colToLetters(lastCol)}${lastRow}`;
		entries.set(
			`xl/worksheets/sheet${n}.xml`,
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${ref}"/><sheetData>${rows}</sheetData></worksheet>`,
		);
	});
	const sheetTags = sheets
		.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
		.join('');
	entries.set(
		'xl/workbook.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`,
	);
	entries.set(
		'xl/_rels/workbook.xml.rels',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels.join('')}</Relationships>`,
	);
	entries.set('[Content_Types].xml', contentTypes(overrides));
	entries.set('_rels/.rels', packageRels('xl/workbook.xml'));
	return entries;
}

function paragraphXml(text: string, headingLevel?: number): string {
	const style = headingLevel ? `<w:pPr><w:pStyle w:val="Heading${headingLevel}"/></w:pPr>` : '';
	const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
	return `<w:p>${style}<w:r><w:t${space}>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(rows: string[][]): string {
	const body = rows.map((row) => {
		const cells = row.map((value) => `<w:tc>${paragraphXml(value)}</w:tc>`).join('');
		return `<w:tr>${cells}</w:tr>`;
	}).join('');
	return `<w:tbl>${body}</w:tbl>`;
}

function parseDocBlocks(body: string): ({ kind: 'p'; text: string; heading?: number } | { kind: 't'; rows: string[][] })[] {
	const chunks = body.trim() ? body.split('\n\n') : [];
	return chunks.map((chunk) => {
		if (chunk.includes('\t')) {
			return { kind: 't' as const, rows: chunk.split('\n').map((line) => line.split('\t')) };
		}
		const heading = /^(#{1,6})\s+([\s\S]*)$/.exec(chunk);
		if (heading) {
			return { kind: 'p' as const, text: heading[2], heading: heading[1].length };
		}
		return { kind: 'p' as const, text: chunk };
	});
}

function buildDocx(fileName: string, text: string): Map<string, string> {
	const body = stripOfficeOutline('docx', fileName, text);
	const blocks = parseDocBlocks(body);
	const inner = blocks.map((block) => block.kind === 't' ? tableXml(block.rows) : paragraphXml(block.text, block.heading)).join('');
	const entries = new Map<string, string>();
	entries.set(
		'word/document.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${inner}<w:sectPr/></w:body></w:document>`,
	);
	entries.set(
		'[Content_Types].xml',
		contentTypes([{
			part: '/word/document.xml',
			type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
		}]),
	);
	entries.set('_rels/.rels', packageRels('word/document.xml'));
	return entries;
}

function shapeXml(text: string, index: number): string {
	const lines = text.split('\n');
	const paras = lines.map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`).join('');
	const y = 400000 + index * 900000;
	return `<p:sp><p:spPr><a:xfrm><a:off x="400000" y="${y}"/><a:ext cx="8000000" cy="700000"/></a:xfrm></p:spPr><p:txBody>${paras}</p:txBody></p:sp>`;
}

function notesXml(text: string): string {
	const paras = text.split('\n').map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`).join('');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${paras}</p:spTree></p:cSld></p:notes>`;
}

function parseSlides(body: string): { shapes: string[]; notes: string }[] {
	const normalized = body.trim();
	if (!normalized) {
		return [{ shapes: [''], notes: '' }];
	}
	const marks = [...normalized.matchAll(/^## Slide \d+\s*$/gm)];
	if (marks.length === 0) {
		return [{ shapes: [normalized], notes: '' }];
	}
	return marks.map((mark, index) => {
		const start = (mark.index ?? 0) + mark[0].length;
		const end = index + 1 < marks.length ? (marks[index + 1].index ?? normalized.length) : normalized.length;
		const part = normalized.slice(start, end).replace(/^\n/, '').trim();
		const marker = '\n\nNotes:\n';
		const notesAt = part.indexOf(marker);
		const shapesText = notesAt < 0 ? part : part.slice(0, notesAt).trim();
		const notes = notesAt < 0 ? '' : part.slice(notesAt + marker.length).trim();
		const shapes = shapesText.length > 0 ? shapesText.split('\n\n') : [''];
		return { shapes, notes };
	});
}

function buildPptx(fileName: string, text: string): Map<string, string> {
	const body = stripOfficeOutline('pptx', fileName, text);
	const slides = parseSlides(body);
	const entries = new Map<string, string>();
	const overrides: { part: string; type: string }[] = [
		{
			part: '/ppt/presentation.xml',
			type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
		},
	];
	const slideRels: string[] = [];
	slides.forEach((slide, index) => {
		const n = index + 1;
		overrides.push({
			part: `/ppt/slides/slide${n}.xml`,
			type: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
		});
		slideRels.push(
			`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`,
		);
		const shapes = slide.shapes.map((shape, shapeIndex) => shapeXml(shape, shapeIndex)).join('');
		const rels: string[] = [];
		if (slide.notes) {
			overrides.push({
				part: `/ppt/notesSlides/notesSlide${n}.xml`,
				type: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
			});
			rels.push(
				`<Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`,
			);
			entries.set(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(slide.notes));
		}
		entries.set(
			`ppt/slides/slide${n}.xml`,
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`,
		);
		if (rels.length > 0) {
			entries.set(
				`ppt/slides/_rels/slide${n}.xml.rels`,
				`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
			);
		}
	});
	const sldId = slides.map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('');
	entries.set(
		'ppt/presentation.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${sldId}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
	);
	entries.set(
		'ppt/_rels/presentation.xml.rels',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRels.join('')}</Relationships>`,
	);
	entries.set('[Content_Types].xml', contentTypes(overrides));
	entries.set('_rels/.rels', packageRels('ppt/presentation.xml'));
	return entries;
}

export async function rewriteOfficeFromText(fileName: string, newContent: string): Promise<Buffer> {
	const name = officeFileName(fileName);
	const kind = officeKindFromPath(name);
	if (kind !== 'xlsx' && kind !== 'docx' && kind !== 'pptx') {
		throw new Error('rewriteOffice only supports .xlsx, .xlsm, .docx, and .pptx.');
	}
	const built = kind === 'xlsx' ? buildXlsx(name, newContent) : kind === 'docx' ? buildDocx(name, newContent) : buildPptx(name, newContent);
	const bytes = new Map<string, Buffer>();
	for (const [path, xml] of built) {
		bytes.set(path, Buffer.from(xml, 'utf8'));
	}
	return writeZipEntries(bytes);
}
