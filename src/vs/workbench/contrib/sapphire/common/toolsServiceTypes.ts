import { URI } from '../../../../base/common/uri.js';
import { RawMCPToolCall } from './mcpServiceTypes.js';
import { builtinTools } from './prompt/prompts.js';
import { RawToolParamsObj } from './sendLLMMessageTypes.js';

export type TerminalResolveReason = { type: 'timeout' } | { type: 'done'; exitCode: number };

export type LintErrorItem = {
  code: string;
  message: string;
  startLineNumber: number;
  endLineNumber: number;
};

/** Одна позиция go_to_definition / find_references (путь, диапазон, превью строки). */
export type CodeNavLocation = {
  uri: URI;
  startLine: number;
  endLine: number;
  preview: string;
};

/** Одно совпадение grep_search (путь, строка с 1, текст строки). */
export type GrepSearchMatch = {
  uri: URI;
  lineNumber: number;
  lineContent: string;
};

/** Одна диагностика workspace/файла из get_diagnostics. */
export type WorkspaceDiagnosticItem = {
  uri: URI;
  message: string;
  severity: 'error' | 'warning';
  startLine: number;
  endLine: number;
  source: string | null;
  code: string | null;
};

/** Один символ из search_symbols. */
export type SymbolSearchHit = {
  name: string;
  kind: string;
  uri: URI;
  startLine: number;
  endLine: number;
};

/** Одно применённое место rename_symbol. */
export type RenameSymbolChange = {
  uri: URI;
  startLine: number;
  endLine: number;
  oldText: string;
  newText: string;
};

/** Один файл из glob_files. */
export type GlobFileHit = {
  uri: URI;
  mtime: number;
  size: number;
};

/** Один результат web_search. */
export type WebSearchHit = {
  title: string;
  snippet: string;
  url: string;
};

export type MemoryType = 'decision' | 'preference' | 'context';

export type ParallelSubagentTask = {
  description: string;
  prompt: string;
};

type ParallelSubagentResultItem = {
  description: string;
  summary: string;
  completed: boolean;
};

export type PlanTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type PlanTodoItem = {
  id: string;
  content: string;
  status: PlanTodoStatus;
};

// Урезанный IFileStat
export type ShallowDirectoryItem = {
  uri: URI;
  name: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
};

export const approvalTypeOfBuiltinToolName: Partial<{
  [T in BuiltinToolName]?: 'edits' | 'terminal' | 'MCP tools' | 'network';
}> = {
  create_file_or_folder: 'edits',
  delete_file_or_folder: 'edits',
  rewrite_file: 'edits',
  edit_file: 'edits',
  rename_symbol: 'edits',
  run_command: 'terminal',
  run_persistent_command: 'terminal',
  open_persistent_terminal: 'terminal',
  kill_persistent_terminal: 'terminal',
  web_search: 'network',
  browse_url: 'network',
};

export type ToolApprovalType = NonNullable<
  (typeof approvalTypeOfBuiltinToolName)[keyof typeof approvalTypeOfBuiltinToolName]
>;

export const toolApprovalTypes = new Set<ToolApprovalType>([
  ...Object.values(approvalTypeOfBuiltinToolName),
  'MCP tools',
]);

// Параметры вызова tool
export type BuiltinToolCallParams = {
  read_file: { uri: URI; startLine: number | null; endLine: number | null; pageNumber: number };
  ls_dir: { uri: URI; pageNumber: number };
  get_dir_tree: { uri: URI };
  search_pathnames_only: { query: string; includePattern: string | null; pageNumber: number };
  search_project_index: { query: string; pageNumber: number };
  diff_impact: { paths: string | null };
  get_project_tour: {};
  search_for_files: {
    query: string;
    isRegex: boolean;
    searchInFolder: URI | null;
    pageNumber: number;
  };
  search_in_file: { uri: URI; query: string; isRegex: boolean };
  grep_search: {
    query: string;
    includePattern: string | null;
    excludePattern: string | null;
    isRegex: boolean;
    caseSensitive: boolean;
  };
  read_lint_errors: { uri: URI };
  get_diagnostics: { uri: URI | null };
  go_to_definition: { uri: URI; line: number; symbol: string | null };
  find_references: { uri: URI; line: number; symbol: string | null };
  search_symbols: { query: string; uri: URI | null };
  rename_symbol: { uri: URI; line: number; symbol: string | null; newName: string };
  glob_files: { pattern: string; limit: number };
  web_search: { query: string; k: number };
  browse_url: { url: string };
  save_memory: { type: MemoryType; key: string; value: string; tags: string[] | null };
  run_subagent: { description: string; prompt: string };
  run_parallel_subagents: { tasks: ParallelSubagentTask[] };
  // ---
  get_chat_history: { threadId: string | null };
  enable_mcp_server: { serverName: string };
  // ---
  create_plan: { name: string; overview: string; plan: string; todos: PlanTodoItem[] };
  update_plan: {
    planUri: URI;
    name: string | null;
    overview: string | null;
    plan: string | null;
    todos: PlanTodoItem[] | null;
  };
  // ---
  rewrite_file: { uri: URI; newContent: string };
  edit_file: { uri: URI; searchReplaceBlocks: string };
  create_file_or_folder: { uri: URI; isFolder: boolean };
  delete_file_or_folder: { uri: URI; isRecursive: boolean; isFolder: boolean };
  // ---
  run_command: { command: string; cwd: string | null; terminalId: string };
  open_persistent_terminal: { cwd: string | null };
  run_persistent_command: { command: string; persistentTerminalId: string };
  kill_persistent_terminal: { persistentTerminalId: string };
};

// Результат вызова tool
export type BuiltinToolResultType = {
  read_file: {
    fileContents: string;
    totalFileLen: number;
    totalNumLines: number;
    hasNextPage: boolean;
  };
  ls_dir: {
    children: ShallowDirectoryItem[] | null;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    itemsRemaining: number;
  };
  get_dir_tree: { str: string };
  search_pathnames_only: { uris: URI[]; hasNextPage: boolean };
  search_project_index: {
    hits: Array<{
      uri: URI;
      score: number;
      purpose: string | null;
      localRole: string;
      tags: string[];
      anchor: string | null;
      kind: string;
    }>;
    hasNextPage: boolean;
  };
  diff_impact: {
    summary: string;
    changedPaths: string[];
    affected: Array<{ path: string; symbol: string | null; via: string; hops: number }>;
    layers: string[];
  };
  get_project_tour: {
    summary: string;
    stepCount: number;
    stale: boolean;
  };
  search_for_files: { uris: URI[]; hasNextPage: boolean };
  search_in_file: { lines: number[] };
  grep_search: { matches: GrepSearchMatch[]; totalMatches: number };
  read_lint_errors: { lintErrors: LintErrorItem[] | null };
  get_diagnostics: { diagnostics: WorkspaceDiagnosticItem[] };
  go_to_definition: { locations: CodeNavLocation[]; message: string | null };
  find_references: {
    locations: CodeNavLocation[];
    truncated: boolean;
    message: string | null;
  };
  search_symbols: { symbols: SymbolSearchHit[]; truncated: boolean };
  rename_symbol: {
    oldName: string;
    newName: string;
    changes: RenameSymbolChange[];
    applied: boolean;
  };
  glob_files: { files: GlobFileHit[]; truncated: boolean };
  web_search: { results: WebSearchHit[] };
  browse_url: { content: string; title: string | null; url: string };
  save_memory: { acknowledged: true; key: string };
  run_subagent: {
    summary: string;
    completed: boolean;
  };
  run_parallel_subagents: { results: ParallelSubagentResultItem[] };
  // ---
  get_chat_history: { summary: string };
  enable_mcp_server: { serverName: string; toolNames: string[] };
  // ---
  create_plan: { planUri: URI; name: string; overview: string; todos: PlanTodoItem[] };
  update_plan: { planUri: URI; name: string; overview: string; todos: PlanTodoItem[] };
  // ---
  rewrite_file: Promise<{ lintErrors: LintErrorItem[] | null }>;
  edit_file: Promise<{ lintErrors: LintErrorItem[] | null }>;
  create_file_or_folder: {};
  delete_file_or_folder: {};
  // ---
  run_command: { result: string; resolveReason: TerminalResolveReason };
  run_persistent_command: { result: string; resolveReason: TerminalResolveReason };
  open_persistent_terminal: { persistentTerminalId: string };
  kill_persistent_terminal: {};
};

export type ToolCallParams<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName
  ? BuiltinToolCallParams[T]
  : RawToolParamsObj;
export type ToolResult<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName
  ? BuiltinToolResultType[T]
  : RawMCPToolCall;

export type BuiltinToolName = keyof BuiltinToolResultType;

type BuiltinToolParamNameOfTool<T extends BuiltinToolName> =
  keyof (typeof builtinTools)[T]['params'];

export type ToolName = BuiltinToolName | (string & {});
export type ToolParamName<T extends ToolName> = T extends BuiltinToolName
  ? BuiltinToolParamNameOfTool<T>
  : string;
