/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Wave 0 — зафиксированные решения (threat model + product defaults)
 *
 * Trust boundaries / противники:
 * - Недоверенный вывод LLM (tool calls, path injection, prompt injection через web).
 * - Пользовательский mcp.json (stdio command / HTTP URL) — доверенный конфиг, но не полный process.env.
 * - Локальный диск: chat/checkpoints не должны хранить неограниченный plaintext кода.
 * - Remote REH: не тянуть чужие voideditor binaries по умолчанию.
 *
 * Решения:
 * 1. Path sandbox = deny-by-default внутри workspace folders; escape только через
 *    `allowAgentPathsOutsideWorkspace` (elevated opt-in), не silent trust LLM.
 * 2. Secret paths (.env, *.pem, …) блокируются для agent tools даже внутри workspace.
 * 3. autoApprove.edits default = false; subagent наследует ту же UI approval matrix.
 * 4. Network tools (web_search/browse_url) требуют approval type `network` (default off).
 *    Browser tools (click/type/navigate) требуют approval type `browser` (default off).
 * 5. Remote: ForwardAgent default false; Void REH URL убран — нужен явный template.
 */

import { URI } from '../../../../base/common/uri.js';
import { isEqualOrParent, relativePath } from '../../../../base/common/resources.js';
import { isSecretPath } from './projectIndex/projectIndexAnalyze.js';

/** Потолок entireFileCode в персистентных checkpoint (trim, не encrypt). */
export const CHECKPOINT_SNAPSHOT_MAX_CHARS = 50_000;

/** Env-ключи, которые можно передавать в MCP stdio (без секретов из process.env). */
const MCP_STDIO_ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'SHELL',
  'SystemRoot',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'SystemDrive',
  'NODE_OPTIONS',
] as const;

export function isUriInsideWorkspaceFolders(
  uri: URI,
  folderUris: readonly URI[],
): boolean {
  if (folderUris.length === 0) {
    return false;
  }
  for (const folder of folderUris) {
    if (isEqualOrParent(uri, folder)) {
      return true;
    }
  }
  return false;
}

export function assertUriInsideWorkspace(
  uri: URI,
  folderUris: readonly URI[],
  allowOutside: boolean,
): void {
  if (allowOutside) {
    return;
  }
  if (isUriInsideWorkspaceFolders(uri, folderUris)) {
    return;
  }
  throw new Error(
    `Path is outside the open workspace: ${uri.fsPath || uri.toString()}. ` +
      `Enable Settings → allowAgentPathsOutsideWorkspace to elevate, or use a path inside the workspace.`,
  );
}

/** Блокирует .env / credentials / keys внутри workspace для agent tools. */
export function assertNotSecretToolUri(uri: URI, folderUris: readonly URI[]): void {
  for (const folder of folderUris) {
    if (!isEqualOrParent(uri, folder)) {
      continue;
    }
    const rel = relativePath(folder, uri) ?? uri.path;
    if (rel && isSecretPath(rel)) {
      throw new Error(
        `Access to secret path is blocked for agent tools: ${rel.replace(/\\/g, '/')}`,
      );
    }
  }
}

export function buildMcpStdioEnv(
  serverEnv: Record<string, string> | undefined,
  processEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of MCP_STDIO_ENV_ALLOWLIST) {
    const value = processEnv[key];
    if (typeof value === 'string' && value.length > 0) {
      base[key] = value;
    }
  }
  return { ...base, ...(serverEnv ?? {}) };
}

export function capEntireFileCodeForStorage(code: string, max = CHECKPOINT_SNAPSHOT_MAX_CHARS): string {
  if (code.length <= max) {
    return code;
  }
  return code.slice(0, max);
}

const MEMORY_SECRETISH_RE =
  /(?:api[_-]?key|secret|password|passwd|private[_-]?key|bearer\s|sk-[a-zA-Z0-9]{10,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-)/i;

export function looksLikeSecretMemoryContent(key: string, value: string): boolean {
  return MEMORY_SECRETISH_RE.test(key) || MEMORY_SECRETISH_RE.test(value);
}
