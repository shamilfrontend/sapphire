/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	OFFICE_EXTRACT_CHAR_CAP,
	OfficeExtractPayload,
	PDF_NO_TEXT_LAYER,
	officeFileName,
	officeKindFromPath,
	pdfOcrFailedBody,
} from '../../common/office/officeDocument.js';
import { formatOfficeExtract } from '../../common/office/officeModel.js';
import { readOfficeModel } from './readOfficeModel.js';
import {
	PDF_OCR_MAX_PAGES,
	PDF_OCR_TAIL_NOTE,
	RecognizeScan,
	collectPagePngs,
	recognizePngPages,
	type OcrPdfPage,
	type PdfJsOps,
} from './ocrPdf.js';

type ExtractOfficeOptions = {
	charCap?: number;
	/** Подмена OCR в тестах. В проде страницы распознаёт tesseract (rus+eng). */
	recognizeScan?: RecognizeScan;
};

class BodyWriter {
  private readonly parts: string[] = [];
  private len = 0;
  truncated = false;

  constructor(private readonly cap: number) {}

  push(chunk: string): boolean {
    if (this.truncated || !chunk) {
      return !this.truncated;
    }
    if (this.len + chunk.length > this.cap) {
      const room = this.cap - this.len;
      if (room > 0) {
        this.parts.push(chunk.slice(0, room));
      }
      this.len = this.cap;
      this.truncated = true;
      return false;
    }
    this.parts.push(chunk);
    this.len += chunk.length;
    return true;
  }

  text(): string {
    return this.parts.join('');
  }
}

function safeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const clean = msg.replace(/[^\t\n\r\x20-\x7E\u00A0-\uFFFF]/g, '').slice(0, 200);
  return clean ? `Could not parse office file: ${clean}` : 'Could not parse office file.';
}

type PdfTextItem = { str?: string; hasEOL?: boolean };
type PdfPage = OcrPdfPage & {
	getTextContent(): Promise<{ items: PdfTextItem[] }>;
};
type PdfDocument = {
	numPages: number;
	getPage(n: number): Promise<PdfPage>;
	destroy(): Promise<void> | void;
};
type PdfJsModule = {
	getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocument> };
	OPS: PdfJsOps;
};

let pdfJsModule: PdfJsModule | undefined;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModule) {
    const withResolvers = (Promise as unknown as { withResolvers?: unknown }).withResolvers;
    if (typeof withResolvers !== 'function') {
      Object.defineProperty(Promise, 'withResolvers', {
        value() {
          let resolve!: (value: unknown) => void;
          let reject!: (reason?: unknown) => void;
          const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
          });
          return { promise, resolve, reject };
        },
      });
    }
    const specifier: string = 'pdfjs-dist/legacy/build/pdf.mjs';
    pdfJsModule = (await import(specifier)) as PdfJsModule;
  }
  return pdfJsModule;
}

function noTextLayerPayload(fileName: string, pageCount: number): OfficeExtractPayload {
	return {
		kind: 'pdf',
		outline: `# ${fileName}\nPages: ${pageCount}`,
		body: PDF_NO_TEXT_LAYER,
		truncated: false,
	};
}

function ocrFailedPayload(fileName: string, pageCount: number, err: unknown): OfficeExtractPayload {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`[sapphire-office] PDF OCR failed for ${fileName}:`, message);
	return {
		kind: 'pdf',
		outline: `# ${fileName}\nPages: ${pageCount}`,
		body: pdfOcrFailedBody(message),
		truncated: false,
	};
}

async function ocrPdf(
	doc: PdfDocument,
	ops: PdfJsOps,
	fileName: string,
	cap: number,
	recognizeScan: RecognizeScan | undefined,
): Promise<OfficeExtractPayload> {
	const outline = `# ${fileName}\nPages: ${doc.numPages}`;
	let texts: readonly string[];
	try {
		const pngs = await collectPagePngs(doc, ops, PDF_OCR_MAX_PAGES);
		const hasBitmap = pngs.some((page) => page && page.byteLength > 0);
		if (!recognizeScan && !hasBitmap) {
			return noTextLayerPayload(fileName, doc.numPages);
		}
		texts = recognizeScan ? await recognizeScan(pngs) : await recognizePngPages(pngs);
	} catch (err) {
		return ocrFailedPayload(fileName, doc.numPages, err);
	}
	const pageCount = Math.min(doc.numPages, PDF_OCR_MAX_PAGES);
	const body = new BodyWriter(cap);
	let anyText = false;
	for (let i = 0; i < pageCount; i++) {
		const text = (texts[i] ?? '').trim();
		if (text) {
			anyText = true;
		}
		if (!body.push(`## Page ${i + 1}\n${text}\n\n`)) {
			break;
		}
	}
	if (doc.numPages > PDF_OCR_MAX_PAGES) {
		body.push(`${PDF_OCR_TAIL_NOTE}\n`);
	}
	if (!anyText && !body.truncated) {
		return noTextLayerPayload(fileName, doc.numPages);
	}
	return {
		kind: 'pdf',
		outline,
		body: body.text().trimEnd(),
		truncated: body.truncated,
		textOrigin: 'ocr',
	};
}

async function extractPdf(
	bytes: Buffer,
	fileName: string,
	cap: number,
	recognizeScan: RecognizeScan | undefined,
): Promise<OfficeExtractPayload> {
	const pdfjs = await loadPdfJs();
	const doc = await pdfjs.getDocument({
		data: new Uint8Array(bytes),
		verbosity: 0,
		isEvalSupported: false,
		disableFontFace: true,
		useSystemFonts: false,
	}).promise;
	try {
		const body = new BodyWriter(cap);
		let anyText = false;
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const content = await page.getTextContent();
			const text = content.items
				.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`)
				.join('')
				.replace(/[ \t]+\n/g, '\n')
				.replace(/[ \t]{2,}/g, ' ')
				.trim();
			if (text) {
				anyText = true;
			}
			if (!body.push(`## Page ${i}\n${text}\n\n`)) {
				break;
			}
		}
		const outline = `# ${fileName}\nPages: ${doc.numPages}`;
		if (!anyText && !body.truncated) {
			return await ocrPdf(doc, pdfjs.OPS, fileName, cap, recognizeScan);
		}
		return {
			kind: 'pdf',
			outline,
			body: body.text().trimEnd(),
			truncated: body.truncated,
			textOrigin: 'layer',
		};
	} finally {
		try {
			await doc.destroy();
		} catch {
			/* освобождение pdf.js worker — по возможности */
		}
	}
}

/** Разбор буфера в памяти; лимит 25 МБ на диске здесь не проверяется. */
export async function extractOfficeBuffer(
  bytes: Buffer,
  fileName: string,
  opts?: ExtractOfficeOptions,
): Promise<OfficeExtractPayload> {
  const name = officeFileName(fileName);
  const kind = officeKindFromPath(name);
  if (!kind || kind === 'legacy') {
    return {
      kind: 'legacy',
      outline: '',
      body: '',
      truncated: false,
      error: `Format is not read. Save the file as .xlsx, .docx, .pptx, or .pdf.`,
    };
  }
  const cap = opts?.charCap ?? OFFICE_EXTRACT_CHAR_CAP;
  try {
		if (kind === 'pdf') {
			return await extractPdf(bytes, name, cap, opts?.recognizeScan);
		}
    const model = await readOfficeModel(bytes, name);
    return formatOfficeExtract(model, cap);
  } catch (e) {
    return {
      kind,
      outline: `# ${name}`,
      body: '',
      truncated: false,
      error: safeError(e),
    };
  }
}
