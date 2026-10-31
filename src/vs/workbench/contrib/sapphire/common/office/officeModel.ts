/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	OfficeExtractPayload,
	OfficeKind,
	officeFileName,
} from './officeDocument.js';

/** Колонки правее этой границы не попадают в текст для модели (как при чтении). */
export const OFFICE_MAX_SHEET_COLS = 64;

export type OfficeCellKind = 'shared' | 'inline' | 'number' | 'date' | 'bool' | 'formula' | 'error' | 'empty';

export type OfficeCellModel = {
	id: string;
	ref: string;
	row: number;
	col: number;
	text: string;
	kind: OfficeCellKind;
	style?: number;
	dateHasTime?: boolean;
};

export type OfficeSheetModel = {
	index: number;
	name: string;
	path: string;
	/** Из dimension; 0, если размер неизвестен. */
	rows: number;
	cols: number;
	cells: OfficeCellModel[];
};

export type OfficeParagraphModel = {
	type: 'paragraph';
	id: string;
	text: string;
	headingLevel?: number;
};

export type OfficeTableCellModel = {
	id: string;
	text: string;
};

export type OfficeTableModel = {
	type: 'table';
	id: string;
	rows: { cells: OfficeTableCellModel[] }[];
};

export type OfficeBlockModel = OfficeParagraphModel | OfficeTableModel;

export type OfficeShapeModel = {
	id: string;
	text: string;
	x: number;
	y: number;
	cx: number;
	cy: number;
};

export type OfficeImageModel = {
	id: string;
	x: number;
	y: number;
	cx: number;
	cy: number;
	dataUrl?: string;
};

export type OfficeSlideModel = {
	index: number;
	path: string;
	shapes: OfficeShapeModel[];
	images: OfficeImageModel[];
	notes: { id: string; text: string };
};

export type OfficeDocumentModel =
	| { kind: 'xlsx'; fileName: string; sheets: OfficeSheetModel[] }
	| { kind: 'docx'; fileName: string; blocks: OfficeBlockModel[] }
	| {
		kind: 'pptx';
		fileName: string;
		slides: OfficeSlideModel[];
		slideCx: number;
		slideCy: number;
	};

export type OfficeTextEdit = { id: string; text: string };

export type OfficeFileStamp = { size: number; mtime: number };

export function colToLetters(col: number): string {
	let n = col;
	let s = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		s = String.fromCharCode(65 + rem) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s || 'A';
}

export function cellId(sheetIndex: number, col: number, row: number): string {
	return `s${sheetIndex}:${colToLetters(col)}${row}`;
}

type DisplayCell = { id: string; text: string; col: number };

export type SheetDisplayRow = { row: number; cells: DisplayCell[] };

/** Строки так, как их печатает extract: дырки между ячейками — пустые колонки. */
export function sheetDisplayRows(sheet: OfficeSheetModel): SheetDisplayRow[] {
	const present = new Map<string, OfficeCellModel>();
	const rowMax = new Map<number, number>();
	for (const cell of sheet.cells) {
		if (cell.col > OFFICE_MAX_SHEET_COLS || cell.col < 1) {
			continue;
		}
		present.set(`${cell.row}:${cell.col}`, cell);
		rowMax.set(cell.row, Math.max(rowMax.get(cell.row) ?? 0, cell.col));
	}
	const rows: SheetDisplayRow[] = [];
	for (const row of [...rowMax.keys()].sort((a, b) => a - b)) {
		const maxCol = rowMax.get(row) ?? 0;
		if (maxCol < 1) {
			continue;
		}
		const cells: DisplayCell[] = [];
		for (let col = 1; col <= maxCol; col++) {
			const found = present.get(`${row}:${col}`);
			cells.push({
				id: found?.id ?? cellId(sheet.index, col, row),
				text: found?.text ?? '',
				col,
			});
		}
		rows.push({ row, cells });
	}
	return rows;
}

function pushCapped(parts: string[], chunk: string, cap: number, state: { len: number; truncated: boolean }): boolean {
	if (state.truncated || !chunk) {
		return !state.truncated;
	}
	if (state.len + chunk.length > cap) {
		const room = cap - state.len;
		if (room > 0) {
			parts.push(chunk.slice(0, room));
		}
		state.len = cap;
		state.truncated = true;
		return false;
	}
	parts.push(chunk);
	state.len += chunk.length;
	return true;
}

export function formatOfficeExtract(model: OfficeDocumentModel, cap = 2_000_000): OfficeExtractPayload {
	const fileName = model.fileName;
	if (model.kind === 'xlsx') {
		const outlineParts = model.sheets.map((sheet) =>
			sheet.rows > 0 && sheet.cols > 0 ? `${sheet.name} (${sheet.rows} rows x ${sheet.cols} cols)` : sheet.name,
		);
		const parts: string[] = [];
		const state = { len: 0, truncated: false };
		for (const sheet of model.sheets) {
			if (!pushCapped(parts, `## ${sheet.name}\n`, cap, state)) {
				break;
			}
			const rows = sheetDisplayRows(sheet);
			if (rows.length === 0) {
				continue;
			}
			const grid = `${rows.map((row) => row.cells.map((cell) => cell.text).join('\t')).join('\n')}\n\n`;
			if (!pushCapped(parts, grid, cap, state)) {
				break;
			}
		}
		return {
			kind: 'xlsx',
			outline: `# ${fileName}\nSheets: ${outlineParts.join(', ') || '(none)'}`,
			body: parts.join('').trimEnd(),
			truncated: state.truncated,
		};
	}
	if (model.kind === 'docx') {
		const parts: string[] = [];
		const state = { len: 0, truncated: false };
		for (const block of model.blocks) {
			let chunk = '';
			if (block.type === 'table') {
				chunk = `${block.rows.map((row) => row.cells.map((cell) => cell.text).join('\t')).join('\n')}\n\n`;
			} else {
				const text = block.text.trim();
				if (!text) {
					continue;
				}
				const heading = block.headingLevel ? '#'.repeat(Math.min(6, block.headingLevel)) : '';
				chunk = `${heading ? `${heading} ${text}` : text}\n\n`;
			}
			if (!pushCapped(parts, chunk, cap, state)) {
				break;
			}
		}
		return {
			kind: 'docx',
			outline: `# ${fileName}`,
			body: parts.join('').trimEnd(),
			truncated: state.truncated,
		};
	}
	const parts: string[] = [];
	const state = { len: 0, truncated: false };
	for (const slide of model.slides) {
		const shapeText = slide.shapes.map((shape) => shape.text.trim()).filter(Boolean).join('\n\n');
		const notes = slide.notes.text.trim();
		const chunk = `## Slide ${slide.index + 1}\n${shapeText}${notes ? `\n\nNotes:\n${notes}` : ''}\n\n`;
		if (!pushCapped(parts, chunk, cap, state)) {
			break;
		}
	}
	return {
		kind: 'pptx',
		outline: `# ${fileName}\nSlides: ${model.slides.length}`,
		body: parts.join('').trimEnd(),
		truncated: state.truncated,
	};
}

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Снимает шапку extract (`# file`, `Sheets:` / `Slides:`), если она ещё на месте. */
export function stripOfficeOutline(kind: OfficeKind, fileName: string, text: string): string {
	const name = officeFileName(fileName);
	const lines = normalizeNewlines(text).split('\n');
	if (lines[0]?.trim() !== `# ${name}`) {
		return lines.join('\n').trim();
	}
	lines.shift();
	while (lines[0]?.trim() === '') {
		lines.shift();
	}
	if (kind === 'xlsx' && lines[0]?.startsWith('Sheets:')) {
		lines.shift();
	}
	if (kind === 'pptx' && lines[0]?.startsWith('Slides:')) {
		lines.shift();
	}
	while (lines[0]?.trim() === '') {
		lines.shift();
	}
	return lines.join('\n').trim();
}

type ParsedSheet = { name: string; rows: string[][] };

export function parseXlsxBody(body: string): ParsedSheet[] {
	const normalized = normalizeNewlines(body).trim();
	if (!normalized) {
		return [];
	}
	if (!/^## /m.test(normalized)) {
		const lines = normalized.split('\n').filter((line) => line.length > 0 && !line.startsWith('# ') && !line.startsWith('Sheets:'));
		return [{ name: 'Sheet1', rows: lines.map((line) => line.split('\t')) }];
	}
	const start = normalized.search(/^## /m);
	const rest = start < 0 ? normalized : normalized.slice(start);
	const sheets: ParsedSheet[] = [];
	for (const part of rest.split(/^## /m)) {
		if (!part.trim()) {
			continue;
		}
		const nl = part.indexOf('\n');
		const name = (nl < 0 ? part : part.slice(0, nl)).trim();
		const grid = nl < 0 ? '' : part.slice(nl + 1).replace(/\n+$/, '');
		const rows = grid.length > 0 ? grid.split('\n').map((line) => line.split('\t')) : [];
		sheets.push({ name, rows });
	}
	return sheets;
}

function structureError(message: string): Error {
	return new Error(`${message} Use rewrite_file to replace the whole file.`);
}

function diffXlsx(model: Extract<OfficeDocumentModel, { kind: 'xlsx' }>, body: string): OfficeTextEdit[] {
	const parsed = parseXlsxBody(body);
	if (parsed.length !== model.sheets.length) {
		throw structureError('edit_file changed the number of sheets.');
	}
	const edits: OfficeTextEdit[] = [];
	for (let i = 0; i < model.sheets.length; i++) {
		const sheet = model.sheets[i];
		const next = parsed[i];
		if (next.name !== sheet.name) {
			throw structureError(`edit_file renamed sheet "${sheet.name}".`);
		}
		const current = sheetDisplayRows(sheet);
		if (next.rows.length !== current.length) {
			throw structureError(`edit_file changed the number of rows on "${sheet.name}".`);
		}
		for (let r = 0; r < current.length; r++) {
			const row = current[r];
			const parsedRow = next.rows[r];
			if (parsedRow.length !== row.cells.length) {
				throw structureError(`edit_file changed the number of columns on "${sheet.name}".`);
			}
			for (let c = 0; c < row.cells.length; c++) {
				const cell = row.cells[c];
				if (parsedRow[c] !== cell.text) {
					edits.push({ id: cell.id, text: parsedRow[c] });
				}
			}
		}
	}
	return edits;
}

function visibleDocBlocks(model: Extract<OfficeDocumentModel, { kind: 'docx' }>): OfficeBlockModel[] {
	return model.blocks.filter((block) => block.type === 'table' || block.text.trim() !== '');
}

function diffDocx(model: Extract<OfficeDocumentModel, { kind: 'docx' }>, body: string): OfficeTextEdit[] {
	const blocks = visibleDocBlocks(model);
	const chunks = body.trim() ? normalizeNewlines(body).trim().split('\n\n') : [];
	if (chunks.length !== blocks.length) {
		throw structureError('edit_file changed the number of paragraphs or tables.');
	}
	const edits: OfficeTextEdit[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		const chunk = chunks[i];
		if (block.type === 'paragraph') {
			let text = chunk;
			if (block.headingLevel) {
				const heading = new RegExp(`^#{1,6}\\s+([\\s\\S]*)$`).exec(chunk);
				if (heading) {
					text = heading[1];
				}
			}
			if (text !== block.text) {
				edits.push({ id: block.id, text });
			}
			continue;
		}
		const rows = chunk.split('\n').map((line) => line.split('\t'));
		if (rows.length !== block.rows.length) {
			throw structureError('edit_file changed the number of table rows.');
		}
		for (let r = 0; r < block.rows.length; r++) {
			if (rows[r].length !== block.rows[r].cells.length) {
				throw structureError('edit_file changed the number of table columns.');
			}
			for (let c = 0; c < block.rows[r].cells.length; c++) {
				const cell = block.rows[r].cells[c];
				if (rows[r][c] !== cell.text) {
					edits.push({ id: cell.id, text: rows[r][c] });
				}
			}
		}
	}
	return edits;
}

function parseSlidePart(part: string): { shapes: string; notes: string } {
	const marker = '\n\nNotes:\n';
	const idx = part.indexOf(marker);
	if (idx === -1) {
		const trimmed = part.trim();
		if (trimmed === 'Notes:' || trimmed.startsWith('Notes:\n')) {
			return { shapes: '', notes: trimmed.replace(/^Notes:\n?/, '') };
		}
		return { shapes: trimmed, notes: '' };
	}
	return {
		shapes: part.slice(0, idx).trim(),
		notes: part.slice(idx + marker.length).trim(),
	};
}

function splitSlides(body: string): string[] {
	const normalized = normalizeNewlines(body).trim();
	if (!normalized) {
		return [];
	}
	const marks = [...normalized.matchAll(/^## Slide \d+\s*$/gm)];
	if (marks.length === 0) {
		throw structureError('edit_file lost the slide headings.');
	}
	return marks.map((mark, index) => {
		const start = (mark.index ?? 0) + mark[0].length;
		const end = index + 1 < marks.length ? (marks[index + 1].index ?? normalized.length) : normalized.length;
		return normalized.slice(start, end).replace(/^\n/, '');
	});
}

function diffPptx(model: Extract<OfficeDocumentModel, { kind: 'pptx' }>, body: string): OfficeTextEdit[] {
	const parts = splitSlides(body);
	if (parts.length !== model.slides.length) {
		throw structureError('edit_file changed the number of slides.');
	}
	const edits: OfficeTextEdit[] = [];
	for (let i = 0; i < model.slides.length; i++) {
		const slide = model.slides[i];
		const parsed = parseSlidePart(parts[i]);
		const visible = slide.shapes.filter((shape) => shape.text.trim() !== '');
		let nextShapes: string[];
		if (visible.length === 0) {
			if (parsed.shapes.trim()) {
				throw structureError(`edit_file added text structure on slide ${i + 1}.`);
			}
			nextShapes = [];
		} else if (visible.length === 1) {
			nextShapes = [parsed.shapes];
		} else {
			nextShapes = parsed.shapes.length > 0 ? parsed.shapes.split('\n\n') : [];
		}
		if (nextShapes.length !== visible.length) {
			throw structureError(`edit_file changed the number of text boxes on slide ${i + 1}.`);
		}
		for (let s = 0; s < visible.length; s++) {
			if (nextShapes[s] !== visible[s].text) {
				edits.push({ id: visible[s].id, text: nextShapes[s] });
			}
		}
		if (parsed.notes !== slide.notes.text.trim()) {
			edits.push({ id: slide.notes.id, text: parsed.notes });
		}
	}
	return edits;
}

/** SEARCH/REPLACE уже применён к тексту extract. Отличия становятся точечными правками узлов. */
export function officeEditsFromPlainText(model: OfficeDocumentModel, plain: string): OfficeTextEdit[] {
	const body = stripOfficeOutline(model.kind, model.fileName, plain);
	if (model.kind === 'xlsx') {
		return diffXlsx(model, body);
	}
	if (model.kind === 'docx') {
		return diffDocx(model, body);
	}
	return diffPptx(model, body);
}
