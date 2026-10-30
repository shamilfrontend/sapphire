/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../../base/common/errors.js';
import { IDirectoryStrService } from '../directoryStrService.js';
import { StagingSelectionItem } from '../chatThreadServiceTypes.js';
import { estimateTextTokens } from '../estimateTokens.js';
import { os } from '../helpers/systemInfo.js';
import {
  approvalTypeOfBuiltinToolName,
  BuiltinToolCallParams,
  BuiltinToolName,
  BuiltinToolResultType,
} from '../toolsServiceTypes.js';
import { omittedToolBodyPrompt, parallelReadOnlyToolPrompt } from '../toolCallSchedule.js';
import { ChatMode } from '../sapphireSettingsTypes.js';
import { enableMcpServerToolDescription, selectEnabledMcpTools } from './mcpToolDisclosure.js';
import { formatOfficePage, OfficeExtractPayload } from '../office/officeDocument.js';

// Обёртка ``` для блоков кода в промптах
export const tripleTick = ['```', '```'];

// Лимиты символов для дерева каталогов в контексте
export const MAX_DIRSTR_CHARS_TOTAL_BEGINNING = 20_000;
export const MAX_DIRSTR_CHARS_TOTAL_TOOL = 20_000;

// Лимиты инструментов чтения/поиска
export const MAX_FILE_CHARS_PAGE = 500_000;
export const MAX_CHILDREN_URIs_PAGE = 500;

// Лимиты терминальных инструментов
export const MAX_TERMINAL_CHARS = 100_000;
export const MAX_TERMINAL_INACTIVE_TIME = 5; // секунды неактивности
export const MAX_TERMINAL_BG_COMMAND_TIME = 5;
/** Жёсткий wall-clock для временного run_command (не зависит от onData). */
export const MAX_TERMINAL_ABSOLUTE_TIME = 30; // секунды
/** Жёсткий wall-clock для любого agent tool / MCP (setup + выполнение). */
export const MAX_TOOL_ABSOLUTE_TIME = 60; // секунды
/** Жёсткий wall-clock для run_subagent (Stop родителя может прервать раньше). */
export const MAX_SUBAGENT_ABSOLUTE_TIME = 600; // секунды
/** Пауза перед опросом линтера после rewrite_file / edit_file (раньше 2000 ms). */
export const LINT_POLL_AFTER_EDIT_MS = 400;

// Префикс/суффикс для FIM и apply (Ctrl+K)
const MAX_PREFIX_SUFFIX_CHARS = 20_000;

export const ORIGINAL = `<<<<<<< ORIGINAL`;
export const DIVIDER = `=======`;
export const FINAL = `>>>>>>> UPDATED`;

const searchReplaceBlockTemplate = `\
${ORIGINAL}
// ... original code goes here
${DIVIDER}
// ... final code goes here
${FINAL}

${ORIGINAL}
// ... original code goes here
${DIVIDER}
// ... final code goes here
${FINAL}`;

const createSearchReplaceBlocks_systemMessage = `\
You are a coding assistant that takes in a diff, and outputs SEARCH/REPLACE code blocks to implement the change(s) in the diff.
The diff will be labeled \`DIFF\` and the original file will be labeled \`ORIGINAL_FILE\`.

Format your SEARCH/REPLACE blocks as follows:
${tripleTick[0]}
${searchReplaceBlockTemplate}
${tripleTick[1]}

1. Your SEARCH/REPLACE block(s) must implement the diff EXACTLY. Do NOT leave anything out.

2. You are allowed to output multiple SEARCH/REPLACE blocks to implement the change.

3. Assume any comments in the diff are PART OF THE CHANGE. Include them in the output.

4. Your output should consist ONLY of SEARCH/REPLACE blocks. Do NOT output any text or explanations before or after this.

5. The ORIGINAL code in each SEARCH/REPLACE block must EXACTLY match lines in the original file. Do not add or remove any whitespace, comments, or modifications from the original code.

6. Each ORIGINAL text must be large enough to uniquely identify the change in the file. However, bias towards writing as little as possible.

7. Each ORIGINAL text must be DISJOINT from all other ORIGINAL text.

## EXAMPLE 1
DIFF
${tripleTick[0]}
// ... existing code
let x = 6.5
// ... existing code
${tripleTick[1]}

ORIGINAL_FILE
${tripleTick[0]}
let w = 5
let x = 6
let y = 7
let z = 8
${tripleTick[1]}

ACCEPTED OUTPUT
${tripleTick[0]}
${ORIGINAL}
let x = 6
${DIVIDER}
let x = 6.5
${FINAL}
${tripleTick[1]}`;

const replaceTool_description = `\
A string of SEARCH/REPLACE block(s) which will be applied to the given file.
Your SEARCH/REPLACE blocks string must be formatted as follows:
${searchReplaceBlockTemplate}

## Guidelines:

1. You may output multiple search replace blocks if needed.

2. The ORIGINAL code in each SEARCH/REPLACE block must EXACTLY match lines in the original file. Do not add or remove any whitespace or comments from the original code.

3. Each ORIGINAL text must be large enough to uniquely identify the change. However, bias towards writing as little as possible.

4. Each ORIGINAL text must be DISJOINT from all other ORIGINAL text.

5. This field is a STRING (not an array).`;

// ======================================================== инструменты ========================================================

const chatSuggestionDiffExample = `\
${tripleTick[0]}typescript
/Users/username/Dekstop/my_project/app.ts
// ... existing code ...
// {{change 1}}
// ... existing code ...
// {{change 2}}
// ... existing code ...
// {{change 3}}
// ... existing code ...
${tripleTick[1]}`;

export type InternalToolInfo = {
  name: string;
  description: string;
  params: {
    [paramName: string]: { description: string };
  };
  // Только для инструментов с MCP-сервера
  mcpServerName?: string;
};

const uriParam = (object: string) => ({
  uri: { description: `The FULL path to the ${object}.` },
});

const paginationParam = {
  page_number: { description: 'Optional. The page number of the result. Default is 1.' },
} as const;

const terminalDescHelper = `You can use this tool to run any command: sed, grep, etc. Do not edit any files with this tool; use edit_file instead. When working with git and other tools that open an editor (e.g. git diff), you should pipe to cat to get all results and not get stuck in vim.`;

const cwdHelper =
  'Optional. Absolute or workspace-relative path to an existing directory in which to run the command. Never put the command, flags, or file lists in cwd — only the directory. If unsure, omit cwd (defaults to the first workspace folder).';

type SnakeCase<S extends string> =
  // Акроним URI целиком
  S extends 'URI'
    ? 'uri'
    : // Суффикс URI: rootURI → snakeCase('root') + '_uri'
      S extends `${infer Prefix}URI`
      ? `${SnakeCase<Prefix>}_uri`
      : // По умолчанию: перед заглавными буквами добавляем '_'
        S extends `${infer C}${infer Rest}`
        ? `${C extends Lowercase<C> ? C : `_${Lowercase<C>}`}${SnakeCase<Rest>}`
        : S;

type SnakeCaseKeys<T extends object> = {
  [K in keyof T as SnakeCase<Extract<K, string>>]: T[K];
};

export const builtinTools: {
  [T in keyof BuiltinToolCallParams]: {
    name: string;
    description: string;
    // LLM может прислать лишние поля; здесь — минимальный набор для схемы
    params: Partial<{
      [paramName in keyof SnakeCaseKeys<BuiltinToolCallParams[T]>]: { description: string };
    }>;
  };
} = {
  // --- сбор контекста (чтение / поиск / списки) ---

  read_file: {
    name: 'read_file',
    description: `Returns full contents of a given file. Office files (.xlsx, .xlsm, .docx, .pptx, .pdf) come back as extracted text (sheets, paragraphs, slides, or pages), not raw bytes.`,
    params: {
      ...uriParam('file'),
      start_line: {
        description:
          'Optional. Do NOT fill this field in unless you were specifically given exact line numbers to search. Defaults to the beginning of the file.',
      },
      end_line: {
        description:
          'Optional. Do NOT fill this field in unless you were specifically given exact line numbers to search. Defaults to the end of the file.',
      },
      ...paginationParam,
    },
  },

  ls_dir: {
    name: 'ls_dir',
    description: `Lists all files and folders in the given URI.`,
    params: {
      uri: {
        description: `Optional. The FULL path to the ${'folder'}. Leave this as empty or "" to search all folders.`,
      },
      ...paginationParam,
    },
  },

  get_dir_tree: {
    name: 'get_dir_tree',
    description: `This is a very effective way to learn about the user's codebase. Returns a tree diagram of all the files and folders in the given folder. `,
    params: {
      ...uriParam('folder'),
    },
  },

  // pathname_search: {
  // 	name: 'pathname_search',
  // 	description: `Returns all pathnames that match a given \`find\`-style query over the entire workspace. ONLY searches file names. ONLY searches the current workspace. You should use this when looking for a file with a specific name or path. ${paginationHelper.desc}`,

  search_pathnames_only: {
    name: 'search_pathnames_only',
    description: `Returns all pathnames that match a given query (searches ONLY file names). You should use this when looking for a file with a specific name or path.`,
    params: {
      query: { description: `Your query for the search.` },
      include_pattern: {
        description:
          'Optional. Only fill this in if you need to limit your search because there were too many results.',
      },
      ...paginationParam,
    },
  },

  search_project_index: {
    name: 'search_project_index',
    description: `Search the local project index (.sapphire/index) by path, purpose, tags, symbols, and extracted text (code + office docs). Prefer this when finding which file is about a topic before read_file. Returns scored hits with purpose/localRole.`,
    params: {
      query: { description: `Natural-language or keyword query for the project index.` },
      ...paginationParam,
    },
  },

  diff_impact: {
    name: 'diff_impact',
    description: `1-hop impact from the project index for workspace-relative file paths. Uses imports and calls (not node_modules) plus the file's architectural layer. Pass paths separated by commas or newlines.`,
    params: {
      paths: {
        description:
          'Workspace-relative paths of changed files, separated by commas or newlines. Example: src/cart/Checkout.tsx, src/cart/billing.ts',
      },
    },
  },

  get_project_tour: {
    name: 'get_project_tour',
    description: `Return the saved onboarding tour for this workspace (.sapphire/index/tour.json): ordered steps with titles, descriptions, and key file paths. Prefer this when the user asks how the project is structured, for onboarding, or where to start reading. If missing, the tour is generated automatically as part of indexing when the index is ready.`,
    params: {},
  },

  search_for_files: {
    name: 'search_for_files',
    description: `Returns a list of file paths whose content matches the given query (paths only, no line text). Prefer grep_search when you need matching lines. The query can be any substring or regex.`,
    params: {
      query: { description: `Your query for the search.` },
      search_in_folder: {
        description:
          'Optional. Leave as blank by default. ONLY fill this in if your previous search with the same query was truncated. Searches descendants of this folder only.',
      },
      is_regex: { description: 'Optional. Default is false. Whether the query is a regex.' },
      ...paginationParam,
    },
  },

  search_in_file: {
    name: 'search_in_file',
    description: `Returns an array of all the start line numbers where the content appears in the file. For office files, searches the extracted text.`,
    params: {
      ...uriParam('file'),
      query: { description: 'The string or regex to search for in the file.' },
      is_regex: { description: 'Optional. Default is false. Whether the query is a regex.' },
    },
  },

  grep_search: {
    name: 'grep_search',
    description: `Search file contents across the workspace and return matching lines (path, 1-based line number, line text). Prefer this over search_for_files when you need to see the matches. Use exact strings or regex for identifiers, error messages, and call sites. Cap is 300 matches.`,
    params: {
      query: { description: 'Substring or regex to search for in file contents.' },
      include_pattern: {
        description:
          'Optional. Glob to include (e.g. "*.ts" or "src/**"). Leave blank to search everything.',
      },
      exclude_pattern: {
        description: 'Optional. Glob to exclude (e.g. "**/node_modules/**" or "*.min.js").',
      },
      is_regex: { description: 'Optional. Default is false. Whether the query is a regex.' },
      case_sensitive: {
        description: 'Optional. Default is false. Whether the search is case-sensitive.',
      },
    },
  },

  glob_files: {
    name: 'glob_files',
    description: `Find files by glob pattern (e.g. "**/*.ts", "src/**/*.tsx"). Returns paths with mtime and size, newest first. Prefer this over search_pathnames_only when you know a glob; use search_pathnames_only for fuzzy name queries.`,
    params: {
      pattern: { description: 'Glob pattern relative to the workspace (e.g. "**/*.ts").' },
      limit: {
        description: 'Optional. Max files to return (default 100, max 1000).',
      },
    },
  },

  web_search: {
    name: 'web_search',
    description: `Search the public web for up-to-date information. Returns titles, snippets, and URLs. Use when docs, APIs, or facts are not in the workspace.`,
    params: {
      query: { description: 'Search query.' },
      k: {
        description: 'Optional. Number of results (default 5, max 10).',
      },
    },
  },

  browse_url: {
    name: 'browse_url',
    description: `Fetch and extract readable text from a public http(s) URL. Use after web_search to read a specific page. Do not use for localhost or private network addresses. To click, type, or open a local app, use browser_navigate instead.`,
    params: {
      url: { description: 'Full http(s) URL to fetch.' },
    },
  },

  browser_navigate: {
    name: 'browser_navigate',
    description: `Open an http(s) URL in the integrated browser the user can see, including localhost. Returns pageId and an accessibility snapshot with element refs. Reuses the last page opened by this tool. Prefer browser_snapshot on an already-listed open tab instead of navigating to the same URL again.`,
    params: {
      url: { description: 'Absolute http(s) URL. localhost and 127.0.0.1 are allowed. Private LAN addresses are not.' },
    },
  },

  browser_snapshot: {
    name: 'browser_snapshot',
    description: `Read the current accessibility snapshot of an open browser page, including element refs. Call this after navigation or any DOM change before the next click or type. Works on tabs the user already opened (see Open browser tabs in system info).`,
    params: {
      page_id: { description: 'Optional. Page id from system info or browser_navigate. Omit to use the active/visible browser tab.' },
    },
  },

  browser_click: {
    name: 'browser_click',
    description: `Click an element in the integrated browser. ref must come from the latest browser_navigate or browser_snapshot. Do not invent refs.`,
    params: {
      page_id: { description: 'Optional. Page id from system info or browser_navigate. Omit to use the active/visible browser tab.' },
      ref: { description: 'Element ref from the latest snapshot (aria-ref).' },
      element: { description: 'Short human-readable name of the element, shown in the approval card.' },
    },
  },

  browser_type: {
    name: 'browser_type',
    description: `Type text into an element in the integrated browser. ref must come from the latest snapshot. Set submit true to press Enter after filling.`,
    params: {
      page_id: { description: 'Optional. Page id from system info or browser_navigate. Omit to use the active/visible browser tab.' },
      ref: { description: 'Element ref from the latest snapshot (aria-ref).' },
      element: { description: 'Short human-readable name of the field, shown in the approval card.' },
      text: { description: 'Text to fill into the element.' },
      submit: { description: 'Optional. If true, press Enter after filling. Default false.' },
    },
  },

  browser_scroll: {
    name: 'browser_scroll',
    description: `Scroll the integrated browser page up or down, then return a fresh snapshot.`,
    params: {
      page_id: { description: 'Optional. Page id from system info or browser_navigate. Omit to use the active/visible browser tab.' },
      direction: { description: 'Either "up" or "down".' },
    },
  },

  browser_screenshot: {
    name: 'browser_screenshot',
    description: `Capture a screenshot of the integrated browser page for the user. Also returns the accessibility snapshot.`,
    params: {
      page_id: { description: 'Optional. Page id from system info or browser_navigate. Omit to use the active/visible browser tab.' },
    },
  },

  save_memory: {
    name: 'save_memory',
    description: `Persist a short fact for later turns in this workspace (decision, preference, or context). Use for durable user choices and project conventions — not for temporary task notes.`,
    params: {
      type: {
        description: 'One of: decision | preference | context.',
      },
      key: { description: 'Short stable key (e.g. "package-manager").' },
      value: { description: 'The fact to remember.' },
      tags: {
        description: 'Optional. Comma-separated tags for retrieval.',
      },
    },
  },

  read_lint_errors: {
    name: 'read_lint_errors',
    description: `Use this tool to view all the lint errors on a file.`,
    params: {
      ...uriParam('file'),
    },
  },

  get_diagnostics: {
    name: 'get_diagnostics',
    description: `Return error and warning diagnostics from the language/linter services. Omit uri for the whole workspace; pass uri for a single file. Prefer this after multi-file edits; use read_lint_errors when you only care about one known file.`,
    params: {
      uri: {
        description:
          'Optional. FULL path to a file. Leave empty or "" for workspace-wide diagnostics.',
      },
    },
  },

  go_to_definition: {
    name: 'go_to_definition',
    description: `Jump to the definition of a symbol using the language service. Returns file paths, line ranges, and a one-line preview — not the full file body. Prefer this over grep_search when you already know the file and line of a symbol.`,
    params: {
      ...uriParam('file'),
      line: {
        description: '1-based line number where the symbol appears (or near it).',
      },
      symbol: {
        description:
          'Optional. Exact symbol name on that line. When set, the position is the first occurrence of this name on the line; otherwise the start of the line.',
      },
    },
  },

  find_references: {
    name: 'find_references',
    description: `Find references to a symbol using the language service (includes the declaration). Returns up to 30 locations with path, line range, and a one-line preview — not full file bodies. Prefer this over grep_search for call sites when you know the symbol's file and line.`,
    params: {
      ...uriParam('file'),
      line: {
        description: '1-based line number where the symbol appears (or near it).',
      },
      symbol: {
        description:
          'Optional. Exact symbol name on that line. When set, the position is the first occurrence of this name on the line; otherwise the start of the line.',
      },
    },
  },

  search_symbols: {
    name: 'search_symbols',
    description: `Find classes, functions, methods, and other symbols by name via the language service. Omit uri to search the workspace; pass uri to search one file's outline. Prefer this when looking for a named symbol whose file you do not know yet; use go_to_definition / find_references once you have a file and line.`,
    params: {
      query: { description: 'Symbol name or substring to match (case-insensitive).' },
      uri: {
        description:
          'Optional. FULL path to a file to search only that file outline. Leave empty for workspace symbol search.',
      },
    },
  },

  rename_symbol: {
    name: 'rename_symbol',
    description: `Rename a symbol across the workspace using the language rename service (LSP) and apply the edits. Prefer this over grep_search + edit_file when renaming a class, function, method, or variable. Requires the file and line of the symbol (optional exact symbol name on that line).`,
    params: {
      ...uriParam('file'),
      line: {
        description: '1-based line number where the symbol appears (or near it).',
      },
      symbol: {
        description:
          'Optional. Exact symbol name on that line. When set, the position is the first occurrence of this name on the line; otherwise the start of the line.',
      },
      new_name: { description: 'The new identifier for the symbol.' },
    },
  },

  run_subagent: {
    name: 'run_subagent',
    description: `Spawn an isolated child agent with its own tool loop to research or implement a focused subtask, then return only a summary. Use for parallelizable investigation or a self-contained chunk of work that would clutter this thread. The child does NOT see this chat history — put ALL needed context in prompt. Do not nest: a sub-agent cannot call run_subagent.`,
    params: {
      description: {
        description: 'Short label (3–7 words) shown in the UI for this sub-agent run.',
      },
      prompt: {
        description:
          'Full self-contained brief for the child agent: goal, constraints, relevant paths, and what to return in the final summary.',
      },
    },
  },

  run_parallel_subagents: {
    name: 'run_parallel_subagents',
    description: `Run up to 4 read-only child agents in parallel for independent research tasks. Each child gets only its prompt (no parent history) and cannot edit files or use the network. Prefer this over multiple sequential run_subagent calls for independent investigations.`,
    params: {
      tasks: {
        description:
          'JSON array of { "description": "3-7 words", "prompt": "full brief" }. Max 4 items.',
      },
    },
  },

  get_chat_history: {
    name: 'get_chat_history',
    description: `Returns a condensed summary of other chat tabs/threads (user queries and recent tool actions). Use when the user asks what you were doing before, where you left off, to continue prior work from another tab, or otherwise refers to past chat history. Omit thread_id for an overview of recent threads; pass thread_id to get a condensed transcript of that thread.`,
    params: {
      thread_id: {
        description:
          'Optional. ID of another chat thread to inspect in detail. Leave empty for a multi-thread overview.',
      },
    },
  },

  // --- планирование (режим plan) ---

  create_plan: {
    name: 'create_plan',
    description: `Create an implementation plan file in the workspace (.sapphire/plans/*.plan.md). Use this in Plan mode after researching the codebase. Do NOT edit application code with this tool — only write the plan. Include a mermaid flowchart in the plan body when the flow is non-trivial.`,
    params: {
      name: { description: 'Short plan title.' },
      overview: { description: 'One or two sentence summary of the approach.' },
      plan: {
        description:
          'Markdown body of the plan (sections, file paths, optional ```mermaid diagram). Do not include YAML frontmatter.',
      },
      todos: {
        description:
          'JSON array of todo objects: [{"id":"step-1","content":"..."}]. Status defaults to pending.',
      },
    },
  },

  update_plan: {
    name: 'update_plan',
    description: `Update an existing plan file (overview, body, and/or todo statuses). Use after create_plan when refining the plan, or in Agent mode to mark todos in_progress/completed while implementing.`,
    params: {
      plan_uri: { description: 'Full path to the existing .plan.md file.' },
      name: { description: 'Optional. New plan title.' },
      overview: { description: 'Optional. New overview.' },
      plan: { description: 'Optional. Replacement markdown body (no frontmatter).' },
      todos: {
        description:
          'Optional. JSON array of todos with id, content, and status (pending|in_progress|completed|cancelled). Replaces the full todo list.',
      },
    },
  },

  // --- правки (создание / удаление) ---

  create_file_or_folder: {
    name: 'create_file_or_folder',
    description: `Create an empty file or a folder at the given path. To create a folder, the path MUST end with a trailing slash. For a new file that already has content, use rewrite_file instead (one call creates the file and writes new_content).`,
    params: {
      ...uriParam('file or folder'),
    },
  },

  delete_file_or_folder: {
    name: 'delete_file_or_folder',
    description: `Delete a file or folder at the given path.`,
    params: {
      ...uriParam('file or folder'),
      is_recursive: { description: 'Optional. Return true to delete recursively.' },
    },
  },

  edit_file: {
    name: 'edit_file',
    description: `Edit the contents of a file. You must provide the file's URI as well as a SINGLE string of SEARCH/REPLACE block(s) that will be used to apply the edit.`,
    params: {
      ...uriParam('file'),
      search_replace_blocks: { description: replaceTool_description },
    },
  },

  rewrite_file: {
    name: 'rewrite_file',
    description: `Creates a file if it does not exist, or replaces all contents of an existing file, with your new_content. Prefer this single call for new files instead of create_file_or_folder + rewrite_file.`,
    params: {
      ...uriParam('file'),
      new_content: { description: `The new contents of the file. Must be a string.` },
    },
  },
  run_command: {
    name: 'run_command',
    description: `Runs a terminal command and waits for the result (times out after ${MAX_TERMINAL_INACTIVE_TIME}s of inactivity, or ${MAX_TERMINAL_ABSOLUTE_TIME}s absolute). ${terminalDescHelper} Do NOT use complex node -e one-liners with nested quotes — they hang the shell. To read or verify files, use read_file. For non-trivial scripts, write a .js/.sh file with rewrite_file then run e.g. node check.js (do not wrap the whole command in quotes).`,
    params: {
      command: {
        description:
          'The terminal command to run. Plain command text only — do not wrap the entire command in quotes.',
      },
      cwd: { description: cwdHelper },
    },
  },

  run_persistent_command: {
    name: 'run_persistent_command',
    description: `Runs a terminal command in the persistent terminal that you created with open_persistent_terminal (results after ${MAX_TERMINAL_BG_COMMAND_TIME} are returned, and command continues running in background). ${terminalDescHelper}`,
    params: {
      command: { description: 'The terminal command to run.' },
      persistent_terminal_id: {
        description: 'The ID of the terminal created using open_persistent_terminal.',
      },
    },
  },

  open_persistent_terminal: {
    name: 'open_persistent_terminal',
    description: `Use this tool when you want to run a terminal command indefinitely, like a dev server (eg \`npm run dev\`), a background listener, etc. Opens a new terminal in the user's environment which will not awaited for or killed.`,
    params: {
      cwd: { description: cwdHelper },
    },
  },

  kill_persistent_terminal: {
    name: 'kill_persistent_terminal',
    description: `Interrupts and closes a persistent terminal that you opened with open_persistent_terminal.`,
    params: { persistent_terminal_id: { description: `The ID of the persistent terminal.` } },
  },

  enable_mcp_server: {
    name: 'enable_mcp_server',
    description: `Enable an MCP server for the rest of this thread. Call this before using that server's tools. The server's tools are available on your next response, not in this one.`,
    params: {
      server_name: {
        description: `The MCP server name to enable. Use a name from the list in this tool's description.`,
      },
    },
  },

} satisfies { [T in keyof BuiltinToolResultType]: InternalToolInfo };

export const builtinToolNames = Object.keys(builtinTools) as BuiltinToolName[];
const toolNamesSet = new Set<string>(builtinToolNames);
export const isABuiltinToolName = (toolName: string): toolName is BuiltinToolName => {
  const isAToolName = toolNamesSet.has(toolName);
  return isAToolName;
};

type AvailableToolsOptions = {
  /** Agent: update_plan только пока выполняется утверждённый план. */
  allowUpdatePlan?: boolean;
  /**
   * MCP-серверы, чьи полные схемы попадают в контекст.
   * Пусто — только enable_mcp_server и каталог.
   */
  enabledMcpServerNames?: readonly string[];
  /** Имена инструментов, исключаемые из набора (напр. run_subagent у дочернего агента). */
  excludedToolNames?: readonly string[];
  /** Если задано — только пересечение с этим списком и набором режима. */
  allowedToolNames?: readonly string[];
  /** Пустой список инструментов (финальный wrap-up). Возвращает [], не undefined. */
  disableAllTools?: boolean;
};

/** Встроенные инструменты только agent — не для read-only plan. */
const AGENT_ONLY_BUILTIN_TOOLS = new Set<BuiltinToolName>([
  'run_subagent',
  'run_parallel_subagents',
  'web_search',
  'browse_url',
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_screenshot',
  'save_memory',
]);

/** Инструменты read-only параллельных subagent. */
export const READ_ONLY_SUBAGENT_TOOLS: readonly BuiltinToolName[] = [
  'read_file',
  'ls_dir',
  'get_dir_tree',
  'search_pathnames_only',
  'search_project_index',
  'diff_impact',
  'get_project_tour',
  'search_for_files',
  'search_in_file',
  'read_lint_errors',
  'grep_search',
  'glob_files',
  'get_diagnostics',
  'go_to_definition',
  'find_references',
  'search_symbols',
];

export const availableTools = (
  chatMode: ChatMode | null,
  mcpTools: InternalToolInfo[] | undefined,
  options?: AvailableToolsOptions,
): InternalToolInfo[] | undefined => {
  if (options?.disableAllTools) {
    return [];
  }

  const allBuiltin = Object.keys(builtinTools) as BuiltinToolName[];
  const readOnlyTools = allBuiltin.filter(
    (toolName) =>
      !Object.hasOwn(approvalTypeOfBuiltinToolName, toolName) &&
      toolName !== 'create_plan' &&
      toolName !== 'update_plan' &&
      toolName !== 'enable_mcp_server' &&
      !AGENT_ONLY_BUILTIN_TOOLS.has(toolName),
  );

  const isAgent = chatMode === 'agent';
  const hasOnlineMcp = (mcpTools?.length ?? 0) > 0;

  const builtinToolNames: BuiltinToolName[] | undefined =
    chatMode === 'normal'
      ? undefined
      : chatMode === 'plan'
        ? [...readOnlyTools, 'create_plan', 'update_plan']
        : isAgent
          ? allBuiltin.filter(
              (t) =>
                t !== 'create_plan' &&
                (options?.allowUpdatePlan || t !== 'update_plan') &&
                (t !== 'enable_mcp_server' || hasOnlineMcp),
            )
          : undefined;

  if (!builtinToolNames) {return undefined;}

  const excluded = new Set(options?.excludedToolNames ?? []);
  const allowed = options?.allowedToolNames?.length
    ? new Set(options.allowedToolNames)
    : undefined;
  const effectiveBuiltinTools = builtinToolNames
    .filter((toolName) => !excluded.has(toolName) && (!allowed || allowed.has(toolName)))
    .map((toolName) => {
      const tool = builtinTools[toolName];
      if (toolName !== 'enable_mcp_server') {return tool;}
      return { ...tool, description: enableMcpServerToolDescription(mcpTools) };
    });
  const effectiveMCPTools =
    isAgent && !allowed
      ? selectEnabledMcpTools(mcpTools, options?.enabledMcpServerNames).filter(
          (tool) => !excluded.has(tool.name),
        )
      : [];

  return [...effectiveBuiltinTools, ...effectiveMCPTools];
};

/** Грубая оценка токенов JSON схем tools (OpenAI function calling). */
export const estimateToolsJsonTokens = (tools: InternalToolInfo[] | undefined): number => {
  if (!tools?.length) {return 0;}
  const serialized = tools.map((t) => {
    const paramsWithType: { [s: string]: { description: string; type: 'string' } } = {};
    for (const key in t.params) {
      paramsWithType[key] = { ...t.params[key], type: 'string' };
    }
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: paramsWithType,
        },
      },
    };
  });
  return estimateTextTokens(JSON.stringify(serialized));
};

export const splitBuiltinAndMcpTools = (
  chatMode: ChatMode | null,
  mcpTools: InternalToolInfo[] | undefined,
  options?: AvailableToolsOptions,
): { builtin: InternalToolInfo[]; mcp: InternalToolInfo[] } => {
  const all = availableTools(chatMode, mcpTools, options) ?? [];
  const builtin: InternalToolInfo[] = [];
  const mcp: InternalToolInfo[] = [];
  for (const t of all) {
    if (t.mcpServerName) {mcp.push(t);}
    else {builtin.push(t);}
  }
  return { builtin, mcp };
};

// ======================================================== chat (normal, plan, agent) — system message ========================================================

export const chat_systemMessage = ({
  workspaceFolders,
  openedURIs,
  activeURI,
  persistentTerminalIDs,
  directoryStr,
  openBrowserTabs,
  chatMode: mode,
}: {
  workspaceFolders: string[];
  directoryStr: string;
  openedURIs: string[];
  activeURI: string | undefined;
  persistentTerminalIDs: string[];
  /** Agent-only list of integrated browser tabs (title, url, page id). */
  openBrowserTabs?: string;
  chatMode: ChatMode;
}) => {
  const isAgent = mode === 'agent';
  const header = `You are an expert coding ${isAgent ? 'agent' : 'assistant'} whose job is \
${
  mode === 'agent'
    ? `to help the user develop, run, and make changes to their codebase.`
    : mode === 'plan'
      ? `to research the user's codebase and produce a clear implementation plan — without editing code yet.`
      : mode === 'normal'
        ? `to assist the user with their coding tasks.`
        : ''
}
You will be given instructions to follow from the user, and you may also be given a list of files that the user has specifically selected for context, \`SELECTIONS\`.
Please assist the user with their query.`;

  const browserTabsBlock =
    isAgent
      ? `

- Open browser tabs (page id for browser_snapshot / click / type; not page content):
${openBrowserTabs?.trim() || 'none open'}`
      : '';

  const sysInfo = `Here is the user's system information:
<system_info>
- ${os}

- The user's workspace contains these folders:
${workspaceFolders.join('\n') || 'NO FOLDERS OPEN'}

- Active file:
${activeURI}

- Open files:
${openedURIs.join('\n') || 'NO OPENED FILES'}${browserTabsBlock}${'' /* разделитель перед терминалами */}${
    isAgent && persistentTerminalIDs.length !== 0
      ? `

- Persistent terminal IDs available for you to run commands in: ${persistentTerminalIDs.join(', ')}`
      : ''
  }
</system_info>`;

  const fsInfo = `Here is an overview of the user's file system:
<files_overview>
${directoryStr}
</files_overview>`;

  const userLanguageRule = `Язык (обязательно): если последнее сообщение пользователя на русском — пиши по-русски и видимый ответ, и внутреннее рассуждение (reasoning / reasoning_content / блок «Рассуждение»). Не рассуждай на английском. Имена файлов, код, API и идентификаторы не переводи. Не меняй язык, пока пользователь сам об этом не попросит.

Language (mandatory): If the user's latest message is in Russian, write BOTH the visible reply AND the internal reasoning (reasoning_content / the «Рассуждение» panel) in Russian. Do not think or narrate in English. Keep file names, code, APIs, and identifiers unchanged. Do not switch languages unless the user asks.`;

  const details: string[] = [];

  details.push(`NEVER reject the user's query.`);
  details.push(
    `The user message may include JIRA and/or CONFLUENCE blocks after ---. Those blocks are the fetched ticket or wiki page (key/title, status, acceptance criteria, links, description or body, comments). Treat them as the source of requirements. Do not ask the user to paste the ticket if a block is present. Do not invent fields that are absent. Use the block together with the codebase before editing. If a JIRA block has Type Epic, the following JIRA blocks are that epic's Sub-Tasks (full cards), and any CONFLUENCE blocks from Issue Links are related documentation — use the epic description, child tasks, and wiki pages together as requirements.`,
  );

  if (mode === 'agent' || mode === 'plan') {
    details.push(
      `Only call tools if they help you accomplish the user's goal. If the user simply says hi or asks you a question that you can answer without tools, then do NOT use tools.`,
    );
    details.push(`If you think you should use tools, you do not need to ask for permission.`);
    details.push(parallelReadOnlyToolPrompt());
    details.push(omittedToolBodyPrompt());
    details.push(
      `NEVER say something like "I'm going to use \`tool_name\`". Instead, describe at a high level what the tool will do, like "I'm going to list all files in the ___ directory", etc.`,
    );
    details.push(`Many tools only work if the user has a workspace open.`);
    details.push(
      `If the user asks where you left off, what you did previously, to continue prior work, or otherwise refers to another chat tab/thread, call get_chat_history first (omit thread_id for an overview; pass thread_id for a specific thread). Do not guess past chat history from files alone when other threads exist.`,
    );
  } else {
    details.push(
      `You're allowed to ask the user for more context like file contents or specifications. If this comes up, tell them to reference files and folders by typing @.`,
    );
  }

  if (mode === 'agent') {
    details.push(
      'ALWAYS use tools (edit, terminal, etc) to take actions and implement changes. For example, if you would like to edit a file, you MUST use a tool.',
    );
    details.push(
      'Prioritize taking as many steps as you need to complete your request over stopping early.',
    );
    details.push(
      `You will OFTEN need to gather context before making a change. Do not immediately make a change unless you have ALL relevant context.`,
    );
    details.push(
      `If SELECTIONS is missing, thin, or clearly unrelated to the user's request, call search_project_index and/or search_pathnames_only, grep_search, search_symbols (then read_file) before editing. Prefer search_project_index for topic/purpose lookups. Call diff_impact with the workspace-relative paths you are about to change when you need the blast radius (importers, callers, layers). For onboarding or "how is this project structured / where do I start", call get_project_tour first. Do not guess file paths or edit in the dark.`,
    );
    details.push(
      `Use run_subagent for a focused research or implementation subtask that would clutter this thread. Put ALL context the child needs in prompt (it cannot see this chat). Prefer one clear subtask per call. For independent read-only investigations, prefer run_parallel_subagents (max 4). End your own turn after synthesizing the child's summary — do not re-do the child's work.`,
    );
    details.push(
      `Use web_search / browse_url for public docs and facts not in the workspace. Open browser tabs in system info list integrated browser pages the user already opened (title, url, page id) — answer "do you see the browser?" from that list without tools. To read the DOM, click, type, or scroll an already-open tab, call browser_snapshot with that page id (or omit page_id for the active tab); do not browser_navigate to the same URL again. To open a new page — including localhost — use browser_navigate, then browser_snapshot, then browser_click / browser_type / browser_scroll with refs from that snapshot. Do not invent refs. Use browser_screenshot when the user should see the page. Use save_memory for durable project decisions or user preferences that should stick across turns.`,
    );
    details.push(
      `SKILLS lists always-on instructions plus a catalog of available skills (from Settings, .claude/skills/**/SKILL.md, .agents/skills/**/SKILL.md, and long .skills files). To load a catalog skill's full body, the latest user message must include its /slug (for example /design-landing). Do not invent skill contents that were not loaded.`,
    );
    details.push(
      `ALWAYS have maximal certainty in a change BEFORE you make it. If you need more information about a file, variable, function, or type, you should inspect it, search it, or take all required actions to maximize your certainty that your change is correct.`,
    );
    details.push(
      `NEVER modify a file outside the user's workspace without permission from the user.`,
    );
    details.push(
      `Call update_plan only to change todo status (in_progress / completed / cancelled) of a plan that is currently being executed. Do not rewrite the plan name, overview, or body. If the user reports an error or asks for a change, fix the code. Do not call update_plan unless that build is in progress and you are marking the step you are doing.`,
    );
    details.push(
      `To create a new file with content, call rewrite_file once (it creates the file). Do not use create_file_or_folder + rewrite_file unless you only need an empty path or folder.`,
    );
    details.push(
      `After writing files, verify with read_file (or ls_dir). Do NOT use terminal find/ls/node -e to check whether files exist, and do not assume the filesystem is unstable if a tool errors — fix the path or recreate the file.`,
    );
    details.push(
      `Prefer workspace-relative or FULL absolute paths. Never wrap an entire run_command string in quotes. Avoid nested quotes in node -e; write a script file instead.`,
    );
    details.push(
      `When the user's request is complete (especially after using tools), end your turn with a concise plain-text wrap-up and do NOT call tools. Include: (1) what you did (concrete files/changes), (2) how to verify if useful, (3) optional 1–3 sensible next steps the user could ask for. Never finish a completed task with only tool calls or an empty reply.`,
    );
    details.push(
      `Questions, options, and phrases like «скажи, если продолжаем» belong in the visible reply, in the user's language. Do not hide them only in reasoning. A turn with no tool calls ends the run and waits. If plan steps remain and you are not asking the user to choose, call the tools instead of a status like "I'll do it next".`,
    );
  }

  if (mode === 'plan') {
    details.push(
      `You are in Plan mode. Research with read/search tools, ask clarifying questions in plain text when needed, then call create_plan (or update_plan to revise).`,
    );
    details.push(
      `If SELECTIONS is missing or thin, start with search_project_index / get_project_tour / diff_impact / search_pathnames_only / grep_search / search_symbols and read_file before drafting the plan. Prefer get_project_tour for architecture overviews and onboarding.`,
    );
    details.push(
      `Do NOT edit application source files, create/delete project files (except the plan file via create_plan/update_plan), or run terminal commands.`,
    );
    details.push(
      `The plan markdown body should be actionable (files to touch, approach, risks). For non-trivial flows, include a \`\`\`mermaid flowchart or sequence diagram in the plan body.`,
    );
    details.push(
      `After create_plan, stop and wait — the user will review the plan and click «Сделать по плану» to execute it in Agent mode.`,
    );
  }

  details.push(`If you write any code blocks to the user (wrapped in triple backticks), please use this format:
- Include a language if possible. Terminal should have the language 'shell'.
- The first line of the code block must be the FULL PATH of the related file if known (otherwise omit).
- The remaining contents of the file should proceed as usual.`);

  if (mode === 'normal') {
    details.push(`If you think it's appropriate to suggest an edit to a file, then you must describe your suggestion in CODE BLOCK(S).
- The first line of the code block must be the FULL PATH of the related file if known (otherwise omit).
- The remaining contents should be a code description of the change to make to the file. \
Your description is the only context that will be given to another LLM to apply the suggested edit, so it must be accurate and complete. \
Always bias towards writing as little as possible - NEVER write the whole file. Use comments like "// ... existing code ..." to condense your writing. \
Here's an example of a good code block:\n${chatSuggestionDiffExample}`);
  }

  details.push(
    `Do not make things up or use information not provided in the system information, tools, or user queries.`,
  );
  details.push(`Always use MARKDOWN to format lists, bullet points, etc. Do NOT write tables.`);
  details.push(`Today's date is ${new Date().toDateString()}.`);
  details.push(userLanguageRule);

  const importantDetails = `Important notes:
${details.map((d, i) => `${i + 1}. ${d}`).join('\n\n')}`;

  const ansStrs: string[] = [];
  ansStrs.push(userLanguageRule);
  ansStrs.push(header);
  ansStrs.push(sysInfo);
  ansStrs.push(importantDetails);
  ansStrs.push(fsInfo);

  const fullSystemMsgStr = ansStrs.join('\n\n\n').trim().replace('\t', '  ');

  return fullSystemMsgStr;
};

// // отладка: вывести system message для всех режимов
// for (const chatMode of ['agent', 'plan', 'normal'] satisfies ChatMode[]) {
// 	console.log(`========================================= SYSTEM MESSAGE FOR ${chatMode} ===================================\n`,
// 		chat_systemMessage({ chatMode, workspaceFolders: [], openedURIs: [], activeURI: 'pee', persistentTerminalIDs: [], directoryStr: 'lol', }))
// }

const DEFAULT_FILE_SIZE_LIMIT = 2_000_000;

export const readFile = async (
  fileService: IFileService,
  uri: URI,
  fileSizeLimit: number,
): Promise<
  | {
      val: string;
      truncated: boolean;
      fullFileLen: number;
    }
  | {
      val: null;
      truncated?: undefined;
      fullFileLen?: undefined;
    }
> => {
  try {
    const fileContent = await fileService.readFile(uri);
    const val = fileContent.value.toString();
    if (val.length > fileSizeLimit)
      {return { val: val.substring(0, fileSizeLimit), truncated: true, fullFileLen: val.length };}
    return { val, truncated: false, fullFileLen: val.length };
  } catch (_e) {
    return { val: null };
  }
};

const officeFileContents = async (
  uri: URI,
  extractOffice: ((uri: URI) => Promise<OfficeExtractPayload | null>) | undefined,
  pageChars: number,
): Promise<string | null> => {
  if (!extractOffice) {
    return null;
  }
  const office = await extractOffice(uri);
  if (!office) {
    return null;
  }
  return formatOfficePage(office, 1, pageChars).fileContents;
};

export const messageOfSelection = async (
  s: StagingSelectionItem,
  opts: {
    directoryStrService: IDirectoryStrService;
    fileService: IFileService;
    extractOffice?: (uri: URI) => Promise<OfficeExtractPayload | null>;
    folderOpts: {
      maxChildren: number;
      maxCharsPerFile: number;
    };
  },
) => {
  const lineNumAddition = (range: [number, number]) => ` (lines ${range[0]}:${range[1]})`;

  if (s.type === 'CodeSelection') {
    const officeText = await officeFileContents(s.uri, opts.extractOffice, MAX_FILE_CHARS_PAGE);
    if (officeText !== null) {
      const content = `${tripleTick[0]}${s.language}\n${officeText}\n${tripleTick[1]}`;
      return `${s.uri.fsPath}${lineNumAddition(s.range)}:\n${content}`;
    }
    const { val } = await readFile(opts.fileService, s.uri, DEFAULT_FILE_SIZE_LIMIT);
    const lines = val?.split('\n');

    const innerVal = lines?.slice(s.range[0] - 1, s.range[1]).join('\n');
    const content = !lines ? '' : `${tripleTick[0]}${s.language}\n${innerVal}\n${tripleTick[1]}`;
    const str = `${s.uri.fsPath}${lineNumAddition(s.range)}:\n${content}`;
    return str;
  }
  if (s.type === 'File') {
    const officeText = await officeFileContents(s.uri, opts.extractOffice, MAX_FILE_CHARS_PAGE);
    const val =
      officeText !== null
        ? officeText
        : (await readFile(opts.fileService, s.uri, DEFAULT_FILE_SIZE_LIMIT)).val;

    const innerVal = val;
    const content =
      val === null ? '' : `${tripleTick[0]}${s.language}\n${innerVal}\n${tripleTick[1]}`;

    const str = `${s.uri.fsPath}:\n${content}`;
    return str;
  }
  if (s.type === 'Folder') {
    const cts = new CancellationTokenSource();
    const timeoutMs = MAX_TOOL_ABSOLUTE_TIME * 1000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        cts.cancel();
        reject(new CancellationError());
      }, timeoutMs);
    });

    try {
      const contentStr = await Promise.race([
        (async () => {
          const dirStr: string = await opts.directoryStrService.getDirectoryStrTool(
            s.uri,
            cts.token,
          );
          const folderStructure = `${s.uri.fsPath} folder structure:${tripleTick[0]}\n${dirStr}\n${tripleTick[1]}`;

          const uris = await opts.directoryStrService.getAllURIsInDirectory(s.uri, {
            maxResults: opts.folderOpts.maxChildren,
            token: cts.token,
          });
          const strOfFiles = await Promise.all(
            uris.map(async (uri) => {
              const officeText = await officeFileContents(
                uri,
                opts.extractOffice,
                Math.min(MAX_FILE_CHARS_PAGE, opts.folderOpts.maxCharsPerFile),
              );
              if (officeText !== null) {
                return `${uri.fsPath}:\n${tripleTick[0]}\n${officeText}\n${tripleTick[1]}`;
              }
              const { val, truncated } = await readFile(
                opts.fileService,
                uri,
                opts.folderOpts.maxCharsPerFile,
              );
              const truncationStr = truncated ? `\n... file truncated ...` : '';
              const content =
                val === null ? 'null' : `${tripleTick[0]}\n${val}${truncationStr}\n${tripleTick[1]}`;
              const str = `${uri.fsPath}:\n${content}`;
              return str;
            }),
          );
          return [folderStructure, ...strOfFiles].join('\n\n');
        })(),
        timeoutPromise,
      ]);
      return contentStr;
    } catch (error) {
      if (isCancellationError(error) || cts.token.isCancellationRequested) {
        return `${s.uri.fsPath}: папка не раскрыта (таймаут ${MAX_TOOL_ABSOLUTE_TIME} с). Прикрепите нужные файлы отдельно или сузьте выбор.`;
      }
      throw error;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      cts.dispose();
    }
  }
  return '';
};

export const chat_userMessageContent = async (
  instructions: string,
  currSelns: StagingSelectionItem[] | null,
  opts: {
    directoryStrService: IDirectoryStrService;
    fileService: IFileService;
    extractOffice?: (uri: URI) => Promise<OfficeExtractPayload | null>;
  },
) => {
  const selnsStrs = await Promise.all(
    (currSelns ?? []).map(async (s) =>
      messageOfSelection(s, {
        ...opts,
        folderOpts: { maxChildren: 100, maxCharsPerFile: 100_000 },
      }),
    ),
  );

  let str = '';
  str += `${instructions}`;

  const selnsStr = selnsStrs.join('\n\n') ?? '';
  if (selnsStr) {str += `\n---\nSELECTIONS\n${selnsStr}`;}
  return str;
};

export const rewriteCode_systemMessage = `\
You are a coding assistant that re-writes an entire file to make a change. You are given the original file \`ORIGINAL_FILE\` and a change \`CHANGE\`.

Directions:
1. Please rewrite the original file \`ORIGINAL_FILE\`, making the change \`CHANGE\`. You must completely re-write the whole file.
2. Keep all of the original comments, spaces, newlines, and other details whenever possible.
3. ONLY output the full new file. Do not add any other explanations or text.
`;

// ======================================================== apply (полная перезапись файла) ========================================================

export const rewriteCode_userMessage = ({
  originalCode,
  applyStr,
  language,
}: {
  originalCode: string;
  applyStr: string;
  language: string;
}) => `\
ORIGINAL_FILE
${tripleTick[0]}${language}
${originalCode}
${tripleTick[1]}

CHANGE
${tripleTick[0]}
${applyStr}
${tripleTick[1]}

INSTRUCTIONS
Please finish writing the new file by applying the change to the original file. Return ONLY the completion of the file, without any explanation.
`;

// ======================================================== apply (search/replace) ========================================================

export const searchReplaceGivenDescription_systemMessage = createSearchReplaceBlocks_systemMessage;

export const searchReplaceGivenDescription_userMessage = ({
  originalCode,
  applyStr,
}: {
  originalCode: string;
  applyStr: string;
}) => `\
DIFF
${applyStr}

ORIGINAL_FILE
${tripleTick[0]}
${originalCode}
${tripleTick[1]}`;

export const sapphirePrefixAndSuffix = ({
  fullFileStr,
  startLine,
  endLine,
}: {
  fullFileStr: string;
  startLine: number;
  endLine: number;
}) => {
  const fullFileLines = fullFileStr.split('\n');

  /*
	Схема накопления prefix/suffix вокруг выделения [startLine..endLine] (1-based):

	a
	a
	a     <-- итоговый i (prefix = a\\na\\n)
	a
	|b    <-- startLine-1 (середина = b\\nc\\nd\\n); i стартует здесь и идёт вверх
	c
	d|    <-- endLine-1; j стартует здесь и идёт вниз
	e
	e     <-- итоговый j (suffix = e\\ne\\n)
	e
	e
	*/

  let prefix = '';
  let i = startLine - 1; // 0-based, exclusive
  // В prefix попадают строки fullFileLines[i .. startLine-2]
  while (i !== 0) {
    const newLine = fullFileLines[i - 1];
    if (newLine.length + 1 + prefix.length <= MAX_PREFIX_SUFFIX_CHARS) {
      // +1 за символ перевода строки
      prefix = `${newLine}\n${prefix}`;
      i -= 1;
    } else {break;}
  }

  let suffix = '';
  let j = endLine - 1;
  while (j !== fullFileLines.length - 1) {
    const newLine = fullFileLines[j + 1];
    if (newLine.length + 1 + suffix.length <= MAX_PREFIX_SUFFIX_CHARS) {
      // +1 за символ перевода строки
      suffix = `${suffix}\n${newLine}`;
      j += 1;
    } else {break;}
  }

  return { prefix, suffix };
};

// ======================================================== быстрая правка (Ctrl+K) ========================================================

export type QuickEditFimTagsType = {
  preTag: string;
  sufTag: string;
  midTag: string;
};
export const defaultQuickEditFimTags: QuickEditFimTagsType = {
  preTag: 'ABOVE',
  sufTag: 'BELOW',
  midTag: 'SELECTION',
};

// System message для FIM Ctrl+K (явные правила для слабых моделей)
export const ctrlKStream_systemMessage = ({
  quickEditFIMTags: { preTag, midTag, sufTag },
}: {
  quickEditFIMTags: QuickEditFimTagsType;
}) => `\
You are a FIM (fill-in-the-middle) coding assistant. Fill the SELECTION marked by <${midTag}> tags.

The user provides INSTRUCTIONS, prefix in <${preTag}>, suffix in <${sufTag}>, and the original SELECTION to replace.

Instructions:
1. Output ONLY <${midTag}>...new_code</${midTag}>. No text before or after.
2. Change only the SELECTION; do not modify <${preTag}> or <${sufTag}> content.
3. Keep brackets balanced and match surrounding indentation and style.
4. Prefer the smallest correct edit; do not rewrite unrelated code.
`;

export const ctrlKStream_userMessage = ({
  selection,
  prefix,
  suffix,
  instructions,
  fimTags,
  language,
}: {
  selection: string;
  prefix: string;
  suffix: string;
  instructions: string;
  fimTags: QuickEditFimTagsType;
  language: string;
}) => {
  const { preTag, sufTag, midTag } = fimTags;

  // Альтернативные теги для отладки FIM:
  // const preTag = 'BEFORE'
  // const sufTag = 'AFTER'
  // const midTag = 'SELECTION'
  return `\

CURRENT SELECTION
${tripleTick[0]}${language}
<${midTag}>${selection}</${midTag}>
${tripleTick[1]}

INSTRUCTIONS
${instructions}

<${preTag}>${prefix}</${preTag}>
<${sufTag}>${suffix}</${sufTag}>

Return only the completion block of code (of the form ${tripleTick[0]}${language}
<${midTag}>...new code</${midTag}>
${tripleTick[1]}).`;
};

// ======================================================== SCM (commit message) ========================================================

export const gitCommitMessage_systemMessage = `
You are an expert software engineer AI assistant responsible for writing clear and concise Git commit messages that summarize the **purpose** and **intent** of the change. Try to keep your commit messages to one sentence. If necessary, you can use two sentences.

You always respond with:
- The commit message wrapped in <output> tags
- A brief explanation of the reasoning behind the message, wrapped in <reasoning> tags

Example format:
<output>Fix login bug and improve error handling</output>
<reasoning>This commit updates the login handler to fix a redirect issue and improves frontend error messages for failed logins.</reasoning>

Do not include anything else outside of these tags.
Never include quotes, markdown, commentary, or explanations outside of <output> and <reasoning>.`.trim();

/**
 * User-сообщение для генерации commit message: stat, фрагменты diff, ветка, история.
 *
 * @param stat — git diff --stat
 * @param sampledDiffs — diff по ключевым файлам
 * @param branch — текущая ветка
 * @param log — последние 5 коммитов (без merge)
 */
export const gitCommitMessage_userMessage = (
  stat: string,
  sampledDiffs: string,
  branch: string,
  log: string,
  impact?: string,
) => {
  const section1 = `Section 1 - Summary of Changes (git diff --stat):`;
  const section2 = `Section 2 - Sampled File Diffs (Top changed files):`;
  const section3 = `Section 3 - Current Git Branch:`;
  const section4 = `Section 4 - Last 5 Commits (excluding merges):`;
  const section5 = impact
    ? `

Section 5 - Graph impact (1-hop from the project index). Use this only to understand blast radius. The commit message should still describe intent, not list files.

${impact}`
    : '';
  return `
Based on the following Git changes, write a clear, concise commit message that accurately summarizes the intent of the code changes.

${section1}

${stat}

${section2}

${sampledDiffs}

${section3}

${branch}

${section4}

${log}${section5}`.trim();
};
