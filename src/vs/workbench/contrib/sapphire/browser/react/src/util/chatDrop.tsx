/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { DragEvent as ReactDragEvent, useCallback, useRef, useState } from 'react';
import { DataTransfers } from '../../../../../../../base/browser/dnd.js';
import { Mimes } from '../../../../../../../base/common/mime.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../../../editor/common/languages/language.js';
import {
  CodeDataTransfers,
  containsDragType,
  extractEditorsDropData,
  getPathForFile,
} from '../../../../../../../platform/dnd/browser/dnd.js';
import { IFileService } from '../../../../../../../platform/files/common/files.js';
import { CHAT_IMAGE_ACCEPT, isAllowedChatImageMime } from '../../../../common/chatImageUtils.js';
import { StagingSelectionItem } from '../../../../common/chatThreadServiceTypes.js';
import { OFFICE_FILE_ACCEPT } from '../../../../common/office/officeDocument.js';
import { imageFilesFromDataTransfer } from './chatImages.js';
import { useAccessor } from './services.js';

/** Значение accept для выбора файлов в чате (скрепка). */
export function chatAttachFileAccept(includeImages: boolean): string {
  return includeImages ? `${CHAT_IMAGE_ACCEPT},${OFFICE_FILE_ACCEPT}` : OFFICE_FILE_ACCEPT;
}

/** true, если drag содержит файлы/папки/картинки, которые можно прикрепить к чату. */
export function isChatDropEvent(e: DragEvent): boolean {
  if (!e.dataTransfer) {
    return false;
  }
  if (
    containsDragType(
      e,
      DataTransfers.FILES,
      DataTransfers.RESOURCES,
      DataTransfers.INTERNAL_URI_LIST,
      Mimes.uriList,
      CodeDataTransfers.FILES,
      CodeDataTransfers.EDITORS,
    )
  ) {
    return true;
  }
  // На dragover иногда виден только mime на items, без DataTransfers.FILES
  const items = e.dataTransfer.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        return true;
      }
    }
  }
  return false;
}

export function urisFromDragEvent(e: DragEvent): URI[] {
  return extractEditorsDropData(e)
    .map((ed) => ed.resource)
    .filter((uri): uri is URI => !!uri);
}

export async function stagingItemsFromUris(
  uris: URI[],
  fileService: IFileService,
  languageService: ILanguageService,
): Promise<StagingSelectionItem[]> {
  const out: StagingSelectionItem[] = [];
  for (const uri of uris) {
    try {
      const stat = await fileService.stat(uri);
      if (stat.isDirectory) {
        out.push({ type: 'Folder', uri });
      } else {
        out.push({
          type: 'File',
          uri,
          language: languageService.guessLanguageIdByFilepathOrFirstLine(uri) || 'plaintext',
        });
      }
    } catch {
      // Файл недоступен — пропускаем
    }
  }
  return out;
}

export type ChatDropResult = {
  imageFiles: File[];
  selections: StagingSelectionItem[];
};

/**
 * Делит выбор из `<input type="file">` на vision-картинки и staging File/Folder.
 * Без пути на диске (вне Electron) в selections не попадают.
 */
export async function partitionPickedChatFiles(
  files: File[],
  opts: {
    fileService: IFileService;
    languageService: ILanguageService;
    includeImages: boolean;
  },
): Promise<ChatDropResult> {
  const imageFiles: File[] = [];
  const uris: URI[] = [];
  for (const file of files) {
    if (opts.includeImages && isAllowedChatImageMime(file.type)) {
      imageFiles.push(file);
      continue;
    }
    const path = getPathForFile(file);
    if (path) {
      uris.push(URI.file(path));
    }
  }
  const selections = await stagingItemsFromUris(uris, opts.fileService, opts.languageService);
  return { imageFiles, selections };
}

/**
 * Разбирает drop: картинки для vision и File/Folder в staging.
 * Пути картинок, уже ушедших в attachments, не дублируем в selections.
 */
export async function resolveChatDrop(
  e: DragEvent,
  opts: {
    fileService: IFileService;
    languageService: ILanguageService;
    includeImages: boolean;
  },
): Promise<ChatDropResult> {
  const imageFiles = opts.includeImages ? imageFilesFromDataTransfer(e.dataTransfer) : [];
  const imagePaths = new Set<string>();
  for (const file of imageFiles) {
    const path = getPathForFile(file);
    if (path) {
      imagePaths.add(path);
    }
  }

  const uris = urisFromDragEvent(e).filter((uri) => !imagePaths.has(uri.fsPath));
  const selections = await stagingItemsFromUris(uris, opts.fileService, opts.languageService);

  return { imageFiles, selections };
}

export type ChatDropZoneHandlers = {
  isDragOver: boolean;
  onDragEnter: (e: ReactDragEvent) => void;
  onDragOver: (e: ReactDragEvent) => void;
  onDragLeave: (e: ReactDragEvent) => void;
  onDrop: (e: ReactDragEvent) => void;
};

/** Drop-зона чата с счётчиком вложенности drag (оверлей «Отпустите…»). */
export function useChatDropZone(opts: {
  includeImages: boolean;
  onImages: (files: File[]) => void | Promise<void>;
  onSelections: (items: StagingSelectionItem[]) => void;
}): ChatDropZoneHandlers {
  const accessor = useAccessor();
  const fileService = accessor.get('IFileService');
  const languageService = accessor.get('ILanguageService');
  const [isDragOver, setIsDragOver] = useState(false);
  // Счётчик dragenter/dragleave для вложенных дочерних элементов
  const dragDepthRef = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const resetDrag = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragOver(false);
  }, []);

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    if (!isChatDropEvent(e.nativeEvent)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragOver(true);
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (!isChatDropEvent(e.nativeEvent)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (!isChatDropEvent(e.nativeEvent) && dragDepthRef.current === 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const onDrop = useCallback(
    async (e: ReactDragEvent) => {
      if (!isChatDropEvent(e.nativeEvent)) {
        resetDrag();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      resetDrag();

      const { includeImages, onImages, onSelections } = optsRef.current;
      const result = await resolveChatDrop(e.nativeEvent, {
        fileService,
        languageService,
        includeImages,
      });
      if (result.imageFiles.length) {
        await onImages(result.imageFiles);
      }
      if (result.selections.length) {
        onSelections(result.selections);
      }
    },
    [fileService, languageService, resetDrag],
  );

  return { isDragOver, onDragEnter, onDragOver, onDragLeave, onDrop };
}

export const ChatDropOverlay = ({ visible }: { visible: boolean }) => {
  if (!visible) {
    return null;
  }
  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-md border-2 border-dashed border-void-border-1 bg-void-bg-1/75"
      aria-hidden
    >
      <span className="px-3 py-1.5 text-sm text-void-fg-1 select-none">
        Отпустите, чтобы прикрепить
      </span>
    </div>
  );
};
