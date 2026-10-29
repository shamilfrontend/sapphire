/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
  ProjectIndexChunkRecord,
  ProjectIndexFileRecord,
  ProjectIndexSearchHit,
  ProjectIndexSymbolRecord,
} from './projectIndexTypes.js';

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9а-яё_+.-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export function searchProjectIndex(opts: {
  query: string;
  files: ProjectIndexFileRecord[];
  chunks: ProjectIndexChunkRecord[];
  symbols: ProjectIndexSymbolRecord[];
  pageNumber: number;
  pageSize?: number;
}): { hits: ProjectIndexSearchHit[]; hasNextPage: boolean } {
  const pageSize = opts.pageSize ?? 20;
  const tokens = tokenize(opts.query);
  if (tokens.length === 0) {
    return { hits: [], hasNextPage: false };
  }

  const chunkByPath = new Map<string, ProjectIndexChunkRecord[]>();
  for (const c of opts.chunks) {
    const list = chunkByPath.get(c.path) ?? [];
    list.push(c);
    chunkByPath.set(c.path, list);
  }
  const symbolsByPath = new Map<string, ProjectIndexSymbolRecord[]>();
  for (const s of opts.symbols) {
    const list = symbolsByPath.get(s.path) ?? [];
    list.push(s);
    symbolsByPath.set(s.path, list);
  }

  // Веса токенов: path > purpose > role > tags > when > symbols > текст чанков
  const scored: ProjectIndexSearchHit[] = [];
  for (const file of opts.files) {
    let score = 0;
    let bestAnchor: string | null = null;
    const pathLower = file.path.toLowerCase();
    const purpose = (file.purpose ?? '').toLowerCase();
    const role = (file.localRole ?? '').toLowerCase();
    const tags = (file.tags ?? []).map((t) => t.toLowerCase()).join(' ');
    const when = (file.whenUseful ?? '').toLowerCase();

    for (const t of tokens) {
      if (pathLower.includes(t)) {
        score += 12;
      }
      if (purpose.includes(t)) {
        score += 10;
      }
      if (role.includes(t)) {
        score += 7;
      }
      if (tags.includes(t)) {
        score += 6;
      }
      if (when.includes(t)) {
        score += 5;
      }
    }

    for (const sym of symbolsByPath.get(file.path) ?? []) {
      const name = sym.symbolName.toLowerCase();
      for (const t of tokens) {
        if (name.includes(t)) {
          score += 8;
          bestAnchor = `${sym.startLine}-${sym.endLine}`;
        }
      }
    }

    for (const chunk of chunkByPath.get(file.path) ?? []) {
      const text = chunk.text.toLowerCase();
      for (const t of tokens) {
        if (text.includes(t)) {
          score += 3;
          if (!bestAnchor) {
            bestAnchor = chunk.anchor;
          }
        }
      }
    }

    if (score > 0) {
      scored.push({
        path: file.path,
        score,
        purpose: file.purpose ?? null,
        localRole: file.localRole,
        tags: file.tags ?? [],
        anchor: bestAnchor,
        kind: file.kind,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const start = Math.max(0, (opts.pageNumber - 1) * pageSize);
  const page = scored.slice(start, start + pageSize);
  return { hits: page, hasNextPage: start + pageSize < scored.length };
}
