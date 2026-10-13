/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { officeKindFromPath } from '../office/officeDocument.js';
import { LEGACY_WORKSPACE_DOT_DIR, WORKSPACE_DOT_DIR, isUnderWorkspaceStateDir } from '../workspaceDotDir.js';
import type {
  ProjectIndexChunkRecord,
  ProjectIndexEdgeRecord,
  ProjectIndexFileKind,
  ProjectIndexSymbolRecord,
} from './projectIndexTypes.js';

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.build',
  '.next',
  'coverage',
  WORKSPACE_DOT_DIR,
  LEGACY_WORKSPACE_DOT_DIR,
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'target',
]);

const CODE_EXTS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'java',
  'kt',
  'cs',
  'cpp',
  'c',
  'h',
  'hpp',
  'rb',
  'php',
  'swift',
  'scala',
  'vue',
  'svelte',
  'css',
  'scss',
  'less',
  'html',
  'json',
  'yml',
  'yaml',
  'toml',
  'md',
  'sh',
  'bash',
  'zsh',
  'sql',
]);

const BINARY_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'mp4',
  'mp3',
  'wav',
  'zip',
  'gz',
  'tar',
  '7z',
  'exe',
  'dll',
  'so',
  'dylib',
  'wasm',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'bin',
]);

const SECRET_PATH_RE = /(^|\/)(\.env($|\.)|.*credentials.*|.*secrets?.*|.*\.pem$|.*\.key$)/i;

export function shouldSkipDirName(name: string): boolean {
  return SKIP_DIR_NAMES.has(name);
}

export function isSecretPath(relPath: string): boolean {
  return SECRET_PATH_RE.test(relPath.replace(/\\/g, '/'));
}

function basenameOf(relPath: string): string {
  const norm = relPath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function parentDirOf(relPath: string): string {
  const norm = relPath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(0, i) : '';
}

function extOf(relPath: string): string {
  const name = basenameOf(relPath);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function kindFromPath(relPath: string): ProjectIndexFileKind | null {
  const office = officeKindFromPath(relPath);
  if (office === 'xlsx' || office === 'docx' || office === 'pptx' || office === 'pdf') {
    return office;
  }
  if (office === 'legacy') {
    return null;
  }
  const ext = extOf(relPath);
  if (!ext || BINARY_EXTS.has(ext)) {
    return null;
  }
  if (ext === 'csv') {
    return 'csv';
  }
  if (CODE_EXTS.has(ext)) {
    return 'code';
  }
  return 'other';
}

export function shouldSkipPath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  if (isSecretPath(norm)) {
    return true;
  }
  const parts = norm.split('/');
  for (const part of parts) {
    if (SKIP_DIR_NAMES.has(part)) {
      return true;
    }
  }
  if (isUnderWorkspaceStateDir(norm)) {
    return true;
  }
  return kindFromPath(norm) === null;
}

/** Достаёт первый JSON-объект из ответа LLM (игнорирует хвост после `}`). */
export function parsePurposeLlmJson(fullText: string): {
  purpose?: string;
  tags?: string[];
  when_useful?: string;
} {
  const start = fullText.indexOf('{');
  if (start < 0) {
    throw new Error('No JSON in purpose response');
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < fullText.length; i++) {
    const ch = fullText[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(fullText.slice(start, i + 1)) as {
          purpose?: string;
          tags?: string[];
          when_useful?: string;
        };
      }
    }
  }
  throw new Error('No JSON in purpose response');
}

export function formatProjectIndexError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) {
      return msg;
    }
    try {
      return JSON.stringify(err);
    } catch {
      // fall through
    }
  }
  return 'Unknown error';
}

/** Простой отпечаток содержимого (не криптографический) для инвалидации кэша файла. */
export function contentHash(text: string, mtime: number, size: number): string {
  let h = 2166136261;
  const sample = text.length > 8000 ? text.slice(0, 4000) + text.slice(-4000) : text;
  for (let i = 0; i < sample.length; i++) {
    h ^= sample.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(16)}:${mtime}:${size}:${text.length}`;
}

export function localRoleFromPath(relPath: string, symbolNames: string[] = []): string {
  const base = basenameOf(relPath);
  const parent = parentDirOf(relPath);
  const parentLabel = parent ? parent.split('/').slice(-2).join('/') : '';
  const symbols = symbolNames.slice(0, 6).join(', ');
  if (symbols) {
    return parentLabel ? `${parentLabel}/${base}: ${symbols}` : `${base}: ${symbols}`;
  }
  return parentLabel ? `${parentLabel}/${base}` : base;
}

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"])/g;

function extractImportSpecs(source: string): string[] {
  const out: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source))) {
    const spec = m[1] || m[2] || m[3];
    if (spec) {
      out.push(spec);
    }
  }
  return out;
}

function resolveRelativeImport(
  fromRelPath: string,
  spec: string,
  existingPaths: Set<string>,
): string | null {
  if (!spec.startsWith('.')) {
    return null;
  }
  const fromDir = parentDirOf(fromRelPath);
  const joined = normalizeRelPath(fromDir ? `${fromDir}/${spec}` : spec);
  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}.mjs`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
    `${joined}/index.js`,
  ];
  for (const c of candidates) {
    if (existingPaths.has(c)) {
      return c;
    }
  }
  return null;
}

function normalizeRelPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

const EXPORT_NAME_RE =
  /(?:export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+)([A-Za-z_$][\w$]*)/g;

function extractExportNames(source: string): string[] {
  const names: string[] = [];
  EXPORT_NAME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPORT_NAME_RE.exec(source))) {
    if (m[1]) {
      names.push(m[1]);
    }
  }
  return names.slice(0, 20);
}

export function analyzeTextFile(opts: {
  relPath: string;
  text: string;
  existingPaths: Set<string>;
}): {
  localRole: string;
  chunks: ProjectIndexChunkRecord[];
  symbols: ProjectIndexSymbolRecord[];
  edges: ProjectIndexEdgeRecord[];
} {
  const { relPath, text, existingPaths } = opts;
  const exportNames = extractExportNames(text);
  const localRole = localRoleFromPath(relPath, exportNames);
  const chunks: ProjectIndexChunkRecord[] = [
    {
      path: relPath,
      anchor: '1-' + Math.min(40, text.split('\n').length),
      text: text.slice(0, 1200),
    },
  ];
  const symbols: ProjectIndexSymbolRecord[] = exportNames.map((name, i) => ({
    path: relPath,
    symbolName: name,
    kind: 'export',
    startLine: i + 1,
    endLine: i + 1,
  }));
  const edges: ProjectIndexEdgeRecord[] = [];
  for (const spec of extractImportSpecs(text)) {
    const toPath = resolveRelativeImport(relPath, spec, existingPaths);
    if (toPath) {
      edges.push({ fromPath: relPath, toPath });
    }
  }
  return { localRole, chunks, symbols, edges };
}

export function analyzeCsv(relPath: string, text: string): {
  localRole: string;
  chunks: ProjectIndexChunkRecord[];
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0] ?? '';
  const sample = lines.slice(0, 3).join('\n');
  return {
    localRole: `CSV ${basenameOf(relPath)}: ${header.slice(0, 120)}`,
    chunks: [{ path: relPath, anchor: 'header', text: sample.slice(0, 1500) }],
  };
}

export function analyzeOfficeText(relPath: string, kind: ProjectIndexFileKind, outline: string, body: string): {
  localRole: string;
  chunks: ProjectIndexChunkRecord[];
} {
  const localRole = `${kind.toUpperCase()} ${basenameOf(relPath)}: ${outline.replace(/\n/g, ' ').slice(0, 160)}`;
  const chunks: ProjectIndexChunkRecord[] = [
    { path: relPath, anchor: 'outline', text: outline.slice(0, 1500) },
  ];
  if (body) {
    const pages = body.split(/\n(?=# |\*{3}|Sheet:|Page |Slide )/i);
    const parts = pages.length > 1 ? pages : [body];
    for (let i = 0; i < Math.min(parts.length, 12); i++) {
      chunks.push({
        path: relPath,
        anchor: `part-${i + 1}`,
        text: parts[i].slice(0, 1000),
      });
    }
  }
  return { localRole, chunks };
}
