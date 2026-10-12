/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Файлы больше этого размера не парсятся. */
export const OFFICE_MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Лимит извлечённого body. Несколько страниц `read_file` (MAX_FILE_CHARS_PAGE = 500_000).
 * Outline сохраняется даже при достижении лимита body.
 */
export const OFFICE_EXTRACT_CHAR_CAP = 2_000_000;

export type OfficeKind = 'xlsx' | 'docx' | 'pptx' | 'pdf' | 'legacy';

export type OfficeExtractPayload = {
  kind: OfficeKind;
  /** Список листов / число страниц / слайдов — на каждой странице read_file. */
  outline: string;
  /** Извлечённый body. Пустой при `error`. */
  body: string;
  /** true, если парсинг обрезан по `OFFICE_EXTRACT_CHAR_CAP`. */
  truncated: boolean;
  /** Заполнено, если файл не распарсен (legacy, слишком большой, нечитаемый). */
  error?: string;
};

const MODERN: Record<string, OfficeKind> = {
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  docx: 'docx',
  pptx: 'pptx',
  pdf: 'pdf',
};

/** Расширения для `<input accept>` и picker (только modern office). */
export const OFFICE_FILE_ACCEPT = Object.keys(MODERN)
  .map((ext) => `.${ext}`)
  .join(',');

const LEGACY = new Set(['doc', 'xls', 'ppt']);

export function officeFileName(fsPath: string): string {
  const norm = fsPath.replace(/\\/g, '/');
  const slash = norm.lastIndexOf('/');
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

function officeExtension(fsPath: string): string {
  const name = officeFileName(fsPath);
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return '';
  }
  return name.slice(dot).toLowerCase();
}

/** `null` — обычный text/code; office parser не используем. */
export function officeKindFromPath(fsPath: string): OfficeKind | null {
  const name = officeFileName(fsPath);
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return null;
  }
  const ext = name.slice(dot + 1).toLowerCase();
  if (MODERN[ext]) {
    return MODERN[ext];
  }
  if (LEGACY.has(ext)) {
    return 'legacy';
  }
  return null;
}

export function legacyOfficePayload(fsPath: string): OfficeExtractPayload {
  const ext = officeExtension(fsPath) || '.legacy';
  return {
    kind: 'legacy',
    outline: '',
    body: '',
    truncated: false,
    error: `Format ${ext} is not read. Save the file as .xlsx, .docx, .pptx, or .pdf.`,
  };
}

export function tooLargeOfficePayload(fsPath: string): OfficeExtractPayload {
  const kind = officeKindFromPath(fsPath);
  return {
    kind: kind && kind !== 'legacy' ? kind : 'xlsx',
    outline: `# ${officeFileName(fsPath)}`,
    body: '',
    truncated: false,
    error: `File is larger than 25 MB and was not parsed.`,
  };
}

export function officePlainText(payload: OfficeExtractPayload): string {
  return [payload.outline, payload.error, payload.body].filter((part) => !!part).join('\n\n');
}

const NEXT_PAGE_NOTE = '(more on next page: call read_file with a higher page_number)';
const EXTRACT_CAP_NOTE = '(extracted text was cut at the size limit)';

/**
 * Одна «страница» office extract; outline на каждой странице.
 * `startLine` / `endLine` режут body как `read_file` для текстового файла.
 */
export function formatOfficePage(
  payload: OfficeExtractPayload,
  pageNumber: number,
  pageChars: number,
  startLine: number | null = null,
  endLine: number | null = null,
): {
  fileContents: string;
  totalFileLen: number;
  totalNumLines: number;
  hasNextPage: boolean;
} {
  if (payload.error) {
    const fileContents = payload.outline ? `${payload.outline}\n\n${payload.error}` : payload.error;
    return {
      fileContents,
      totalFileLen: fileContents.length,
      totalNumLines: fileContents.split('\n').length,
      hasNextPage: false,
    };
  }

  let body = payload.body;
  if (startLine !== null || endLine !== null) {
    const lines = body.split('\n');
    const start = startLine === null ? 1 : startLine;
    const end = endLine === null ? lines.length : endLine;
    body = lines.slice(Math.max(0, start - 1), Math.max(0, end)).join('\n');
  }

  const page = Math.max(1, pageNumber);
  const size = Math.max(1, pageChars);
  const from = size * (page - 1);
  const slice = body.slice(from, from + size);
  const hasNextPage = from + size < body.length;
  const parts = [payload.outline, slice].filter((part) => part.length > 0);
  if (hasNextPage) {
    parts.push(NEXT_PAGE_NOTE);
  } else if (payload.truncated) {
    parts.push(EXTRACT_CAP_NOTE);
  }
  const fileContents = parts.join('\n\n');
  const full = officePlainText({ ...payload, body });
  return {
    fileContents,
    totalFileLen: full.length,
    totalNumLines: full.split('\n').length,
    hasNextPage,
  };
}
