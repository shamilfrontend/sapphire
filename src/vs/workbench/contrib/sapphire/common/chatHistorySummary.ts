/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatMessage } from './chatThreadServiceTypes.js';
import { URI } from '../../../../base/common/uri.js';
import { hasKey } from '../../../../base/common/types.js';

const CHAT_HISTORY_MAX_THREADS = 8;
const CHAT_HISTORY_MAX_CHARS = 10_000;
const CHAT_HISTORY_USER_QUERY_LIMIT = 3;
export const CHAT_HISTORY_USER_SNIPPET_CHARS = 200;
export const CHAT_HISTORY_ASSISTANT_SNIPPET_CHARS = 300;
const CHAT_HISTORY_RECENT_ACTIONS = 12;
const CHAT_HISTORY_DETAIL_ACTIONS = 40;

type ChatHistoryThreadLike = {
  id: string;
  lastModified: string;
  messages: ChatMessage[];
  state?: {
    activePlan?: {
      planUriFsPath: string;
      name: string;
      status: string;
    };
  };
};

type ChatHistorySummaryInput = {
  allThreads: { [id: string]: ChatHistoryThreadLike | undefined };
  currentThreadId: string;
  openThreadIds?: string[];
  threadId?: string | null;
};

const truncate = (text: string, maxChars: number): string => {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
};

const clipTotal = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 20))}\n…(truncated)`;
};

export const getChatThreadTitle = (thread: ChatHistoryThreadLike | undefined): string => {
  if (!thread) {
    return 'Новый чат';
  }
  const firstUserMsg = thread.messages.find((msg) => msg.role === 'user');
  if (firstUserMsg && firstUserMsg.role === 'user' && firstUserMsg.displayContent?.trim()) {
    return truncate(firstUserMsg.displayContent, 80);
  }
  return 'Новый чат';
};

const uriFsPath = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (URI.isUri(value)) {
    return value.fsPath;
  }
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'fsPath')) {
    const fsPath = (value as { fsPath?: unknown }).fsPath;
    if (typeof fsPath === 'string' && fsPath.trim()) {
      return fsPath.trim();
    }
  }
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'path')) {
    const path = (value as { path?: unknown }).path;
    if (typeof path === 'string' && path.trim()) {
      return path.trim();
    }
  }
  return null;
};

const rawParam = (msg: Extract<ChatMessage, { role: 'tool' }>, key: string): unknown => {
  if (msg.rawParams && typeof msg.rawParams === 'object' && Object.hasOwn(msg.rawParams, key)) {
    return (msg.rawParams as Record<string, unknown>)[key];
  }
  if (hasKey(msg, { params: true }) && msg.params && typeof msg.params === 'object') {
    const params = msg.params as Record<string, unknown>;
    if (Object.hasOwn(params, key)) {
      return params[key];
    }
    // camelCase-вариант ключа в typed params
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (Object.hasOwn(params, camel)) {
      return params[camel];
    }
    if (key === 'uri' && Object.hasOwn(params, 'uri')) {
      return params.uri;
    }
  }
  return undefined;
};

export const formatToolActionLine = (msg: Extract<ChatMessage, { role: 'tool' }>): string => {
  const name = String(msg.name);
  const status =
    msg.type === 'success'
      ? 'ok'
      : msg.type === 'tool_error'
        ? 'error'
        : msg.type === 'rejected'
          ? 'rejected'
          : msg.type === 'invalid_params'
            ? 'invalid'
            : msg.type;

  if (name === 'rename_symbol') {
    const newName = String(rawParam(msg, 'new_name') ?? rawParam(msg, 'newName') ?? '').trim();
    const symbol = String(rawParam(msg, 'symbol') ?? '').trim();
    const path = uriFsPath(rawParam(msg, 'uri'));
    const label = symbol && newName ? `${symbol}→${newName}` : newName || path || '?';
    return `${name} ${truncate(label, 120)} (${status})`;
  }
  if (
    name === 'edit_file' ||
    name === 'rewrite_file' ||
    name === 'create_file_or_folder' ||
    name === 'delete_file_or_folder' ||
    name === 'read_file'
  ) {
    const path = uriFsPath(rawParam(msg, 'uri')) ?? '?';
    return `${name} ${path} (${status})`;
  }
  if (name === 'run_command' || name === 'run_persistent_command') {
    const command = String(rawParam(msg, 'command') ?? '').trim();
    return `${name} ${truncate(command || '?', 120)} (${status})`;
  }
  if (name === 'create_plan' || name === 'update_plan') {
    const planName = String(rawParam(msg, 'name') ?? '').trim();
    const planUri = uriFsPath(rawParam(msg, 'plan_uri')) ?? uriFsPath(rawParam(msg, 'planUri'));
    const label = planName || planUri || '?';
    return `${name} ${truncate(label, 120)} (${status})`;
  }
  if (
    name === 'search_for_files' ||
    name === 'search_pathnames_only' ||
    name === 'search_in_file' ||
    name === 'grep_search' ||
    name === 'search_symbols' ||
    name === 'web_search'
  ) {
    const query = String(rawParam(msg, 'query') ?? '').trim();
    return `${name} "${truncate(query || '?', 80)}" (${status})`;
  }
  if (name === 'glob_files') {
    const pattern = String(rawParam(msg, 'pattern') ?? '').trim();
    return `${name} "${truncate(pattern || '?', 80)}" (${status})`;
  }
  if (name === 'browse_url') {
    const url = String(rawParam(msg, 'url') ?? '').trim();
    return `${name} ${truncate(url || '?', 120)} (${status})`;
  }
  if (name === 'save_memory') {
    const key = String(rawParam(msg, 'key') ?? '').trim();
    const type = String(rawParam(msg, 'type') ?? '').trim();
    return `${name}${type ? ` [${type}]` : ''} ${truncate(key || '?', 80)} (${status})`;
  }
  if (name === 'get_diagnostics') {
    const path = uriFsPath(rawParam(msg, 'uri'));
    return `${name} ${path ? truncate(path, 120) : 'workspace'} (${status})`;
  }
  if (name === 'get_chat_history') {
    const threadId = String(rawParam(msg, 'thread_id') ?? rawParam(msg, 'threadId') ?? '').trim();
    const label = threadId ? threadId.slice(0, 8) : 'overview';
    return `${name} ${label} (${status})`;
  }
  if (name === 'run_subagent') {
    const description = String(rawParam(msg, 'description') ?? '').trim();
    return `${name} ${truncate(description || '?', 80)} (${status})`;
  }
  if (name === 'run_parallel_subagents') {
    const tasks = rawParam(msg, 'tasks');
    const n = Array.isArray(tasks) ? tasks.length : 0;
    return `${name} (${n} tasks) (${status})`;
  }
  return `${name} (${status})`;
};

const recentUserQueries = (messages: ChatMessage[], limit: number): string[] => {
  const queries: string[] = [];
  for (let i = messages.length - 1; i >= 0 && queries.length < limit; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') {
      continue;
    }
    const text = (msg.displayContent || msg.content || '').trim();
    if (!text) {
      continue;
    }
    queries.push(truncate(text, CHAT_HISTORY_USER_SNIPPET_CHARS));
  }
  return queries.reverse();
};

const recentToolActions = (messages: ChatMessage[], limit: number): string[] => {
  const actions: string[] = [];
  for (let i = messages.length - 1; i >= 0 && actions.length < limit; i--) {
    const msg = messages[i];
    if (msg.role !== 'tool') {
      continue;
    }
    actions.push(formatToolActionLine(msg));
  }
  return actions.reverse();
};

const sortedOtherThreads = (
  allThreads: ChatHistorySummaryInput['allThreads'],
  currentThreadId: string,
): ChatHistoryThreadLike[] => {
  return Object.keys(allThreads)
    .map((id) => allThreads[id])
    .filter((t): t is ChatHistoryThreadLike => !!t && t.id !== currentThreadId)
    .filter((t) =>
      t.messages.some(
        (m) =>
          m.role === 'user' ||
          m.role === 'tool' ||
          m.role === 'assistant' ||
          m.role === 'context_summary',
      ),
    )
    .sort((a, b) =>
      a.lastModified < b.lastModified ? 1 : a.lastModified > b.lastModified ? -1 : 0,
    );
};

const buildOverview = (input: ChatHistorySummaryInput): string => {
  const { allThreads, currentThreadId, openThreadIds = [] } = input;
  const openSet = new Set(openThreadIds);
  const threads = sortedOtherThreads(allThreads, currentThreadId).slice(
    0,
    CHAT_HISTORY_MAX_THREADS,
  );

  if (threads.length === 0) {
    return 'No other chat threads with history were found.';
  }

  const lines: string[] = [];
  lines.push('Other chat threads (most recently modified first):');
  lines.push('');

  for (const thread of threads) {
    const title = getChatThreadTitle(thread);
    const isOpen = openSet.has(thread.id);
    lines.push(`## thread_id=${thread.id}`);
    lines.push(`title: ${title}`);
    lines.push(`last_modified: ${thread.lastModified}`);
    lines.push(`open_tab: ${isOpen ? 'yes' : 'no'}`);
    if (thread.state?.activePlan) {
      lines.push(
        `active_plan: ${thread.state.activePlan.name} (${thread.state.activePlan.status}) @ ${thread.state.activePlan.planUriFsPath}`,
      );
    }
    const queries = recentUserQueries(thread.messages, CHAT_HISTORY_USER_QUERY_LIMIT);
    if (queries.length) {
      lines.push('recent_user_queries:');
      for (const q of queries) {
        lines.push(`- ${q}`);
      }
    }
    const actions = recentToolActions(thread.messages, 5);
    if (actions.length) {
      lines.push('recent_actions:');
      for (const a of actions) {
        lines.push(`- ${a}`);
      }
    }
    lines.push('');
  }

  // Объединить tool-действия по тредам: lastModified desc, messageIndex desc
  const recentCross: { threadId: string; line: string }[] = [];
  const scored: { threadId: string; line: string; lastModified: string; messageIndex: number }[] =
    [];
  for (const thread of sortedOtherThreads(allThreads, currentThreadId)) {
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const msg = thread.messages[i];
      if (msg.role !== 'tool') {
        continue;
      }
      scored.push({
        threadId: thread.id,
        line: formatToolActionLine(msg),
        lastModified: thread.lastModified,
        messageIndex: i,
      });
    }
  }
  scored.sort((a, b) => {
    if (a.lastModified !== b.lastModified) {
      return a.lastModified < b.lastModified ? 1 : -1;
    }
    return b.messageIndex - a.messageIndex;
  });
  for (const item of scored) {
    if (recentCross.length >= CHAT_HISTORY_RECENT_ACTIONS) {
      break;
    }
    recentCross.push({ threadId: item.threadId, line: item.line });
  }

  if (recentCross.length) {
    lines.push('Recent actions across threads:');
    for (const a of recentCross) {
      lines.push(`- [${a.threadId.slice(0, 8)}…] ${a.line}`);
    }
  }

  return clipTotal(lines.join('\n').trim(), CHAT_HISTORY_MAX_CHARS);
};

const buildDetail = (input: ChatHistorySummaryInput, threadId: string): string => {
  const thread = input.allThreads[threadId];
  if (!thread || thread.id === input.currentThreadId) {
    return `Chat thread not found or is the current thread: ${threadId}`;
  }

  const lines: string[] = [];
  lines.push(`Chat thread detail: ${threadId}`);
  lines.push(`title: ${getChatThreadTitle(thread)}`);
  lines.push(`last_modified: ${thread.lastModified}`);
  if (thread.state?.activePlan) {
    lines.push(
      `active_plan: ${thread.state.activePlan.name} (${thread.state.activePlan.status}) @ ${thread.state.activePlan.planUriFsPath}`,
    );
  }
  lines.push('');
  lines.push('Transcript (condensed):');

  let toolCount = 0;
  for (const msg of thread.messages) {
    if (msg.role === 'checkpoint' || msg.role === 'interrupted_streaming_tool') {
      continue;
    }
    if (msg.role === 'user') {
      const text = (msg.displayContent || msg.content || '').trim();
      if (!text) {
        continue;
      }
      lines.push(`USER: ${truncate(text, CHAT_HISTORY_USER_SNIPPET_CHARS)}`);
      continue;
    }
    if (msg.role === 'assistant') {
      const text = (msg.displayContent || '').trim();
      if (!text) {
        continue;
      }
      lines.push(`ASSISTANT: ${truncate(text, CHAT_HISTORY_ASSISTANT_SNIPPET_CHARS)}`);
      continue;
    }
    if (msg.role === 'context_summary') {
      const text = (msg.content || msg.displayContent || '').trim();
      if (!text) {
        continue;
      }
      lines.push(`SUMMARY: ${truncate(text, CHAT_HISTORY_ASSISTANT_SNIPPET_CHARS)}`);
      continue;
    }
    if (msg.role === 'tool') {
      if (toolCount >= CHAT_HISTORY_DETAIL_ACTIONS) {
        continue;
      }
      toolCount++;
      lines.push(`TOOL: ${formatToolActionLine(msg)}`);
    }
  }

  if (lines.length <= 5) {
    lines.push('(no user/assistant/tool messages)');
  }

  return clipTotal(lines.join('\n').trim(), CHAT_HISTORY_MAX_CHARS);
};

/** Сжатая история чата для tool get_chat_history. */
export const buildChatHistorySummary = (input: ChatHistorySummaryInput): string => {
  const threadId = input.threadId?.trim() || null;
  if (threadId) {
    return buildDetail(input, threadId);
  }
  return buildOverview(input);
};
