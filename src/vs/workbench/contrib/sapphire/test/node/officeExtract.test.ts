/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ZipFile } from 'yazl';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { extractOfficeBuffer } from '../../node/office/extractOfficeBuffer.js';
import {
  formatOfficePage,
  legacyOfficePayload,
  OfficeExtractPayload,
  tooLargeOfficePayload,
} from '../../common/office/officeDocument.js';

const zipEntries = (entries: Record<string, string>): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    for (const [name, content] of Object.entries(entries)) {
      zip.addBuffer(Buffer.from(content), name);
    }
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });

const assertNoBinary = (payload: OfficeExtractPayload) => {
  const text = `${payload.outline}\n${payload.body}\n${payload.error ?? ''}`;
  assert.ok(!text.includes('PK\u0003\u0004'));
  assert.ok(!/[\u0000-\u0008]/.test(text));
};

const buildPdf = (pageText: string): Buffer => {
  const stream = pageText ? `BT /F1 24 Tf 100 100 Td (${pageText}) Tj ET\n` : '';
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}endstream\nendobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer);
};

suite('officeExtract', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('xlsx extracts strings and an Excel date, without zip bytes', async () => {
    const bytes = await zipEntries({
      'xl/workbook.xml':
        '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml':
        '<sst><si><t>Name</t></si><si><t>Value</t></si><si><t>Alice</t></si></sst>',
      'xl/styles.xml':
        '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>1</v></c></row></sheetData></worksheet>',
    });
    assert.strictEqual(bytes[0], 0x50); // PK
    const payload = await extractOfficeBuffer(bytes, 'report.xlsx');
    assertNoBinary(payload);
    assert.ok(payload.outline.includes('Data (2 rows x 2 cols)'));
    assert.ok(payload.body.includes('Name\tValue'));
    assert.ok(payload.body.includes('Alice\t1900-01-01'));
    assert.strictEqual(payload.truncated, false);
  });

  test('docx extracts a heading and a table', async () => {
    const bytes = await zipEntries({
      'word/document.xml':
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    });
    const payload = await extractOfficeBuffer(bytes, 'notes.docx');
    assertNoBinary(payload);
    assert.ok(payload.body.includes('# Title'));
    assert.ok(payload.body.includes('A\tB'));
  });

  test('pptx extracts slide text and speaker notes', async () => {
    const bytes = await zipEntries({
      'ppt/slides/slide1.xml':
        '<p:sld><p:spTree><a:p><a:t>Hello slide</a:t></a:p></p:spTree></p:sld>',
      'ppt/slides/_rels/slide1.xml.rels':
        '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
      'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:t>Say this</a:t></a:p></p:notes>',
    });
    const payload = await extractOfficeBuffer(bytes, 'deck.pptx');
    assertNoBinary(payload);
    assert.ok(payload.outline.includes('Slides: 1'));
    assert.ok(payload.body.includes('Hello slide'));
    assert.ok(payload.body.includes('Say this'));
  });

  test('pdf with a text layer returns that text', async () => {
    const payload = await extractOfficeBuffer(buildPdf('Hello PDF'), 'spec.pdf');
    assertNoBinary(payload);
    assert.ok(payload.outline.includes('Pages: 1'));
    assert.ok(payload.body.includes('Hello PDF'));
    assert.ok(!payload.body.includes('scan'));
  });

  test('pdf without text says there is no text layer', async () => {
    const payload = await extractOfficeBuffer(buildPdf(''), 'scan.pdf');
    assertNoBinary(payload);
    assert.ok(payload.outline.includes('Pages: 1'));
    assert.ok(payload.body.includes('No text layer'));
  });

  test('a broken zip does not leak binary into the result', async () => {
    const payload = await extractOfficeBuffer(
      Buffer.from('PK\u0003\u0004not-a-zip'),
      'broken.xlsx',
    );
    assertNoBinary(payload);
    assert.ok(payload.error);
    assert.ok(payload.outline.includes('broken.xlsx'));
  });

  test('extract cap keeps the sheet outline', async () => {
    const rows = Array.from(
      { length: 30 },
      (_, i) =>
        `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${'x'.repeat(40)}</t></is></c></row>`,
    ).join('');
    const bytes = await zipEntries({
      'xl/workbook.xml':
        '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><dimension ref="A1:A30"/><sheetData>${rows}</sheetData></worksheet>`,
    });
    const payload = await extractOfficeBuffer(bytes, 'big.xlsx', { charCap: 80 });
    assert.strictEqual(payload.truncated, true);
    assert.ok(payload.outline.includes('Data (30 rows x 1 cols)'));
    const page = formatOfficePage(payload, 1, 50);
    assert.ok(page.fileContents.includes('Data (30 rows x 1 cols)'));
    assert.ok(page.fileContents.includes('size limit') || page.hasNextPage);
  });

  test('later pages still include the outline', () => {
    const payload: OfficeExtractPayload = {
      kind: 'xlsx',
      outline: '# book.xlsx\nSheets: Data (1 rows x 1 cols)',
      body: 'A'.repeat(100),
      truncated: false,
    };
    const page = formatOfficePage(payload, 2, 40);
    assert.ok(page.fileContents.startsWith('# book.xlsx'));
    assert.strictEqual(page.hasNextPage, true);
    assert.ok(page.fileContents.includes('page_number'));
    assert.ok(!page.fileContents.includes('A'.repeat(41)));
  });

  test('legacy and oversized files are a short message, not bytes', () => {
    const legacy = legacyOfficePayload('/tmp/old.xls');
    assert.ok(legacy.error?.includes('.xls'));
    assert.strictEqual(legacy.body, '');
    const big = tooLargeOfficePayload('/tmp/huge.xlsx');
    const page = formatOfficePage(big, 1, 100);
    assert.ok(page.fileContents.includes('25 MB'));
    assert.strictEqual(page.hasNextPage, false);
    assertNoBinary(big);
  });
});
