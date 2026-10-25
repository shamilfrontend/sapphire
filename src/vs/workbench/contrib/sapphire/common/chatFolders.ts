/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ChatFolder = {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
};

/** id вложенных папок под `folderId` (сам `folderId` не включается). */
export function collectDescendantFolderIds(
  folders: readonly ChatFolder[],
  folderId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) {continue;}
    const list = children.get(folder.parentId) ?? [];
    list.push(folder.id);
    children.set(folder.parentId, list);
  }

  const out: string[] = [];
  const stack = [...(children.get(folderId) ?? [])];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) {continue;}
    seen.add(id);
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** true, если `newParentId` — сама папка или её потомок (цикл). */
export function folderWouldCreateCycle(
  folders: readonly ChatFolder[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) {return false;}
  if (newParentId === folderId) {return true;}
  return collectDescendantFolderIds(folders, folderId).includes(newParentId);
}

/**
 * Переставляет `folderId` среди siblings с тем же parent.
 * `beforeSiblingId === null` — в конец списка siblings.
 * null, если папка или якорный sibling не найдены.
 */
export function reorderFolderAmongSiblings(
  folders: readonly ChatFolder[],
  folderId: string,
  beforeSiblingId: string | null,
): ChatFolder[] | null {
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) {return null;}
  if (beforeSiblingId === folderId) {return null;}

  const siblings = folders
    .filter((item) => item.parentId === folder.parentId && item.id !== folderId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));

  let index = siblings.length;
  if (beforeSiblingId !== null) {
    index = siblings.findIndex((item) => item.id === beforeSiblingId);
    if (index === -1) {return null;}
  }

  const ordered = [...siblings];
  ordered.splice(index, 0, folder);
  const orderOf = new Map(ordered.map((item, position) => [item.id, position]));
  return folders.map((item) =>
    orderOf.has(item.id) ? { ...item, order: orderOf.get(item.id)! } : item,
  );
}

export type ChatDateGroup = 'today' | 'yesterday' | 'week' | 'month' | 'older';

export const CHAT_DATE_GROUP_ORDER: readonly ChatDateGroup[] = [
  'today',
  'yesterday',
  'week',
  'month',
  'older',
];

/** Календарные группы по `lastModified` (локальное время), без пересечений. */
export function chatDateGroup(lastModifiedIso: string, now: Date): ChatDateGroup {
  const then = new Date(lastModifiedIso);
  if (Number.isNaN(then.getTime())) {return 'older';}
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfThen.getTime()) / 86_400_000);
  if (dayDiff <= 0) {return 'today';}
  if (dayDiff === 1) {return 'yesterday';}
  if (dayDiff <= 7) {return 'week';}
  if (dayDiff <= 30) {return 'month';}
  return 'older';
}

export function normalizeChatFolders(raw: unknown): ChatFolder[] {
  if (!Array.isArray(raw)) {return [];}
  const parsed: ChatFolder[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {continue;}
    const folder = item as Partial<ChatFolder>;
    if (typeof folder.id !== 'string' || typeof folder.name !== 'string') {continue;}
    parsed.push({
      id: folder.id,
      name: folder.name,
      parentId: typeof folder.parentId === 'string' ? folder.parentId : null,
      order: typeof folder.order === 'number' && Number.isFinite(folder.order) ? folder.order : 0,
    });
  }
  const ids = new Set(parsed.map((folder) => folder.id));
  return parsed.map((folder) => ({
    ...folder,
    parentId: folder.parentId && ids.has(folder.parentId) ? folder.parentId : null,
  }));
}
