/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractSearchReplaceBlocks } from '../../common/helpers/extractCodeFromResult.js';
import { matchSearchReplaceBlocks } from '../../common/searchReplaceMatch.js';
import { officePlainText, pdfScanWriteError } from '../../common/office/officeDocument.js';
import { extractOfficeBuffer } from './extractOfficeBuffer.js';
import type { RecognizeScan } from './ocrPdf.js';

type PdfLibFont = {
  widthOfTextAtSize(text: string, size: number): number;
};

type PdfLibPage = {
  drawText(
    text: string,
    opts: { x: number; y: number; size: number; font: PdfLibFont; color: unknown },
  ): void;
};

type PdfLibDoc = {
  registerFontkit(fontkit: unknown): void;
  embedFont(bytes: Uint8Array): Promise<PdfLibFont>;
  addPage(size?: [number, number]): PdfLibPage;
  save(): Promise<Uint8Array>;
};

type PdfLibModule = {
  PDFDocument: {
    create(): Promise<PdfLibDoc>;
  };
  rgb: (r: number, g: number, b: number) => unknown;
};

let pdfLibModule: PdfLibModule | undefined;
let fontkitModule: unknown | undefined;
let fontBytesCache: Uint8Array | undefined;

async function loadPdfLib(): Promise<{ pdfLib: PdfLibModule; fontkit: unknown }> {
  if (!pdfLibModule) {
    pdfLibModule = (await import('pdf-lib')) as PdfLibModule;
  }
  if (!fontkitModule) {
    const mod = await import('@pdf-lib/fontkit');
    fontkitModule = (mod as { default?: unknown }).default ?? mod;
  }
  return { pdfLib: pdfLibModule, fontkit: fontkitModule };
}

async function loadFontBytes(): Promise<Uint8Array> {
  if (fontBytesCache) {
    return fontBytesCache;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'fonts', 'NotoSans-Regular.ttf'),
    join(
      here,
      '..',
      '..',
      '..',
      '..',
      '..',
      '..',
      'src',
      'vs',
      'workbench',
      'contrib',
      'sapphire',
      'node',
      'office',
      'fonts',
      'NotoSans-Regular.ttf',
    ),
  ];
  for (const path of candidates) {
    try {
      fontBytesCache = await fs.readFile(path);
      return fontBytesCache;
    } catch {
      // try next
    }
  }
  throw new Error('Bundled PDF font NotoSans-Regular.ttf was not found.');
}

function wrapLines(text: string, font: PdfLibFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n/g, '\n').split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/(\s+)/);
    let current = '';
    for (const word of words) {
      const next = current + word;
      if (current && font.widthOfTextAtSize(next, fontSize) > maxWidth) {
        lines.push(current);
        current = word.trimStart();
      } else {
        current = next;
      }
    }
    if (current.length > 0 || paragraph.length === 0) {
      lines.push(current);
    }
  }
  return lines;
}

export async function createPdfFromText(text: string): Promise<Uint8Array> {
  const { pdfLib, fontkit } = await loadPdfLib();
  const fontBytes = await loadFontBytes();
  const pdfDoc = await pdfLib.PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes);
  const fontSize = 12;
  const margin = 50;
  const pageWidth = 595;
  const pageHeight = 842;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = fontSize * 1.35;
  const lines = wrapLines(text, font, fontSize, maxWidth);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  for (const line of lines) {
    if (y < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    if (line.length > 0) {
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: pdfLib.rgb(0, 0, 0),
      });
    }
    y -= lineHeight;
  }
  return pdfDoc.save();
}

/**
 * Apply SEARCH/REPLACE to extracted PDF text, then rebuild a text PDF.
 * Overlaying new glyphs on the old stream leaves old text operators (extract
 * would still see them), so a rebuild is the reliable agent round-trip.
 */
export async function editPdfTextLayer(
	bytes: Uint8Array,
	searchReplaceBlocks: string,
	fileName: string,
	opts?: { recognizeScan?: RecognizeScan },
): Promise<Uint8Array> {
	const extracted = await extractOfficeBuffer(
		Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
		fileName,
		opts?.recognizeScan ? { recognizeScan: opts.recognizeScan } : undefined,
	);
	if (extracted.error) {
		throw new Error(extracted.error);
	}
	const scanError = pdfScanWriteError(extracted, fileName);
	if (scanError || !extracted.body.trim()) {
		throw new Error(
			scanError ??
				`${fileName} has no text layer (looks like a scan). Recognized text can be read, but edit_file and rewrite_file cannot change this PDF.`,
		);
	}
  const searchable = officePlainText(extracted);

  const blocks = extractSearchReplaceBlocks(searchReplaceBlocks);
  const matched = matchSearchReplaceBlocks(searchable, blocks);
  if (!matched.ok) {
    throw new Error(matched.message);
  }

  const fileLines = searchable.replace(/\r\n/g, '\n').split('\n');
  const ordered = [...matched.replacements].sort((a, b) => b.startLine - a.startLine);
  for (const block of ordered) {
    const before = fileLines.slice(0, block.startLine - 1);
    const after = fileLines.slice(block.endLine);
    const finalLines = block.final.replace(/\r\n/g, '\n').split('\n');
    const nextLines = [...before, ...finalLines, ...after];
    fileLines.length = 0;
    fileLines.push(...nextLines);
  }

  const bodyOnly = fileLines
    .filter(
      (line) =>
        !/^# .+\.pdf\s*$/i.test(line) &&
        !/^Pages:\s*\d+\s*$/i.test(line) &&
        !/^## Page \d+\s*$/.test(line),
    )
    .join('\n')
    .replace(/^\n+/, '');

  return createPdfFromText(bodyOnly.trimEnd() + '\n');
}

export async function rewritePdfFromText(newContent: string): Promise<Uint8Array> {
  return createPdfFromText(newContent);
}
