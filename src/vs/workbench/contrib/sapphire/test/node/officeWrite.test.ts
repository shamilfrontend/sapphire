/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ZipFile } from 'yazl';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ORIGINAL, DIVIDER, FINAL } from '../../common/prompt/prompts.js';
import { extractOfficeBuffer } from '../../node/office/extractOfficeBuffer.js';
import { editOfficeText } from '../../node/office/editOfficeText.js';
import { patchOfficeBuffer } from '../../node/office/patchOfficeBuffer.js';
import { readZipEntries, xmlText } from '../../node/office/ooxmlPackage.js';
import { rewriteOfficeFromText } from '../../node/office/rewriteOfficeBuffer.js';

const zipEntries = (entries: Record<string, string | Buffer>): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		const zip = new ZipFile();
		const chunks: Buffer[] = [];
		for (const [name, content] of Object.entries(entries)) {
			zip.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content), name);
		}
		zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
		zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
		zip.outputStream.on('error', reject);
		zip.end();
	});

const sr = (orig: string, final: string) =>
	`${ORIGINAL}\n${orig}\n${DIVIDER}\n${final}\n${FINAL}`;

const workbook = (sheetName: string) => ({
	'xl/workbook.xml':
		`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
	'xl/_rels/workbook.xml.rels':
		'<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
});

suite('officeWrite', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('patch keeps a shared string on the other cell, the style, and a picture', async () => {
		const picture = Buffer.from('PNGDATA');
		const bytes = await zipEntries({
			...workbook('Data'),
			'xl/sharedStrings.xml': '<sst uniqueCount="1"><si><t>Same</t></si></sst>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><dimension ref="A1:B1"/><sheetData><row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="B1" t="s"><v>0</v></c></row></sheetData></worksheet>',
			'xl/media/pic.png': picture,
		});
		const next = await patchOfficeBuffer(bytes, 'book.xlsx', [{ id: 's0:A1', text: 'Changed' }]);
		const payload = await extractOfficeBuffer(next, 'book.xlsx');
		assert.ok(payload.body.includes('Changed'));
		assert.ok(payload.body.includes('Same'));
		const entries = await readZipEntries(next);
		const sheet = xmlText(entries.get('xl/worksheets/sheet1.xml'));
		assert.ok(sheet.includes('s="1"'));
		assert.ok(sheet.includes('<c r="B1" t="s"><v>0</v></c>') || sheet.includes('r="B1"'));
		assert.ok(sheet.includes('<v>0</v>'));
		assert.deepStrictEqual(entries.get('xl/media/pic.png'), picture);
		const shared = xmlText(entries.get('xl/sharedStrings.xml'));
		assert.ok(shared.includes('Same'));
		assert.ok(shared.includes('Changed'));
	});

	test('a formula is shown and written as a formula', async () => {
		const bytes = await zipEntries({
			...workbook('Calc'),
			'xl/worksheets/sheet1.xml':
				'<worksheet><dimension ref="A1"/><sheetData><row r="1"><c r="A1"><f>SUM(1,2)</f><v>3</v></c></row></sheetData></worksheet>',
		});
		const before = await extractOfficeBuffer(bytes, 'calc.xlsx');
		assert.ok(before.body.includes('=SUM(1,2)'));
		assert.ok(!before.body.includes('\n3'));
		const next = await patchOfficeBuffer(bytes, 'calc.xlsx', [{ id: 's0:A1', text: '=SUM(1,3)' }]);
		const after = await extractOfficeBuffer(next, 'calc.xlsx');
		assert.ok(after.body.includes('=SUM(1,3)'));
		const sheet = xmlText((await readZipEntries(next)).get('xl/worksheets/sheet1.xml'));
		assert.ok(sheet.includes('<f>SUM(1,3)</f>'));
		assert.ok(!sheet.includes('<v>3</v>'));
	});

	test('docx patch keeps the paragraph style and drops the other run', async () => {
		const bytes = await zipEntries({
			'word/document.xml':
				'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r></w:p></w:body></w:document>',
		});
		const next = await patchOfficeBuffer(bytes, 'notes.docx', [{ id: 'p0', text: 'Hi' }]);
		const xml = xmlText((await readZipEntries(next)).get('word/document.xml'));
		assert.ok(xml.includes('Heading1'));
		assert.ok(xml.includes('<w:b/>') || xml.includes('<w:b></w:b>') || xml.includes('<w:b '));
		assert.ok(xml.includes('Hi'));
		assert.ok(!xml.includes('world'));
		const payload = await extractOfficeBuffer(next, 'notes.docx');
		assert.ok(payload.body.includes('# Hi'));
	});

	test('pptx patch changes a label and keeps the picture bytes', async () => {
		const picture = Buffer.from('SLIDEPNG');
		const bytes = await zipEntries({
			'ppt/slides/slide1.xml':
				'<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm></p:spPr><p:txBody><a:p><a:t>Hello slide</a:t></a:p></p:txBody></p:sp></p:spTree></p:sld>',
			'ppt/slides/_rels/slide1.xml.rels':
				'<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/pic.png"/></Relationships>',
			'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:t>Say this</a:t></a:p></p:notes>',
			'ppt/media/pic.png': picture,
		});
		const next = await patchOfficeBuffer(bytes, 'deck.pptx', [{ id: 's0:sh0', text: 'Next' }]);
		const payload = await extractOfficeBuffer(next, 'deck.pptx');
		assert.ok(payload.body.includes('Next'));
		assert.ok(payload.body.includes('Say this'));
		assert.deepStrictEqual((await readZipEntries(next)).get('ppt/media/pic.png'), picture);
	});

	test('edit_file replaces a cell through the extracted text', async () => {
		const bytes = await zipEntries({
			...workbook('Data'),
			'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Alice</t></si></sst>',
			'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
			'xl/worksheets/sheet1.xml':
				'<worksheet><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="1"><v>1</v></c></row></sheetData></worksheet>',
		});
		const next = await editOfficeText(bytes, 'report.xlsx', sr('Alice', 'Bob'));
		const payload = await extractOfficeBuffer(next, 'report.xlsx');
		assert.ok(payload.body.includes('Bob'));
		assert.ok(!payload.body.includes('Alice'));
		assert.ok(payload.body.includes('1900-01-01'));
		const sheet = xmlText((await readZipEntries(next)).get('xl/worksheets/sheet1.xml'));
		assert.ok(sheet.includes('s="1"'));
	});

	test('rewrite builds xlsx, docx, and pptx that extract can read', async () => {
		const book = await rewriteOfficeFromText('book.xlsx', '## Data\nA\tB\n1\t2');
		const bookText = await extractOfficeBuffer(book, 'book.xlsx');
		assert.ok(bookText.body.includes('A\tB'));
		assert.ok(bookText.body.includes('1\t2'));
		assert.ok(!bookText.error);

		const doc = await rewriteOfficeFromText('notes.docx', '# Title\n\nHello');
		const docText = await extractOfficeBuffer(doc, 'notes.docx');
		assert.ok(docText.body.includes('# Title'));
		assert.ok(docText.body.includes('Hello'));

		const deck = await rewriteOfficeFromText('deck.pptx', '## Slide 1\nHello\n\nNotes:\nSpeak');
		const deckText = await extractOfficeBuffer(deck, 'deck.pptx');
		assert.ok(deckText.body.includes('Hello'));
		assert.ok(deckText.body.includes('Speak'));
		assert.ok(deckText.outline.includes('Slides: 1'));
	});
});
