/*--------------------------------------------------------------------------------------
 *  PPR Code — pending file diffs beside the chat in Режим Агент.
 *--------------------------------------------------------------------------------------*/

import type { DiffZone } from '../../../../common/editCodeServiceTypes.js';

export const reviewFilesLabel = (count: number) => {
  if (count === 1) return '1 файл';
  if (count > 1 && count < 5) return `${count} файла`;
  return `${count} файлов`;
};

/** Подставляет в modified снимок original по DiffZone снизу вверх, чтобы диапазоны строк оставались валидными. */
export const originalFromDiffZones = (modified: string, zones: DiffZone[]): string => {
  if (zones.length === 0) return modified;
  const lines = modified.split('\n');
  const sorted = [...zones].sort((a, b) => b.startLine - a.startLine);
  for (const zone of sorted) {
    const start = Math.max(0, zone.startLine - 1);
    const deleteCount =
      zone.endLine >= zone.startLine
        ? Math.min(lines.length - start, zone.endLine - zone.startLine + 1)
        : 0;
    const replacement = zone.originalCode === '' ? [] : zone.originalCode.split('\n');
    lines.splice(start, Math.max(0, deleteCount), ...replacement);
  }
  return lines.join('\n');
};
