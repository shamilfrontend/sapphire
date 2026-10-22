/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type {
  ProjectIndexEdgeRecord,
  ProjectIndexEdgeType,
  ProjectIndexFileRecord,
  ProjectIndexLayer,
  ProjectIndexSymbolRecord,
} from './projectIndexTypes.js';

const MAX_LISTED = 40;
const DEFAULT_MAX_HOPS = 2;

export type ProjectIndexImpactHit = {
  path: string;
  symbol?: string;
  via: ProjectIndexEdgeType;
  hops: number;
};

export type ProjectIndexImpact = {
  changedPaths: string[];
  changedSymbols: ProjectIndexSymbolRecord[];
  affected: ProjectIndexImpactHit[];
  layers: ProjectIndexLayer[];
  maxHops: number;
};

export function buildProjectIndexImpact(opts: {
  changedPaths: string[];
  files: ProjectIndexFileRecord[];
  symbols: ProjectIndexSymbolRecord[];
  edges: ProjectIndexEdgeRecord[];
  maxHops?: number;
}): ProjectIndexImpact {
  const maxHops = Math.max(1, opts.maxHops ?? DEFAULT_MAX_HOPS);
  const changed = new Set(opts.changedPaths.map(normalizeIndexPath).filter(Boolean));
  const changedPaths = [...changed].sort();
  const changedSymbols = opts.symbols
    .filter((symbol) => changed.has(normalizeIndexPath(symbol.path)))
    .slice(0, MAX_LISTED);

  type Link = { other: string; via: ProjectIndexEdgeType; symbol?: string };
  const adjacency = new Map<string, Link[]>();
  const link = (from: string, item: Link) => {
    const list = adjacency.get(from) ?? [];
    list.push(item);
    adjacency.set(from, list);
  };
  for (const edge of opts.edges) {
    if (edge.type === 'contains') {
      continue;
    }
    const from = normalizeIndexPath(edge.fromPath);
    const to = normalizeIndexPath(edge.toPath);
    if (!from || !to || from === to) {
      continue;
    }
    link(from, { other: to, via: edge.type, symbol: edge.toSymbol });
    link(to, { other: from, via: edge.type, symbol: edge.fromSymbol });
  }

  const seen = new Set<string>(changed);
  const affected: ProjectIndexImpactHit[] = [];
  let frontier = [...changed];
  for (let hop = 1; hop <= maxHops && frontier.length > 0 && affected.length < MAX_LISTED; hop++) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const item of adjacency.get(path) ?? []) {
        if (seen.has(item.other)) {
          continue;
        }
        seen.add(item.other);
        next.push(item.other);
        if (affected.length < MAX_LISTED) {
          affected.push({
            path: item.other,
            symbol: item.symbol,
            via: item.via,
            hops: hop,
          });
        }
      }
    }
    frontier = next;
  }

  affected.sort(
    (a, b) => a.hops - b.hops || a.path.localeCompare(b.path) || (a.symbol ?? '').localeCompare(b.symbol ?? ''),
  );

  const layerPaths = new Set<string>([...changed, ...affected.map((hit) => hit.path)]);
  const layers = new Set<ProjectIndexLayer>();
  for (const file of opts.files) {
    if (layerPaths.has(normalizeIndexPath(file.path)) && file.layer) {
      layers.add(file.layer);
    }
  }

  return {
    changedPaths,
    changedSymbols,
    affected,
    layers: [...layers].sort(),
    maxHops,
  };
}

export function formatProjectIndexImpact(impact: ProjectIndexImpact): string {
  if (impact.changedPaths.length === 0) {
    return 'No changed paths.';
  }
  const lines: string[] = ['Changed files:'];
  for (const path of impact.changedPaths) {
    lines.push(`- ${path}`);
  }
  lines.push('Changed symbols:');
  if (impact.changedSymbols.length === 0) {
    lines.push('- (none in index)');
  } else {
    for (const symbol of impact.changedSymbols) {
      lines.push(`- ${symbol.symbolName} (${symbol.path}:${symbol.startLine}-${symbol.endLine})`);
    }
  }
  lines.push(`Affected (≤${impact.maxHops} hops):`);
  if (impact.affected.length === 0) {
    lines.push('- none');
  } else {
    for (const hit of impact.affected) {
      const symbol = hit.symbol ? ` ${hit.symbol}` : '';
      lines.push(`- ${hit.path}${symbol} via ${hit.via} (${hit.hops} hop${hit.hops === 1 ? '' : 's'})`);
    }
  }
  lines.push(`Layers: ${impact.layers.length ? impact.layers.join(', ') : 'none'}`);
  return lines.join('\n');
}

function normalizeIndexPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^"(.*)"$/, '$1');
}
