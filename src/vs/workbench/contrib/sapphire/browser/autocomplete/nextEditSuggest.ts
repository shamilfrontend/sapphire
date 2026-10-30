/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Следующая правка не ближе этого числа строк к курсору: ближе остаётся обычный FIM. */
export const NEXT_EDIT_MIN_DISTANCE = 2;

export const NEXT_EDIT_REQUEST_TIMEOUT_MS = 8_000;

export const NEXT_EDIT_EXCERPT_RADIUS = 40;

const MAX_LINE_CHARS = 240;
const MAX_ACCEPTED_CHARS = 240;

export type NextEdit = {
	lineNumber: number;
	oldText: string;
	newText: string;
};

export function buildNextEditPrompt(lines: readonly string[], cursorLine: number, acceptedText: string): string {
	const start = Math.max(1, cursorLine - NEXT_EDIT_EXCERPT_RADIUS);
	const end = Math.min(lines.length, cursorLine + NEXT_EDIT_EXCERPT_RADIUS);
	const excerpt = lines.slice(start - 1, end).map((line, index) => {
		const text = line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line;
		return `${start + index}|${text}`;
	}).join('\n');
	const accepted = acceptedText.replace(/\s+/g, ' ').trim().slice(0, MAX_ACCEPTED_CHARS);
	return `The user just accepted a code completion.
Each line below is NUMBER|TEXT.
${excerpt}
Cursor line: ${cursorLine}
Accepted text: ${accepted || '(empty)'}
Suggest one next edit at least ${NEXT_EDIT_MIN_DISTANCE} lines away from the cursor.
Reply with exactly these three lines and nothing else:
LINE <number>
OLD <exact line text without the number prefix>
NEW <full replacement of that line>
If there is no useful next edit, reply NONE.`;
}

export function parseNextEditResponse(raw: string, cursorLine: number, lineCount: number): NextEdit | undefined {
	const text = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').replace(/\r/g, '');
	if (!/LINE\s+\d+/.test(text)) {
		return undefined;
	}
	const lineMatch = text.match(/LINE\s+(\d+)/);
	const oldMatch = text.match(/OLD\s?(.*)/);
	const newMatch = text.match(/NEW\s?(.*)/);
	if (!lineMatch || !oldMatch || !newMatch) {
		return undefined;
	}
	const lineNumber = Number(lineMatch[1]);
	if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lineCount) {
		return undefined;
	}
	if (Math.abs(lineNumber - cursorLine) < NEXT_EDIT_MIN_DISTANCE) {
		return undefined;
	}
	const oldText = oldMatch[1];
	const newText = newMatch[1];
	if (oldText === newText || oldText.length > MAX_LINE_CHARS || newText.length > MAX_LINE_CHARS) {
		return undefined;
	}
	return { lineNumber, oldText, newText };
}

export function nextEditApplies(lineText: string, cursorLine: number, edit: NextEdit): boolean {
	return lineText === edit.oldText && Math.abs(edit.lineNumber - cursorLine) >= NEXT_EDIT_MIN_DISTANCE;
}
