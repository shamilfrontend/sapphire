/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProjectIndexEdgeRecord, ProjectIndexSymbolRecord } from './projectIndexTypes.js';

const SCRIPT_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts']);
const MAX_SYMBOLS = 400;

const NOT_A_CALL = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'throw',
  'do',
  'else',
  'try',
  'function',
  'class',
  'new',
  'await',
  'typeof',
  'void',
  'delete',
  'import',
  'super',
]);

const CLASS_MODIFIERS = new Set([
  'public',
  'private',
  'protected',
  'readonly',
  'static',
  'async',
  'override',
  'abstract',
  'declare',
]);

type Tok = { t: 'id' | 'str' | 'punct'; v: string; line: number };

type ImportBinding = {
  defaultLocal: string | null;
  named: Array<{ local: string; exported: string }>;
  namespace: string | null;
};

type BodyRange = {
  fromSymbol: string;
  lo: number;
  hi: number;
  className?: string;
};

export function isScriptPath(relPath: string): boolean {
  const name = basenameOf(relPath);
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return SCRIPT_EXTS.has(ext);
}

export function resolveWorkspaceSpecifier(
  fromRelPath: string,
  spec: string,
  existingPaths: Set<string>,
): string | null {
  let joined: string;
  if (spec.startsWith('.')) {
    const fromDir = parentDirOf(fromRelPath);
    joined = normalizeRelPath(fromDir ? `${fromDir}/${spec}` : spec);
  } else if (spec === 'vs' || spec.startsWith('vs/')) {
    joined = normalizeRelPath(`src/${spec}`);
  } else {
    return null;
  }
  const candidates: string[] = [];
  const push = (path: string) => {
    if (!candidates.includes(path)) {
      candidates.push(path);
    }
  };
  for (const rewritten of jsSpecifierToTsCandidates(joined)) {
    push(rewritten);
  }
  push(joined);
  push(`${joined}.ts`);
  push(`${joined}.tsx`);
  push(`${joined}.js`);
  push(`${joined}.jsx`);
  push(`${joined}.mjs`);
  push(`${joined}.cjs`);
  push(`${joined}.mts`);
  push(`${joined}.cts`);
  push(`${joined}/index.ts`);
  push(`${joined}/index.tsx`);
  push(`${joined}/index.js`);
  push(`${joined}/index.mjs`);
  for (const candidate of candidates) {
    if (existingPaths.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** `./foo.js` → `./foo.ts` / `./foo.tsx` и т.п. (как в workbench ESM). */
function jsSpecifierToTsCandidates(joined: string): string[] {
  const match = joined.match(/^(.*)\.(jsx?|mjs|cjs)$/i);
  if (!match) {
    return [];
  }
  const base = match[1];
  const ext = match[2].toLowerCase();
  const outs: string[] = [];
  if (ext === 'js') {
    outs.push(`${base}.ts`, `${base}.tsx`);
  } else if (ext === 'jsx') {
    outs.push(`${base}.tsx`);
  } else if (ext === 'mjs') {
    outs.push(`${base}.mts`, `${base}.ts`);
  } else if (ext === 'cjs') {
    outs.push(`${base}.cts`, `${base}.ts`);
  }
  outs.push(`${base}/index.ts`, `${base}/index.tsx`, `${base}/index.mts`);
  return outs;
}

export function analyzeTypeScriptStructure(opts: {
  relPath: string;
  text: string;
  existingPaths: Set<string>;
}): { symbols: ProjectIndexSymbolRecord[]; edges: ProjectIndexEdgeRecord[] } {
  const { relPath, text, existingPaths } = opts;
  const tokens = tokenize(text);
  const symbols: ProjectIndexSymbolRecord[] = [];
  const edges: ProjectIndexEdgeRecord[] = [];
  const edgeKeys = new Set<string>();
  const imported = new Map<string, { toPath: string; toSymbol?: string; namespace?: boolean }>();
  const fileFns = new Map<string, string>();
  const classNames = new Set<string>();
  const methodsByClass = new Map<string, Set<string>>();
  const bodies: BodyRange[] = [];

  const addEdge = (edge: ProjectIndexEdgeRecord) => {
    const key = `${edge.type}|${edge.fromPath}|${edge.toPath}|${edge.fromSymbol ?? ''}|${edge.toSymbol ?? ''}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push(edge);
  };

  const pushSymbol = (symbol: ProjectIndexSymbolRecord) => {
    if (symbols.length >= MAX_SYMBOLS) {
      return;
    }
    symbols.push(symbol);
    addEdge({
      fromPath: relPath,
      toPath: relPath,
      type: 'contains',
      toSymbol: symbol.symbolName,
    });
  };

  const linkImport = (spec: string, binding: ImportBinding) => {
    const toPath = resolveWorkspaceSpecifier(relPath, spec, existingPaths);
    if (!toPath) {
      return;
    }
    addEdge({ fromPath: relPath, toPath, type: 'imports' });
    if (binding.defaultLocal) {
      imported.set(binding.defaultLocal, { toPath, toSymbol: 'default' });
    }
    for (const named of binding.named) {
      imported.set(named.local, { toPath, toSymbol: named.exported });
    }
    if (binding.namespace) {
      imported.set(binding.namespace, { toPath, namespace: true });
    }
  };

  const finishCallable = (
    symbolName: string,
    kind: string,
    startLine: number,
    endLine: number,
    simpleName: string,
    body: { lo: number; hi: number } | null,
    owner?: string,
    className?: string,
  ) => {
    pushSymbol({
      path: relPath,
      symbolName,
      kind,
      startLine,
      endLine,
      owner,
    });
    if (!owner) {
      fileFns.set(simpleName, symbolName);
    }
    if (body && body.hi > body.lo) {
      bodies.push({ fromSymbol: symbolName, lo: body.lo, hi: body.hi, className });
    }
  };

  const consumeFunction = (i: number, forcedName?: string, forcedStart?: number): number => {
    const startLine = forcedStart ?? tokens[i]?.line ?? 1;
    if (isId(tokens[i], 'async')) {
      i++;
    }
    if (isId(tokens[i], 'function')) {
      i++;
      if (tokens[i]?.v === '*') {
        i++;
      }
    }
    let name = forcedName ?? 'anonymous';
    if (!forcedName && isId(tokens[i])) {
      name = tokens[i].v;
      i++;
    } else if (forcedName && isId(tokens[i]) && (tokens[i + 1]?.v === '(' || tokens[i + 1]?.v === '<')) {
      i++;
    }
    if (tokens[i]?.v === '<') {
      i = skipGeneric(tokens, i);
    }
    if (tokens[i]?.v === '(') {
      i = skipBalanced(tokens, i, '(', ')') + 1;
    }
    while (i < tokens.length && tokens[i].v !== '{' && tokens[i].v !== ';') {
      i++;
    }
    if (tokens[i]?.v === '{') {
      const end = matchBrace(tokens, i);
      finishCallable(name, 'function', startLine, tokens[end]?.line ?? startLine, name, { lo: i + 1, hi: end });
      return end + 1;
    }
    const endLine = tokens[i]?.line ?? startLine;
    finishCallable(name, 'function', startLine, endLine, name, null);
    return tokens[i]?.v === ';' ? i + 1 : i;
  };

  const tryArrow = (i: number, name: string, startLine: number): number | null => {
    let j = i;
    if (isId(tokens[j], 'async')) {
      j++;
    }
    if (tokens[j]?.v === '<') {
      const after = skipGeneric(tokens, j);
      if (after === j) {
        return null;
      }
      j = after;
    }
    if (tokens[j]?.v === '(') {
      j = skipBalanced(tokens, j, '(', ')') + 1;
    } else if (isId(tokens[j])) {
      j++;
    } else {
      return null;
    }
    if (tokens[j]?.v === ':') {
      j++;
      while (j < tokens.length && tokens[j].v !== '=>' && tokens[j].v !== ';' && tokens[j].v !== '{') {
        if (tokens[j].v === '(') {
          j = skipBalanced(tokens, j, '(', ')') + 1;
          continue;
        }
        if (tokens[j].v === '{') {
          j = matchBrace(tokens, j) + 1;
          continue;
        }
        j++;
      }
    }
    if (tokens[j]?.v !== '=>') {
      return null;
    }
    j++;
    if (tokens[j]?.v === '{') {
      const end = matchBrace(tokens, j);
      finishCallable(name, 'function', startLine, tokens[end]?.line ?? startLine, name, { lo: j + 1, hi: end });
      return end + 1;
    }
    const end = skipToSemi(tokens, j);
    const endLine = tokens[Math.max(j, end - 1)]?.line ?? startLine;
    finishCallable(name, 'function', startLine, endLine, name, { lo: j, hi: end });
    return end;
  };

  const parseRequireNamed = (openIdx: number): { named: ImportBinding['named']; next: number } => {
    const named: ImportBinding['named'] = [];
    let j = openIdx + 1;
    const limit = Math.min(tokens.length, openIdx + 80);
    while (j < limit && tokens[j] && tokens[j].v !== '}') {
      if (!isId(tokens[j])) {
        j++;
        continue;
      }
      const exported = tokens[j].v;
      j++;
      let local = exported;
      if (tokens[j]?.v === ':' && isId(tokens[j + 1])) {
        local = tokens[j + 1].v;
        j += 2;
      } else if (isId(tokens[j], 'as') && isId(tokens[j + 1])) {
        local = tokens[j + 1].v;
        j += 2;
      }
      named.push({ local, exported });
      if (tokens[j]?.v === ',') {
        j++;
      }
    }
    if (tokens[j]?.v === '}') {
      j++;
    }
    return { named, next: j };
  };

  const consumeRequireDestructure = (i: number): number => {
    i++;
    if (tokens[i]?.v !== '{') {
      return i;
    }
    const { named, next } = parseRequireNamed(i);
    i = next;
    if (tokens[i]?.v !== '=') {
      return skipToSemi(tokens, i);
    }
    i++;
    if (isId(tokens[i], 'require') && tokens[i + 1]?.v === '(' && tokens[i + 2]?.t === 'str') {
      linkImport(tokens[i + 2].v, { defaultLocal: null, named, namespace: null });
    }
    return skipToSemi(tokens, i);
  };

  const consumeVar = (i: number): number => {
    i++;
    if (!isId(tokens[i])) {
      return i;
    }
    const name = tokens[i].v;
    const startLine = tokens[i].line;
    i++;
    if (tokens[i]?.v === ':') {
      i++;
      i = skipType(tokens, i);
    }
    if (tokens[i]?.v !== '=') {
      pushSymbol({ path: relPath, symbolName: name, kind: 'const', startLine, endLine: startLine });
      return skipToSemi(tokens, i);
    }
    i++;
    if (isId(tokens[i], 'require') && tokens[i + 1]?.v === '(' && tokens[i + 2]?.t === 'str') {
      linkImport(tokens[i + 2].v, { defaultLocal: null, named: [], namespace: name });
      return skipToSemi(tokens, i);
    }
    if (isId(tokens[i], 'function') || (isId(tokens[i], 'async') && isId(tokens[i + 1], 'function'))) {
      return consumeFunction(i, name, startLine);
    }
    const arrowEnd = tryArrow(i, name, startLine);
    if (arrowEnd !== null) {
      return arrowEnd;
    }
    const end = skipToSemi(tokens, i);
    const endLine = tokens[Math.max(i, end - 1)]?.line ?? startLine;
    pushSymbol({ path: relPath, symbolName: name, kind: 'const', startLine, endLine });
    return end;
  };

  const consumeClass = (i: number, forcedName?: string): number => {
    const startLine = tokens[i].line;
    i++;
    let name = forcedName ?? '';
    if (isId(tokens[i])) {
      name = tokens[i].v;
      i++;
    } else if (!forcedName) {
      return i;
    }
    while (i < tokens.length && tokens[i].v !== '{' && tokens[i].v !== ';') {
      if (tokens[i].v === '(') {
        i = skipBalanced(tokens, i, '(', ')') + 1;
        continue;
      }
      if (tokens[i].v === '{') {
        break;
      }
      i++;
    }
    if (tokens[i]?.v !== '{') {
      pushSymbol({ path: relPath, symbolName: name, kind: 'class', startLine, endLine: tokens[i]?.line ?? startLine });
      return i + 1;
    }
    const end = matchBrace(tokens, i);
    pushSymbol({
      path: relPath,
      symbolName: name,
      kind: 'class',
      startLine,
      endLine: tokens[end]?.line ?? startLine,
    });
    classNames.add(name);
    methodsByClass.set(name, new Set());
    walkClass(i + 1, end, name);
    return end + 1;
  };

  const walkClass = (lo: number, hi: number, className: string) => {
    let i = lo;
    while (i < hi) {
      if (tokens[i]?.v === '{' || tokens[i]?.v === '(' || tokens[i]?.v === '[') {
        const open = tokens[i].v;
        const close = open === '{' ? '}' : open === '(' ? ')' : ']';
        i = (open === '{' ? matchBrace(tokens, i) : skipBalanced(tokens, i, open, close)) + 1;
        continue;
      }
      let j = i;
      while (CLASS_MODIFIERS.has(tokens[j]?.v ?? '') && isId(tokens[j])) {
        j++;
      }
      if (isId(tokens[j], 'get') || isId(tokens[j], 'set')) {
        if (isId(tokens[j + 1])) {
          j++;
        }
      }
      const nameTok = tokens[j];
      const next = tokens[j + 1];
      const isMethod =
        isId(nameTok) &&
        !NOT_A_CALL.has(nameTok.v) &&
        (next?.v === '(' || next?.v === '<' || nameTok.v === 'constructor');
      if (isMethod && nameTok) {
        const simple = nameTok.v;
        const startLine = nameTok.line;
        j++;
        if (tokens[j]?.v === '<') {
          j = skipGeneric(tokens, j);
        }
        if (tokens[j]?.v === '(') {
          j = skipBalanced(tokens, j, '(', ')') + 1;
        }
        while (j < hi && tokens[j]?.v !== '{' && tokens[j]?.v !== ';') {
          j++;
        }
        const symbolName = `${className}.${simple}`;
        if (tokens[j]?.v === '{') {
          const end = matchBrace(tokens, j);
          pushSymbol({
            path: relPath,
            symbolName,
            kind: 'method',
            startLine,
            endLine: tokens[end]?.line ?? startLine,
            owner: className,
          });
          methodsByClass.get(className)?.add(simple);
          if (end > j + 1) {
            bodies.push({ fromSymbol: symbolName, lo: j + 1, hi: end, className });
          }
          i = end + 1;
          continue;
        }
        pushSymbol({
          path: relPath,
          symbolName,
          kind: 'method',
          startLine,
          endLine: tokens[j]?.line ?? startLine,
          owner: className,
        });
        i = tokens[j]?.v === ';' ? j + 1 : j + 1;
        continue;
      }
      if (isId(nameTok) && next?.v === '=' && nameTok) {
        const arrowEnd = tryArrow(j + 2, `${className}.${nameTok.v}`, nameTok.line);
        if (arrowEnd !== null) {
          const last = symbols[symbols.length - 1];
          if (last && last.symbolName === `${className}.${nameTok.v}`) {
            last.kind = 'method';
            last.owner = className;
            methodsByClass.get(className)?.add(nameTok.v);
            const body = bodies[bodies.length - 1];
            if (body && body.fromSymbol === last.symbolName) {
              body.className = className;
            }
          }
          fileFns.delete(`${className}.${nameTok.v}`);
          i = arrowEnd;
          continue;
        }
      }
      i++;
    }
  };

  const consumeBracedType = (i: number, kind: string): number => {
    const startLine = tokens[i].line;
    i++;
    if (!isId(tokens[i])) {
      return i;
    }
    const name = tokens[i].v;
    i++;
    while (i < tokens.length && tokens[i].v !== '{' && tokens[i].v !== ';') {
      i++;
    }
    if (tokens[i]?.v === '{') {
      const end = matchBrace(tokens, i);
      pushSymbol({
        path: relPath,
        symbolName: name,
        kind,
        startLine,
        endLine: tokens[end]?.line ?? startLine,
      });
      return end + 1;
    }
    pushSymbol({ path: relPath, symbolName: name, kind, startLine, endLine: tokens[i]?.line ?? startLine });
    return i + 1;
  };

  const consumeTypeAlias = (i: number): number => {
    const startLine = tokens[i].line;
    i++;
    if (!isId(tokens[i])) {
      return i;
    }
    const name = tokens[i].v;
    i++;
    if (tokens[i]?.v === '<') {
      i = skipGeneric(tokens, i);
    }
    if (tokens[i]?.v === '=') {
      i++;
    }
    const end = skipToSemi(tokens, i);
    const endLine = tokens[Math.max(i, end - 1)]?.line ?? startLine;
    pushSymbol({ path: relPath, symbolName: name, kind: 'type', startLine, endLine });
    return end;
  };

  const consumeImport = (i: number): number => {
    const limit = Math.min(tokens.length, i + 80);
    i++;
    let typeOnly = false;
    if (isId(tokens[i], 'type')) {
      typeOnly = true;
      i++;
    }
    const binding: ImportBinding = { defaultLocal: null, named: [], namespace: null };
    if (tokens[i]?.t === 'str') {
      const spec = tokens[i].v;
      i++;
      if (tokens[i]?.v === ';') {
        i++;
      }
      if (!typeOnly) {
        linkImport(spec, binding);
      }
      return i;
    }
    if (isId(tokens[i]) && tokens[i].v !== 'from') {
      binding.defaultLocal = tokens[i].v;
      i++;
      if (tokens[i]?.v === ',') {
        i++;
      }
    }
    if (tokens[i]?.v === '*') {
      i++;
      if (isId(tokens[i], 'as')) {
        i++;
      }
      if (isId(tokens[i])) {
        binding.namespace = tokens[i].v;
        i++;
      }
    }
    if (tokens[i]?.v === '{') {
      i++;
      while (i < limit && tokens[i] && tokens[i].v !== '}') {
        if (isId(tokens[i], 'type') && isId(tokens[i + 1])) {
          i++;
          i++;
          if (isId(tokens[i], 'as')) {
            i++;
            if (isId(tokens[i])) {
              i++;
            }
          }
          if (tokens[i]?.v === ',') {
            i++;
          }
          continue;
        }
        if (!isId(tokens[i])) {
          i++;
          continue;
        }
        const exported = tokens[i].v;
        i++;
        let local = exported;
        if (isId(tokens[i], 'as')) {
          i++;
          if (isId(tokens[i])) {
            local = tokens[i].v;
            i++;
          }
        }
        binding.named.push({ local, exported });
        if (tokens[i]?.v === ',') {
          i++;
        }
      }
      if (tokens[i]?.v === '}') {
        i++;
      }
    }
    if (isId(tokens[i], 'from')) {
      i++;
    }
    if (tokens[i]?.t === 'str') {
      const spec = tokens[i].v;
      i++;
      if (tokens[i]?.v === ';') {
        i++;
      }
      if (!typeOnly) {
        linkImport(spec, binding);
      }
      return i;
    }
    return Math.min(i + 1, limit);
  };

  const consumeReexport = (i: number, link: boolean): number => {
    const limit = Math.min(tokens.length, i + 80);
    while (i < limit && tokens[i]?.v !== ';' && tokens[i]?.t !== 'str') {
      i++;
    }
    if (tokens[i]?.t === 'str') {
      if (link) {
        linkImport(tokens[i].v, { defaultLocal: null, named: [], namespace: null });
      }
      i++;
    }
    if (tokens[i]?.v === ';') {
      i++;
    }
    return i;
  };

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok) {
      break;
    }
    if (isId(tok, 'import') && tokens[i + 1]?.v === '(' && tokens[i + 2]?.t === 'str') {
      linkImport(tokens[i + 2].v, { defaultLocal: null, named: [], namespace: null });
      i += 3;
      continue;
    }
    if (isId(tok, 'import')) {
      i = consumeImport(i);
      continue;
    }
    if (isId(tok, 'export')) {
      const next = tokens[i + 1];
      if (next?.v === '{' || next?.v === '*') {
        i = consumeReexport(i, true);
        continue;
      }
      if (isId(next, 'type') && (tokens[i + 2]?.v === '{' || tokens[i + 2]?.v === '*')) {
        i = consumeReexport(i, false);
        continue;
      }
      if (isId(next, 'default')) {
        const defaultStart = tok.line;
        i += 2;
        if (isId(tokens[i], 'async') || isId(tokens[i], 'function')) {
          let k = i;
          if (isId(tokens[k], 'async')) {
            k++;
          }
          if (isId(tokens[k], 'function')) {
            k++;
          }
          if (tokens[k]?.v === '*') {
            k++;
          }
          if (isId(tokens[k])) {
            i = consumeFunction(i);
          } else {
            i = consumeFunction(i, 'default', defaultStart);
          }
          continue;
        }
        if (isId(tokens[i], 'class')) {
          if (isId(tokens[i + 1])) {
            i = consumeClass(i);
          } else {
            i = consumeClass(i, 'default');
          }
          continue;
        }
        continue;
      }
      i++;
      continue;
    }
    if (isId(tok, 'declare') || isId(tok, 'abstract')) {
      i++;
      continue;
    }
    if (isId(tok, 'async') && isId(tokens[i + 1], 'function')) {
      i = consumeFunction(i);
      continue;
    }
    if (isId(tok, 'function')) {
      i = consumeFunction(i);
      continue;
    }
    if (isId(tok, 'class')) {
      i = consumeClass(i);
      continue;
    }
    if (isId(tok, 'interface') || isId(tok, 'enum')) {
      i = consumeBracedType(i, tok.v);
      continue;
    }
    if (isId(tok, 'type') && isId(tokens[i + 1])) {
      i = consumeTypeAlias(i);
      continue;
    }
    if (
      (isId(tok, 'const') || isId(tok, 'let') || isId(tok, 'var')) &&
      tokens[i + 1]?.v === '{'
    ) {
      i = consumeRequireDestructure(i);
      continue;
    }
    if (isId(tok, 'const') || isId(tok, 'let') || isId(tok, 'var')) {
      i = consumeVar(i);
      continue;
    }
    if (isId(tok, 'require') && tokens[i + 1]?.v === '(' && tokens[i + 2]?.t === 'str') {
      linkImport(tokens[i + 2].v, { defaultLocal: null, named: [], namespace: null });
      i = skipBalanced(tokens, i + 1, '(', ')') + 1;
      if (tokens[i]?.v === ';') {
        i++;
      }
      continue;
    }
    if (tok.v === '{') {
      i = matchBrace(tokens, i) + 1;
      continue;
    }
    if (tok.v === '(') {
      i = skipBalanced(tokens, i, '(', ')') + 1;
      continue;
    }
    i++;
  }

  const resolveCall = (simple: string, fromSymbol: string) => {
    const importedHit = imported.get(simple);
    if (importedHit) {
      addEdge({
        fromPath: relPath,
        toPath: importedHit.toPath,
        type: 'calls',
        fromSymbol,
        toSymbol: importedHit.toSymbol ?? (importedHit.namespace ? 'default' : undefined),
      });
      return;
    }
    const local = fileFns.get(simple);
    if (local) {
      addEdge({
        fromPath: relPath,
        toPath: relPath,
        type: 'calls',
        fromSymbol,
        toSymbol: local,
      });
      return;
    }
    if (classNames.has(simple)) {
      addEdge({
        fromPath: relPath,
        toPath: relPath,
        type: 'calls',
        fromSymbol,
        toSymbol: simple,
      });
    }
  };

  for (const body of bodies) {
    for (let j = body.lo; j < body.hi; j++) {
      const tok = tokens[j];
      if (isId(tok, 'new') && isId(tokens[j + 1]) && callParen(tokens, j + 1) !== null) {
        resolveCall(tokens[j + 1].v, body.fromSymbol);
        continue;
      }
      if (
        isId(tok, 'this') &&
        tokens[j + 1]?.v === '.' &&
        isId(tokens[j + 2]) &&
        callParen(tokens, j + 2) !== null &&
        body.className
      ) {
        const method = tokens[j + 2].v;
        if (methodsByClass.get(body.className)?.has(method)) {
          addEdge({
            fromPath: relPath,
            toPath: relPath,
            type: 'calls',
            fromSymbol: body.fromSymbol,
            toSymbol: `${body.className}.${method}`,
          });
        }
        continue;
      }
      if (
        isId(tok) &&
        tokens[j + 1]?.v === '.' &&
        isId(tokens[j + 2]) &&
        callParen(tokens, j + 2) !== null
      ) {
        const nsHit = imported.get(tok.v);
        if (nsHit?.namespace) {
          addEdge({
            fromPath: relPath,
            toPath: nsHit.toPath,
            type: 'calls',
            fromSymbol: body.fromSymbol,
            toSymbol: tokens[j + 2].v,
          });
        }
        continue;
      }
      if (!isId(tok) || NOT_A_CALL.has(tok.v) || callParen(tokens, j) === null) {
        continue;
      }
      const prev = tokens[j - 1];
      if (prev?.v === '.' || prev?.v === 'function' || prev?.v === 'class') {
        continue;
      }
      resolveCall(tok.v, body.fromSymbol);
    }
  }

  return { symbols, edges };
}

function basenameOf(relPath: string): string {
  const norm = relPath.replace(/\\/g, '/');
  const slash = norm.lastIndexOf('/');
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

function parentDirOf(relPath: string): string {
  const norm = relPath.replace(/\\/g, '/');
  const slash = norm.lastIndexOf('/');
  return slash >= 0 ? norm.slice(0, slash) : '';
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

function isId(tok: Tok | undefined, v?: string): boolean {
  return !!tok && tok.t === 'id' && (v === undefined || tok.v === v);
}

function prevIsExprEnd(tok: Tok | undefined): boolean {
  if (!tok) {
    return false;
  }
  if (tok.t === 'id' || tok.t === 'str') {
    return true;
  }
  return tok.v === ')' || tok.v === ']' || tok.v === '++' || tok.v === '--';
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  if (typeof src !== 'string' || src.length === 0) {
    return out;
  }
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') {
          line++;
        }
        i++;
      }
      i = Math.min(n, i + 2);
      continue;
    }
    if (c === '/' && !prevIsExprEnd(out[out.length - 1])) {
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '[') {
          inClass = true;
        } else if (src[i] === ']') {
          inClass = false;
        } else if (src[i] === '/' && !inClass) {
          i++;
          break;
        }
        i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) {
        i++;
      }
      continue;
    }
    if (c === '\'' || c === '"') {
      const quote = c;
      const startLine = line;
      i++;
      let value = '';
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') {
          value += src[i + 1] ?? '';
          if (src[i + 1] === '\n') {
            line++;
          }
          i += 2;
          continue;
        }
        if (src[i] === '\n') {
          line++;
        }
        value += src[i];
        i++;
      }
      i++;
      out.push({ t: 'str', v: value, line: startLine });
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') {
          if (src[i + 1] === '\n') {
            line++;
          }
          i += 2;
          continue;
        }
        if (src[i] === '\n') {
          line++;
        }
        i++;
      }
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const startLine = line;
      let value = '';
      while (i < n && /[\w$]/.test(src[i])) {
        value += src[i];
        i++;
      }
      out.push({ t: 'id', v: value, line: startLine });
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (i < n && /[0-9a-fxA-F._]/.test(src[i])) {
        i++;
      }
      continue;
    }
    if (c === '=' && src[i + 1] === '>') {
      out.push({ t: 'punct', v: '=>', line });
      i += 2;
      continue;
    }
    out.push({ t: 'punct', v: c, line });
    i++;
  }
  return out;
}

function matchBrace(tokens: Tok[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].v === '{') {
      depth++;
    } else if (tokens[i].v === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return Math.max(openIdx, tokens.length - 1);
}

function skipBalanced(tokens: Tok[], openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].v === open) {
      depth++;
    } else if (tokens[i].v === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return Math.max(openIdx, tokens.length - 1);
}

function skipGeneric(tokens: Tok[], i: number): number {
  if (tokens[i]?.v !== '<') {
    return i;
  }
  let depth = 0;
  const limit = Math.min(tokens.length, i + 40);
  for (let j = i; j < limit; j++) {
    if (tokens[j].v === '<') {
      depth++;
    } else if (tokens[j].v === '>') {
      depth--;
      if (depth === 0) {
        return j + 1;
      }
    } else if (tokens[j].v === '{' || tokens[j].v === ';') {
      return i;
    }
  }
  return i;
}

function skipType(tokens: Tok[], i: number): number {
  let angle = 0;
  let brace = 0;
  let paren = 0;
  while (i < tokens.length) {
    const v = tokens[i].v;
    if (v === '<') {
      angle++;
    } else if (v === '>') {
      angle = Math.max(0, angle - 1);
    } else if (v === '{') {
      brace++;
    } else if (v === '}') {
      if (brace === 0) {
        break;
      }
      brace--;
    } else if (v === '(') {
      paren++;
    } else if (v === ')') {
      if (paren === 0) {
        break;
      }
      paren--;
    } else if ((v === '=' || v === ';' || v === ',') && angle === 0 && brace === 0 && paren === 0) {
      break;
    }
    i++;
  }
  return i;
}

function skipToSemi(tokens: Tok[], i: number): number {
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  while (i < tokens.length) {
    const v = tokens[i].v;
    if (v === '{') {
      brace++;
    } else if (v === '}') {
      if (brace === 0) {
        return i;
      }
      brace--;
    } else if (v === '(') {
      paren++;
    } else if (v === ')') {
      if (paren === 0) {
        return i;
      }
      paren--;
    } else if (v === '[') {
      bracket++;
    } else if (v === ']') {
      if (bracket === 0) {
        return i;
      }
      bracket--;
    } else if (v === ';' && brace === 0 && paren === 0 && bracket === 0) {
      return i + 1;
    }
    i++;
  }
  return i;
}

function callParen(tokens: Tok[], identIdx: number): number | null {
  let k = identIdx + 1;
  if (tokens[k]?.v === '<') {
    const after = skipGeneric(tokens, k);
    if (after === k) {
      return null;
    }
    k = after;
  }
  return tokens[k]?.v === '(' ? k : null;
}
