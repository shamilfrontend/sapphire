/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TrimableChatMessage } from './trimChatContext.js';

/** Лимит символов компактного tool result: выше trim, но не дамп файла. */
export const COMPACT_TOOL_MAX_CHARS = 480;

/**
 * Как у `trimMessagesToFreeTokens`: индекс 0 и последние 4 сообщения.
 * Они не трогаются — у последнего хода полный вывод tools.
 */
function isProtectedChatIndex(index: number, length: number): boolean {
  return index === 0 || index >= length - 1 - 3;
}

const clip = (text: string, maxChars: number): string => {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  if (maxChars <= 3) {
    return trimmed.slice(0, maxChars);
  }
  return `${trimmed.slice(0, maxChars - 3)}...`;
};

const rawRecord = (rawParams: unknown): Record<string, unknown> | undefined => {
  if (!rawParams || typeof rawParams !== 'object') {
    return undefined;
  }
  return rawParams as Record<string, unknown>;
};

const paramValue = (rawParams: unknown, key: string): unknown => {
  const rec = rawRecord(rawParams);
  if (!rec) {
    return undefined;
  }
  if (Object.hasOwn(rec, key)) {
    return rec[key];
  }
  const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  if (camel !== key && Object.hasOwn(rec, camel)) {
    return rec[camel];
  }
  return undefined;
};

const asText = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === 'object') {
    const fsPath = (value as { fsPath?: unknown }).fsPath;
    if (typeof fsPath === 'string' && fsPath.trim()) {
      return fsPath.trim();
    }
    const path = (value as { path?: unknown }).path;
    if (typeof path === 'string' && path.trim()) {
      return path.trim();
    }
  }
  return undefined;
};

const paramText = (rawParams: unknown, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const text = asText(paramValue(rawParams, key));
    if (text) {
      return text;
    }
  }
  return undefined;
};

const lintErrorCount = (content: string): number => content.match(/^Error \d+:/gm)?.length ?? 0;

const firstLintMessage = (content: string): string | undefined => {
  const message = content.match(/Error message:\s*(.+)/);
  if (message?.[1]?.trim()) {
    return message[1].trim();
  }
  return content.match(/^Error \d+:.*$/m)?.[0]?.trim();
};

const searchPathLines = (content: string): { paths: string[]; more: boolean } => {
  const more = content.includes('more on next page');
  const paths = content
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) => line.length > 0 && !line.startsWith('(') && !line.includes('more on next page'),
    );
  return { paths, more };
};

const readDigest = (name: string, rawParams: unknown): string => {
  const path = paramText(rawParams, 'uri') ?? '?';
  return `${name} ${path}: body omitted; read again if you need it.`;
};

const searchDigest = (name: string, rawParams: unknown, content: string): string => {
  const query = paramText(rawParams, 'query');
  const queryBit = query ? ` "${clip(query, 80)}"` : '';

  if (name === 'search_in_file') {
    const hits = content.match(/^Line \d+:/gm)?.length ?? 0;
    const path = paramText(rawParams, 'uri');
    const where = path ? ` in ${path}` : '';
    return `${name}${queryBit}${where}: ${hits} match${hits === 1 ? '' : 'es'}. Body omitted; search again if you need it.`;
  }

  if (name === 'grep_search') {
    if (/No matches found/i.test(content)) {
      return `${name}${queryBit}: no matches.`;
    }
    const hits = content
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.startsWith('(')).length;
    const truncated = /showing \d+ of \d+ matches/i.test(content);
    const moreBit = truncated ? ' More omitted; search again if you need them.' : '';
    return `${name}${queryBit}: ${hits} match${hits === 1 ? '' : 'es'}.${moreBit}`;
  }

  if (name === 'glob_files') {
    const pattern = paramText(rawParams, 'pattern');
    const patternBit = pattern ? ` "${clip(pattern, 80)}"` : queryBit;
    if (/No files matched/i.test(content)) {
      return `${name}${patternBit}: no files.`;
    }
    const hits = content
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.startsWith('(')).length;
    const truncated = /\(truncated\)/i.test(content);
    const moreBit = truncated ? ' More omitted; glob again if you need them.' : '';
    return `${name}${patternBit}: ${hits} file${hits === 1 ? '' : 's'}.${moreBit}`;
  }

  if (name === 'web_search') {
    if (/No results/i.test(content)) {
      return `${name}${queryBit}: no results.`;
    }
    const hits = content.match(/^\d+\.\s/gm)?.length ?? 0;
    return `${name}${queryBit}: ${hits || '?'} result${hits === 1 ? '' : 's'}. Body omitted; search again if you need it.`;
  }

  if (name === 'browse_url') {
    const url = paramText(rawParams, 'url') ?? '?';
    return `${name} ${clip(url, 120)}: page body omitted; browse again if you need it.`;
  }

  if (name === 'search_symbols') {
    if (/No symbols found/i.test(content)) {
      return `${name}${queryBit}: no symbols.`;
    }
    const hits = content
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.startsWith('(')).length;
    const truncated = /truncated/i.test(content);
    const moreBit = truncated ? ' More omitted; search again if you need them.' : '';
    return `${name}${queryBit}: ${hits} symbol${hits === 1 ? '' : 's'}.${moreBit}`;
  }

  const { paths, more } = searchPathLines(content);
  if (paths.length === 0) {
    const first = content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return `${name}${queryBit}: ${clip(first ?? 'no matches', 200)}`;
  }

  const shown = paths.slice(0, 8).map((path) => clip(path, 120));
  const moreBit =
    more || paths.length > shown.length ? ' More omitted; search again if you need them.' : '';
  return `${name}${queryBit}: ${paths.length} match${paths.length === 1 ? '' : 'es'}.${moreBit} First: ${shown.join(', ')}.`;
};

const renameDigest = (name: string, rawParams: unknown, content: string): string => {
  const path = paramText(rawParams, 'uri') ?? '?';
  const newName = paramText(rawParams, 'new_name', 'newName') ?? '?';
  const symbol = paramText(rawParams, 'symbol');
  const fromTo = symbol ? `${symbol} → ${newName}` : newName;
  const countMatch = content.match(/in (\d+) location/);
  const count = countMatch?.[1] ?? '?';
  const first = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.includes('→') && line.includes(':'));
  const firstBit = first ? ` First: ${clip(first, 160)}` : '';
  if (/No rename edits applied/i.test(content)) {
    return `${name} ${path} ${fromTo}: no edits.`;
  }
  return `${name} ${path} ${fromTo}: ${count} location${count === '1' ? '' : 's'}.${firstBit}`;
};

const editDigest = (name: string, rawParams: unknown, content: string): string => {
  const path = paramText(rawParams, 'uri') ?? '?';
  if (!/Change successfully made/i.test(content)) {
    const first = content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return `${name} ${path}: ${clip(first ?? 'failed', 220)}`;
  }
  if (/No lint errors found/i.test(content)) {
    return `${name} ${path}: applied. No lint errors.`;
  }
  const count = lintErrorCount(content);
  if (count > 0) {
    const first = firstLintMessage(content);
    const firstBit = first ? ` First: ${clip(first, 180)}` : '';
    return `${name} ${path}: applied. ${count} lint error${count === 1 ? '' : 's'}.${firstBit}`;
  }
  return `${name} ${path}: applied.`;
};

const commandDigest = (name: string, rawParams: unknown, content: string): string => {
  const command = clip(paramText(rawParams, 'command') ?? '?', 160);
  const exit = content.match(/\(exit code (\d+)\)/);
  if (exit) {
    return `${name} ${command}: exit code ${exit[1]}.`;
  }
  if (/automatically stopped|did not finish/i.test(content)) {
    return `${name} ${command}: timed out.`;
  }
  const tail = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .pop();
  return `${name} ${command}: ${clip(tail ?? 'finished', 160)}`;
};

const lintDigest = (name: string, rawParams: unknown, content: string): string => {
  const path = paramText(rawParams, 'uri') ?? (name === 'get_diagnostics' ? 'workspace' : '?');
  if (/No lint errors found|No diagnostics found/i.test(content)) {
    return `${name} ${path}: no diagnostics.`;
  }
  if (name === 'get_diagnostics') {
    const count = content.match(/^\d+\.\s+\[(error|warning)\]/gm)?.length ?? 0;
    const first = content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /^\d+\.\s+\[/.test(line));
    const firstBit = first ? ` First: ${clip(first, 180)}` : '';
    return `${name} ${path}: ${count} diagnostic${count === 1 ? '' : 's'}.${firstBit}`;
  }
  const count = lintErrorCount(content);
  const first = firstLintMessage(content);
  const firstBit = first ? ` First: ${clip(first, 180)}` : '';
  return `${name} ${path}: ${count} lint error${count === 1 ? '' : 's'}.${firstBit}`;
};

const codeNavDigest = (name: string, rawParams: unknown, content: string): string => {
  const path = paramText(rawParams, 'uri') ?? '?';
  const line = paramText(rawParams, 'line');
  const symbol = paramText(rawParams, 'symbol');
  const at = line ? `:${line}` : '';
  const sym = symbol ? ` ${symbol}` : '';
  const firstLine = content.split('\n').find((l) => l.trim().length > 0) ?? content;
  if (
    /No definition|No reference|No locations|does not exist|provider for this file/i.test(
      firstLine,
    )
  ) {
    return `${name} ${path}${at}${sym}: ${clip(firstLine, 160)}`;
  }
  const count = (content.match(/^[^\s\n].*:\d+-\d+$/gm) ?? []).length;
  const truncated = /\(truncated/i.test(content);
  const more = truncated ? ' (truncated)' : '';
  return `${name} ${path}${at}${sym}: ${count} location${count === 1 ? '' : 's'}${more}.`;
};

const fallbackDigest = (name: string, rawParams: unknown): string => {
  const path = paramText(rawParams, 'uri', 'plan_uri', 'planUri');
  const query = paramText(rawParams, 'query');
  const command = paramText(rawParams, 'command');
  const label = path ?? (query ? `"${clip(query, 80)}"` : command ? clip(command, 120) : '');
  const suffix = label ? ` ${label}` : '';
  return `${name}${suffix}: result omitted; call the tool again if you need it.`;
};

/** Краткая замена tool result без тела файла/команды. */
export function compactToolResult(name: string, rawParams: unknown, content: string): string {
  let digest: string;
  switch (name) {
    case 'read_file':
    case 'ls_dir':
    case 'get_dir_tree':
      digest = readDigest(name, rawParams);
      break;
    case 'search_pathnames_only':
    case 'search_project_index':
    case 'diff_impact':
    case 'get_project_tour':
    case 'search_for_files':
    case 'search_in_file':
    case 'grep_search':
    case 'glob_files':
    case 'web_search':
    case 'browse_url':
    case 'search_symbols':
      digest = searchDigest(name, rawParams, content);
      break;
    case 'save_memory': {
      const key = paramText(rawParams, 'key') ?? '?';
      const type = paramText(rawParams, 'type') ?? '';
      digest = `${name}${type ? ` [${type}]` : ''} ${key}: saved.`;
      break;
    }
    case 'edit_file':
    case 'rewrite_file':
      digest = editDigest(name, rawParams, content);
      break;
    case 'rename_symbol':
      digest = renameDigest(name, rawParams, content);
      break;
    case 'run_subagent': {
      const description =
        typeof (rawParams as { description?: unknown })?.description === 'string'
          ? (rawParams as { description: string }).description.trim()
          : '';
      digest = description
        ? `${name} "${description}" → ${clip(content, 200)}`
        : fallbackDigest(name, rawParams);
      break;
    }
    case 'run_parallel_subagents': {
      const tasks = (rawParams as { tasks?: unknown })?.tasks;
      const n = Array.isArray(tasks) ? tasks.length : 0;
      digest = `${name} (${n} task${n === 1 ? '' : 's'}): ${clip(content, 220)}`;
      break;
    }
    case 'run_command':
    case 'run_persistent_command':
      digest = commandDigest(name, rawParams, content);
      break;
    case 'read_lint_errors':
    case 'get_diagnostics':
      digest = lintDigest(name, rawParams, content);
      break;
    case 'go_to_definition':
    case 'find_references':
      digest = codeNavDigest(name, rawParams, content);
      break;
    default:
      digest = fallbackDigest(name, rawParams);
  }
  return clip(digest, COMPACT_TOOL_MAX_CHARS);
}

/**
 * Длинные tool results вне защищённого окна → короткий digest.
 * Сообщения на месте (`id` / `rawParams` без изменений) — пары tool_calls сохраняются.
 * Digest не короче оригинала — пропуск.
 */
export function compactOldToolResults(messages: TrimableChatMessage[]): void {
  const length = messages.length;
  for (let i = 0; i < length; i += 1) {
    if (isProtectedChatIndex(i, length)) {
      continue;
    }
    const message = messages[i];
    if (message.role !== 'tool') {
      continue;
    }
    const digest = compactToolResult(message.name, message.rawParams, message.content);
    if (digest.length < message.content.length) {
      message.content = digest;
    }
  }
}
