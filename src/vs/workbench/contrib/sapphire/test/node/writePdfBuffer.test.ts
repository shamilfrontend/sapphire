/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { extractOfficeBuffer } from '../../node/office/extractOfficeBuffer.js';
import { createPdfFromText, editPdfTextLayer } from '../../node/office/writePdfBuffer.js';
import { ORIGINAL, DIVIDER, FINAL } from '../../common/prompt/prompts.js';

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

const sr = (orig: string, final: string) =>
  `${ORIGINAL}\n${orig}\n${DIVIDER}\n${final}\n${FINAL}`;

suite('writePdfBuffer', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('createPdfFromText builds a readable PDF with Cyrillic', async () => {
    const bytes = await createPdfFromText('Привет PDF\nSecond line');
    assert.ok(bytes.byteLength > 100);
    const payload = await extractOfficeBuffer(Buffer.from(bytes), 'new.pdf');
    assert.ok(payload.body.includes('Привет PDF'));
    assert.ok(payload.body.includes('Second line'));
  });

  test('editPdfTextLayer replaces a phrase and rebuilds a text PDF', async () => {
    const original = await createPdfFromText('Hello PDF');
    const next = await editPdfTextLayer(original, sr('Hello PDF', 'Hi PDF'), 'spec.pdf');
    const payload = await extractOfficeBuffer(Buffer.from(next), 'spec.pdf');
    assert.ok(payload.body.includes('Hi PDF'));
    assert.ok(!payload.body.includes('Hello PDF'));
  });

	test('editPdfTextLayer rejects a scan without text', async () => {
		await assert.rejects(
			() => editPdfTextLayer(buildPdf(''), sr('x', 'y'), 'scan.pdf'),
			/no text layer/i,
		);
	});

	test('editPdfTextLayer rejects OCR text from a scan', async () => {
		await assert.rejects(
			() => editPdfTextLayer(buildPdf(''), sr('Распознанная строка', 'Другая'), 'scan.pdf', {
				recognizeScan: async () => ['Распознанная строка'],
			}),
			/no text layer/i,
		);
	});

  test('editPdfTextLayer rejects a missing ORIGINAL', async () => {
    const original = await createPdfFromText('Hello PDF');
    await assert.rejects(
      () => editPdfTextLayer(original, sr('Missing', 'X'), 'spec.pdf'),
      /not applied|no match|Could not locate|Not found/i,
    );
  });
});
