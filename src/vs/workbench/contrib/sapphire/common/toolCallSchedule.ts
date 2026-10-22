/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Встроенные read-only инструменты — можно батчить. Plan пишет файлы → только serial. */
const PARALLEL_READ_ONLY_TOOLS = new Set<string>([
  'read_file',
  'ls_dir',
  'get_dir_tree',
  'search_pathnames_only',
  'search_project_index',
  'diff_impact',
  'get_project_tour',
  'search_for_files',
  'search_in_file',
  'grep_search',
  'glob_files',
  'web_search',
  'browse_url',
  'read_lint_errors',
  'get_diagnostics',
  'go_to_definition',
  'find_references',
  'search_symbols',
  'get_chat_history',
]);

function isParallelReadOnlyTool(name: string): boolean {
  return PARALLEL_READ_ONLY_TOOLS.has(name);
}

/** Список имён для планировщика и system prompt агента. */
export function parallelReadOnlyToolNames(): readonly string[] {
  return [...PARALLEL_READ_ONLY_TOOLS];
}

/** Правило Plan/Agent: батчить те же read-only tools, что и планировщик. */
export function parallelReadOnlyToolPrompt(): string {
  const names = parallelReadOnlyToolNames().join(', ');
  return `You may call several read-only tools in one response (${names}). Edits, terminal, MCP, and plan tools must be one at a time.`;
}

/** Правило Plan/Agent: компактный результат tool не заменяет чтение файла. */
export function omittedToolBodyPrompt(): string {
  return `If a tool result says the file body or listing was omitted, read that path again instead of relying on the summary.`;
}

type ToolCallSegment<T> = { kind: 'parallel'; calls: T[] } | { kind: 'serial'; call: T };

/**
 * Подряд идущие read-only (2+) → одна parallel-группа.
 * Один read и любые mutating / MCP / plan — serial, в исходном порядке.
 */
export function segmentToolCalls<T extends { name: string }>(
  calls: readonly T[],
): ToolCallSegment<T>[] {
  const segments: ToolCallSegment<T>[] = [];
  let i = 0;
  while (i < calls.length) {
    if (!isParallelReadOnlyTool(calls[i].name)) {
      segments.push({ kind: 'serial', call: calls[i] });
      i += 1;
      continue;
    }
    const start = i;
    while (i < calls.length && isParallelReadOnlyTool(calls[i].name)) {
      i += 1;
    }
    const group = calls.slice(start, i);
    if (group.length >= 2) {
      segments.push({ kind: 'parallel', calls: group });
    } else {
      segments.push({ kind: 'serial', call: group[0] });
    }
  }
  return segments;
}
