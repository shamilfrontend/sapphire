/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { PlanTodoItem, PlanTodoStatus } from '../toolsServiceTypes.js';
import { WORKSPACE_DOT_DIR } from '../workspaceDotDir.js';

export const PLAN_DIR_SEGMENTS = [WORKSPACE_DOT_DIR, 'plans'] as const;
const PLAN_FILE_SUFFIX = '.plan.md';

export const isPlanFilePath = (path: string): boolean =>
  path.replace(/\\/g, '/').endsWith(PLAN_FILE_SUFFIX);

export type ParsedPlanMarkdown = {
  name: string;
  overview: string;
  plan: string;
  todos: PlanTodoItem[];
};

const VALID_TODO_STATUSES: PlanTodoStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];

export const slugifyPlanName = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `plan-${Date.now()}`;
};

export const normalizePlanTodos = (todos: PlanTodoItem[]): PlanTodoItem[] =>
  todos.map((t, i) => ({
    id: (t.id || `step-${i + 1}`).trim() || `step-${i + 1}`,
    content: (t.content || '').trim() || `Step ${i + 1}`,
    status: VALID_TODO_STATUSES.includes(t.status) ? t.status : 'pending',
  }));

/** true, если есть todo в pending или in_progress. */
export const planTodosHaveOpen = (todos: readonly PlanTodoItem[]): boolean =>
  todos.some((todo) => todo.status !== 'completed' && todo.status !== 'cancelled');

/** Подпись вида `2 из 4 · …` для текущего шага; undefined, если всё done. */
export const planProgressLabel = (todos: readonly PlanTodoItem[]): string | undefined => {
  if (todos.length === 0) return undefined;
  const inProgress = todos.find((t) => t.status === 'in_progress');
  const open = todos.find((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const current = inProgress ?? open;
  if (!current) return undefined;
  const idx = todos.findIndex((t) => t.id === current.id);
  const n = idx >= 0 ? idx + 1 : 1;
  return `${n} из ${todos.length} · ${current.content}`;
};

const escapeYamlDoubleQuoted = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const serializePlanMarkdown = (opts: {
  name: string;
  overview: string;
  plan: string;
  todos: PlanTodoItem[];
}): string => {
  const todos = normalizePlanTodos(opts.todos);
  const todoLines = todos
    .map(
      (t) =>
        `  - id: ${JSON.stringify(t.id)}\n    content: ${JSON.stringify(t.content)}\n    status: ${t.status}`,
    )
    .join('\n');

  const frontmatter = `---
name: "${escapeYamlDoubleQuoted(opts.name)}"
overview: "${escapeYamlDoubleQuoted(opts.overview)}"
todos:
${todoLines || '  []'}
---

`;
  const body = opts.plan.trim();
  return frontmatter + (body ? `${body}\n` : '');
};

const parseYamlScalar = (raw: string | undefined): string => {
  if (raw === undefined) {
    return '';
  }
  const t = raw.trim();
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      return t.replace(/^"|"$/g, '');
    }
  }
  if (t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1);
  }
  return t;
};

const parseFrontmatterTodos = (fm: string): PlanTodoItem[] => {
  const todosLine = fm.match(/^todos:\s*(.*)$/m);
  if (!todosLine) {
    return [];
  }
  if (todosLine[1].trim() === '[]') {
    return [];
  }

  const start = fm.search(/^todos:\s*$/m);
  if (start < 0) {
    return [];
  }

  const lines = fm.slice(start).split('\n').slice(1);
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (/^[a-zA-Z][\w-]*:/.test(line)) {
      break;
    }
    if (line.trim() === '[]' && !current) {
      break;
    }
    if (/^\s*-\s+/.test(line)) {
      if (current) {
        chunks.push(current);
      }
      current = line.replace(/^\s*-\s+/, '');
      continue;
    }
    if (current && (/^\s+/.test(line) || !line.trim())) {
      current += `\n${line}`;
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    break;
  }
  if (current) {
    chunks.push(current);
  }

  const todos: PlanTodoItem[] = [];
  for (const chunk of chunks) {
    const idM = chunk.match(/id:\s*(.+)/);
    const contentM = chunk.match(/content:\s*(.+)/);
    const statusM = chunk.match(/status:\s*(\S+)/);
    const statusRaw = parseYamlScalar(statusM?.[1]).replace(/[",']/g, '') as PlanTodoStatus;
    todos.push({
      id: parseYamlScalar(idM?.[1]) || `step-${todos.length + 1}`,
      content: parseYamlScalar(contentM?.[1]),
      status: VALID_TODO_STATUSES.includes(statusRaw) ? statusRaw : 'pending',
    });
  }
  return todos;
};

/** Минимальный парсер frontmatter plan-файлов (не полный YAML). */
export const parsePlanMarkdown = (raw: string): ParsedPlanMarkdown => {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) {
    return { name: 'Plan', overview: '', plan: trimmed, todos: [] };
  }
  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx < 0) {
    return { name: 'Plan', overview: '', plan: trimmed, todos: [] };
  }
  const fm = trimmed.slice(3, endIdx).trim();
  const plan = trimmed.slice(endIdx + 4).replace(/^\n/, '');

  const nameMatch = fm.match(/^name:\s*(?:"([^"]*)"|'([^']*)'|(.+))$/m);
  const overviewMatch = fm.match(/^overview:\s*(?:"([^"]*)"|'([^']*)'|(.+))$/m);
  const name = (nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3] ?? 'Plan').trim();
  const overview = (overviewMatch?.[1] ?? overviewMatch?.[2] ?? overviewMatch?.[3] ?? '').trim();

  return { name, overview, plan, todos: normalizePlanTodos(parseFrontmatterTodos(fm)) };
};
