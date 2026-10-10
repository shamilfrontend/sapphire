/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { removeMCPToolNamePrefix } from '../mcpServiceTypes.js';

/** Поля инструмента для отложенной выдачи MCP-схем (полные объекты остаются generic). */
export type McpDisclosureTool = {
  name: string;
  mcpServerName?: string;
};

const CATALOG_NAME_LIMIT = 8;
const FIGMA_DESKTOP_SERVER = 'figma-desktop';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Токен как отдельное «слово» (не часть другого идентификатора). */
const mentionsToken = (text: string, token: string): boolean => {
  if (!token) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_-])${escapeRegExp(token)}(?=$|[^\\p{L}\\p{N}_-])`, 'iu');
  return re.test(text);
};

/**
 * Префикс имени, который снимает `removeMCPToolNamePrefix`.
 * `_` в имени сервера → `-`, чтобы первый `_` оставался разделителем server/tool.
 */
export const stableMcpToolName = (serverName: string, toolName: string): string => {
  const prefix = serverName.replace(/_/g, '-');
  return `${prefix}_${toolName}`;
};

export const onlineMcpServerNames = (tools: readonly McpDisclosureTool[] | undefined): string[] => {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools ?? []) {
    const serverName = tool.mcpServerName;
    if (!serverName || seen.has(serverName)) continue;
    seen.add(serverName);
    names.push(serverName);
  }
  return names;
};

/** Онлайн-серверы, на которые уже намекает текст пользователя; figma-desktop ↔ «figma» / figma.com. */
export const mcpServersMentionedInText = (
  text: string,
  serverNames: readonly string[],
): string[] => {
  if (!text.trim() || serverNames.length === 0) return [];
  const found: string[] = [];
  for (const serverName of serverNames) {
    if (mentionsToken(text, serverName)) {
      found.push(serverName);
      continue;
    }
    if (
      serverName === FIGMA_DESKTOP_SERVER &&
      (/\bfigma\b/i.test(text) || /figma\.com/i.test(text))
    ) {
      found.push(serverName);
    }
  }
  return found;
};

/** Сохранённые серверы треда + упомянутые в `text`; офлайн-имена не отбрасываем. */
export const mergeEnabledMcpServers = (
  persisted: readonly string[] | undefined,
  text: string,
  onlineServerNames: readonly string[],
): string[] => {
  const next = [...(persisted ?? [])];
  const seen = new Set(next);
  for (const serverName of mcpServersMentionedInText(text, onlineServerNames)) {
    if (seen.has(serverName)) continue;
    seen.add(serverName);
    next.push(serverName);
  }
  return next;
};

export const selectEnabledMcpTools = <T extends McpDisclosureTool>(
  tools: readonly T[] | undefined,
  enabledServerNames: readonly string[] | undefined,
): T[] => {
  if (!tools?.length || !enabledServerNames?.length) return [];
  const enabled = new Set(enabledServerNames);
  return tools.filter((tool) => !!tool.mcpServerName && enabled.has(tool.mcpServerName));
};

export const mcpServerCatalog = (tools: readonly McpDisclosureTool[] | undefined): string => {
  const namesByServer = new Map<string, string[]>();
  for (const tool of tools ?? []) {
    if (!tool.mcpServerName) continue;
    const names = namesByServer.get(tool.mcpServerName) ?? [];
    names.push(removeMCPToolNamePrefix(tool.name));
    namesByServer.set(tool.mcpServerName, names);
  }
  if (namesByServer.size === 0) return '';

  const lines: string[] = [];
  for (const [serverName, names] of namesByServer) {
    const shown = names.slice(0, CATALOG_NAME_LIMIT);
    const extra = names.length - shown.length;
    const nameList = extra > 0 ? `${shown.join(', ')}, +${extra} more` : shown.join(', ');
    lines.push(`- ${serverName}: ${names.length} tools (${nameList})`);
  }
  return lines.join('\n');
};

export const enableMcpServerToolDescription = (
  tools: readonly McpDisclosureTool[] | undefined,
): string => {
  const base =
    "Enable an MCP server for the rest of this thread. Call this before using that server's tools. Pass server_name exactly as listed. The server's tools are available on your next response, not in this one.";
  const catalog = mcpServerCatalog(tools);
  if (!catalog) return base;
  return `${base}\nAvailable servers:\n${catalog}`;
};
