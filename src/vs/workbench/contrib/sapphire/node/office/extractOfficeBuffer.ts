/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { Entry, ZipFile } from 'yauzl';
import { Readable } from 'stream';
import {
  OFFICE_EXTRACT_CHAR_CAP,
  OfficeExtractPayload,
  OfficeKind,
  officeFileName,
  officeKindFromPath,
} from '../../common/office/officeDocument.js';

const UNCOMPRESSED_XML_CAP = 80 * 1024 * 1024;
const MAX_SHEET_COLS = 64;

const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const BUILTIN_TIME_FMT = new Set([18, 19, 20, 21, 22, 45, 46, 47]);

type ExtractOfficeOptions = {
  charCap?: number;
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

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (ent) => {
    switch (ent) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
        return "'";
      default: {
        const hex = ent.startsWith('&#x');
        const num = parseInt(ent.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
        return Number.isFinite(num) ? String.fromCodePoint(num) : ent;
      }
    }
  });
}

function safeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const clean = msg.replace(/[^\t\n\r\x20-\x7E\u00A0-\uFFFF]/g, '').slice(0, 200);
  return clean ? `Could not parse office file: ${clean}` : 'Could not parse office file.';
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return match?.[1];
}

function colIndex(cellRef: string): number {
  const letters = /^([A-Z]+)/.exec(cellRef)?.[1];
  if (!letters) {
    return 1;
  }
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

/** Путь части workbook из .rels (Target относителен каталога части). */
function relsOwner(relsPath: string): string {
  return relsPath.replace(/\/_rels\/([^/]+)\.rels$/, '/$1');
}

function joinZip(baseFile: string, target: string): string {
  if (target.startsWith('/')) {
    return target.replace(/^\/+/, '');
  }
  const parts = baseFile.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part && part !== '.') {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function readZipXml(bytes: Buffer): Promise<Map<string, string>> {
  const yauzl = await import('yauzl');
  const zipfile = await new Promise<ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, opened) => {
      if (err || !opened) {
        reject(err ?? new Error('Could not open zip'));
      } else {
        resolve(opened);
      }
    });
  });

  const entries = new Map<string, string>();
  let uncompressed = 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (err: unknown) => {
      zipfile.close();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    zipfile.on('error', fail);
    zipfile.on('end', () => resolve());
    zipfile.on('entry', (entry: Entry) => {
      const name = entry.fileName.replace(/\\/g, '/').replace(/^\/+/, '');
      const isXml = name.endsWith('.xml') || name.endsWith('.rels');
      if (!isXml || name.endsWith('/')) {
        zipfile.readEntry();
        return;
      }
      uncompressed += entry.uncompressedSize;
      if (uncompressed > UNCOMPRESSED_XML_CAP) {
        fail(new Error('Uncompressed office XML exceeds 80 MB'));
        return;
      }
      zipfile.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          fail(err ?? new Error('Could not read zip entry'));
          return;
        }
        streamToBuffer(stream).then((buf) => {
          entries.set(name, buf.toString('utf8'));
          zipfile.readEntry();
        }, fail);
      });
    });
    zipfile.readEntry();
  });
  return entries;
}

function isDateFormatCode(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[ydhs]/i.test(stripped);
}

function formatHasTime(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /h/i.test(stripped);
}

/** Индекс стиля ячейки → дата и есть ли время; ключи map — только даты. */
function dateStyles(stylesXml: string | undefined): Map<number, boolean> {
  const dates = new Map<number, boolean>();
  if (!stylesXml) {
    return dates;
  }
  const custom = new Map<number, string>();
  for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = attr(match[1], 'numFmtId');
    const code = attr(match[1], 'formatCode');
    if (id !== undefined && code !== undefined) {
      custom.set(Number(id), decodeXml(code));
    }
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  let index = 0;
  for (const xf of xfs.matchAll(/<xf\b([^>]*)\/?>/g)) {
    const id = Number(attr(xf[1], 'numFmtId') ?? '0');
    const code = custom.get(id);
    const isDate = code !== undefined ? isDateFormatCode(code) : BUILTIN_DATE_FMT.has(id);
    if (isDate) {
      dates.set(index, code !== undefined ? formatHasTime(code) : BUILTIN_TIME_FMT.has(id));
    }
    index++;
  }
  return dates;
}

function excelSerialToString(serial: number, withTime: boolean): string {
  if (!Number.isFinite(serial)) {
    return String(serial);
  }
  const whole = Math.floor(serial);
  const fraction = serial - whole;
  const days = whole > 59 ? whole - 1 : whole;
  const date = new Date(Date.UTC(1900, 0, 1) + (days - 1) * 86_400_000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  if (!withTime || fraction < 1 / 86_400) {
    return `${y}-${m}-${d}`;
  }
  const totalSeconds = Math.round(fraction * 86_400);
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) {
    return [];
  }
  const items: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const inner = si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const texts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
    items.push(texts.join(''));
  }
  return items;
}

function cellText(
  inner: string,
  type: string | undefined,
  style: string | undefined,
  shared: string[],
  dates: Map<number, boolean>,
): string {
  const texts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
  if (type === 'inlineStr' || (type === 'str' && texts.length)) {
    return texts.join('').replace(/[\r\n]+/g, ' ');
  }
  const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (rawValue === undefined) {
    return texts.join('').replace(/[\r\n]+/g, ' ');
  }
  const raw = decodeXml(rawValue).trim();
  if (type === 's') {
    return (shared[Number(raw)] ?? '').replace(/[\r\n]+/g, ' ');
  }
  if (type === 'b') {
    return raw === '1' ? 'TRUE' : 'FALSE';
  }
  if (type === 'e') {
    return raw;
  }
  const styleIndex = style === undefined ? 0 : Number(style);
  if (dates.has(styleIndex)) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return excelSerialToString(n, dates.get(styleIndex) === true);
    }
  }
  return raw;
}

function parseDimension(xml: string): { rows: number; cols: number } | null {
  const ref = /<dimension\b[^>]*ref="([^"]+)"/.exec(xml)?.[1];
  if (!ref) {
    return null;
  }
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
  if (!match) {
    return null;
  }
  const c1 = colIndex(match[1]);
  const r1 = Number(match[2]);
  const c2 = match[3] ? colIndex(match[3]) : c1;
  const r2 = match[4] ? Number(match[4]) : r1;
  return { rows: Math.max(0, r2 - r1 + 1), cols: Math.max(0, c2 - c1 + 1) };
}

function sheetPaths(entries: Map<string, string>): { name: string; path: string }[] {
  const workbook = entries.get('xl/workbook.xml') ?? '';
  const rels = entries.get('xl/_rels/workbook.xml.rels') ?? '';
  const targets = new Map<string, string>();
  for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(rel[1], 'Id');
    const target = attr(rel[1], 'Target');
    if (id && target) {
      targets.set(id, joinZip(relsOwner('xl/_rels/workbook.xml.rels'), target));
    }
  }
  const sheets: { name: string; path: string }[] = [];
  for (const sheet of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeXml(attr(sheet[1], 'name') ?? 'Sheet');
    const rid = attr(sheet[1], 'r:id') ?? attr(sheet[1], 'id');
    const path = rid ? targets.get(rid) : undefined;
    if (path) {
      sheets.push({ name, path });
    }
  }
  if (sheets.length === 0) {
    for (const key of entries.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(key)) {
        sheets.push({ name: key, path: key });
      }
    }
    sheets.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }
  return sheets;
}

function extractXlsx(
  entries: Map<string, string>,
  fileName: string,
  cap: number,
): OfficeExtractPayload {
  const sheets = sheetPaths(entries);
  const shared = sharedStrings(entries.get('xl/sharedStrings.xml'));
  const dates = dateStyles(entries.get('xl/styles.xml'));
  const outlineParts: string[] = [];
  const body = new BodyWriter(cap);

  for (const sheet of sheets) {
    const xml = entries.get(sheet.path) ?? '';
    const dim = parseDimension(xml);
    outlineParts.push(dim ? `${sheet.name} (${dim.rows} rows x ${dim.cols} cols)` : sheet.name);
    if (body.truncated) {
      continue;
    }
    if (!body.push(`## ${sheet.name}\n`)) {
      continue;
    }
    let wroteRow = false;
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      let maxCol = 0;
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cell[1], 'r') ?? '';
        const col = colIndex(ref);
        if (col > MAX_SHEET_COLS) {
          continue;
        }
        const text = cellText(cell[2] ?? '', attr(cell[1], 't'), attr(cell[1], 's'), shared, dates);
        while (cells.length < col - 1) {
          cells.push('');
        }
        cells[col - 1] = text;
        maxCol = Math.max(maxCol, col);
      }
      if (maxCol === 0) {
        continue;
      }
      wroteRow = true;
      if (!body.push(`${cells.slice(0, maxCol).join('\t')}\n`)) {
        break;
      }
    }
    if (wroteRow) {
      body.push('\n');
    }
  }

  return {
    kind: 'xlsx',
    outline: `# ${fileName}\nSheets: ${outlineParts.join(', ') || '(none)'}`,
    body: body.text().trimEnd(),
    truncated: body.truncated,
  };
}

function paragraphText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<w:cr\b[^>]*\/>/g, '\n');
  return [...withBreaks.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((m) => decodeXml(m[1]))
    .join('');
}

function extractDocx(
  entries: Map<string, string>,
  fileName: string,
  cap: number,
): OfficeExtractPayload {
  const xml = entries.get('word/document.xml') ?? '';
  const body = new BodyWriter(cap);
  const blocks = xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  for (const block of blocks) {
    if (block.startsWith('<w:tbl')) {
      const rows: string[] = [];
      for (const row of block.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
        const cells: string[] = [];
        for (const cell of row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
          const paras = [...cell[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) =>
            paragraphText(p[0]).trim(),
          );
          cells.push(paras.filter(Boolean).join(' '));
        }
        rows.push(cells.join('\t'));
      }
      if (!body.push(`${rows.join('\n')}\n\n`)) {
        break;
      }
      continue;
    }
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(block)?.[1] ?? '';
    const text = paragraphText(block).trim();
    if (!text) {
      continue;
    }
    const heading = /^Heading(\d)$/i.exec(style);
    const line = heading ? `${'#'.repeat(Math.min(6, Number(heading[1])))} ${text}` : text;
    if (!body.push(`${line}\n\n`)) {
      break;
    }
  }
  return {
    kind: 'docx',
    outline: `# ${fileName}`,
    body: body.text().trimEnd(),
    truncated: body.truncated,
  };
}

function drawingText(xml: string): string {
  const paras = xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
  return paras
    .map((para) =>
      [...para.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(''),
    )
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function extractPptx(
  entries: Map<string, string>,
  fileName: string,
  cap: number,
): OfficeExtractPayload {
  const slides = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const body = new BodyWriter(cap);
  slides.forEach((slidePath, index) => {
    const text = drawingText(entries.get(slidePath) ?? '');
    const relsPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    const rels = entries.get(relsPath) ?? '';
    let notes = '';
    for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const type = attr(rel[1], 'Type') ?? '';
      const target = attr(rel[1], 'Target');
      if (target && type.includes('notesSlide')) {
        notes = drawingText(entries.get(joinZip(relsOwner(relsPath), target)) ?? '');
      }
    }
    const chunk = `## Slide ${index + 1}\n${text}${notes ? `\n\nNotes:\n${notes}` : ''}\n\n`;
    body.push(chunk);
  });
  return {
    kind: 'pptx',
    outline: `# ${fileName}\nSlides: ${slides.length}`,
    body: body.text().trimEnd(),
    truncated: body.truncated,
  };
}

type PdfTextItem = { str?: string; hasEOL?: boolean };
type PdfDocument = {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: PdfTextItem[] }> }>;
  destroy(): Promise<void> | void;
};
type PdfJsModule = {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocument> };
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

async function extractPdf(
  bytes: Buffer,
  fileName: string,
  cap: number,
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
      return {
        kind: 'pdf',
        outline,
        body: 'No text layer. This looks like a scan; recognition is not available.',
        truncated: false,
      };
    }
    return { kind: 'pdf', outline, body: body.text().trimEnd(), truncated: body.truncated };
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* освобождение pdf.js worker — по возможности */
    }
  }
}

function payloadOfKind(
  kind: OfficeKind,
  fileName: string,
  entries: Map<string, string>,
  cap: number,
): OfficeExtractPayload {
  if (kind === 'xlsx') {
    return extractXlsx(entries, fileName, cap);
  }
  if (kind === 'docx') {
    return extractDocx(entries, fileName, cap);
  }
  if (kind === 'pptx') {
    return extractPptx(entries, fileName, cap);
  }
  return {
    kind,
    outline: `# ${fileName}`,
    body: '',
    truncated: false,
    error: 'Could not parse office file.',
  };
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
      return await extractPdf(bytes, name, cap);
    }
    const entries = await readZipXml(bytes);
    return payloadOfKind(kind, name, entries, cap);
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
