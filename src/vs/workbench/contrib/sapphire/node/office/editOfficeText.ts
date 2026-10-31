/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { officeEditsFromPlainText } from '../../common/office/officeModel.js';
import { officePlainText } from '../../common/office/officeDocument.js';
import { extractSearchReplaceBlocks } from '../../common/helpers/extractCodeFromResult.js';
import { matchSearchReplaceBlocks } from '../../common/searchReplaceMatch.js';
import { extractOfficeBuffer } from './extractOfficeBuffer.js';
import { patchOfficeBuffer } from './patchOfficeBuffer.js';
import { readOfficeModel } from './readOfficeModel.js';

function applySearchReplace(searchable: string, blocks: ReturnType<typeof extractSearchReplaceBlocks>): string {
	const matched = matchSearchReplaceBlocks(searchable, blocks);
	if (!matched.ok) {
		throw new Error(matched.message);
	}
	const file = searchable.replace(/\r\n/g, '\n');
	const spans: { start: number; end: number; final: string }[] = [];
	for (const block of blocks) {
		const needle = block.orig.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
		const start = file.indexOf(needle);
		if (start < 0) {
			return applyLineReplacement(file, matched.replacements);
		}
		spans.push({
			start,
			end: start + needle.length,
			final: block.final.replace(/\r\n/g, '\n'),
		});
	}
	spans.sort((a, b) => b.start - a.start);
	let next = file;
	for (const span of spans) {
		next = next.slice(0, span.start) + span.final + next.slice(span.end);
	}
	return next;
}

function applyLineReplacement(
	file: string,
	replacements: { startLine: number; endLine: number; final: string }[],
): string {
	const fileLines = file.split('\n');
	const ordered = [...replacements].sort((a, b) => b.startLine - a.startLine);
	for (const block of ordered) {
		const before = fileLines.slice(0, block.startLine - 1);
		const after = fileLines.slice(block.endLine);
		const finalLines = block.final.replace(/\r\n/g, '\n').split('\n');
		const nextLines = [...before, ...finalLines, ...after];
		fileLines.length = 0;
		fileLines.push(...nextLines);
	}
	return fileLines.join('\n');
}

export async function editOfficeText(bytes: Buffer, fileName: string, searchReplaceBlocks: string): Promise<Buffer> {
	const extracted = await extractOfficeBuffer(bytes, fileName);
	if (extracted.error) {
		throw new Error(extracted.error);
	}
	if (extracted.kind !== 'xlsx' && extracted.kind !== 'docx' && extracted.kind !== 'pptx') {
		throw new Error('editOffice only supports .xlsx, .xlsm, .docx, and .pptx.');
	}
	const blocks = extractSearchReplaceBlocks(searchReplaceBlocks);
	const nextPlain = applySearchReplace(officePlainText(extracted), blocks);
	const model = await readOfficeModel(bytes, fileName);
	const edits = officeEditsFromPlainText(model, nextPlain);
	return patchOfficeBuffer(bytes, fileName, edits);
}
