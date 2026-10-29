/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { reactive, ref, toValue, type MaybeRefOrGetter } from 'vue';
import { DataTransfers } from '../../../../../../../base/browser/dnd.js';
import { isDragEvent } from '../../../../../../../base/browser/dom.js';
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

/** Событие drag: нативный DragEvent из Vue или synthetic с nativeEvent. */
export type ChatDropEvent = {
  preventDefault: () => void;
  stopPropagation: () => void;
  dataTransfer: DataTransfer | null;
  nativeEvent?: Event;
};

const asNativeDragEvent = (e: ChatDropEvent): DragEvent | null => {
  if (e.nativeEvent && isDragEvent(e.nativeEvent)) {return e.nativeEvent;}
  if (isDragEvent(e)) {return e;}
  return null;
};

export type ChatDropZoneHandlers = {
  isDragOver: boolean;
  onDragEnter: (e: ChatDropEvent) => void;
  onDragOver: (e: ChatDropEvent) => void;
  onDragLeave: (e: ChatDropEvent) => void;
  onDrop: (e: ChatDropEvent) => void | Promise<void>;
};

/** Drop-зона чата с счётчиком вложенности drag (оверлей «Отпустите…»). */
export function useChatDropZone(opts: {
  includeImages: MaybeRefOrGetter<boolean>;
  onImages: (files: File[]) => void | Promise<void>;
  onSelections: (items: StagingSelectionItem[]) => void;
}): ChatDropZoneHandlers {
  const accessor = useAccessor();
  const fileService = accessor.get('IFileService');
  const languageService = accessor.get('ILanguageService');
  const isDragOver = ref(false);
  // Счётчик dragenter/dragleave для вложенных дочерних элементов
  const dragDepthRef = ref(0);

  const resetDrag = () => {
    dragDepthRef.value = 0;
    isDragOver.value = false;
  };

  const onDragEnter = (e: ChatDropEvent) => {
    const native = asNativeDragEvent(e);
    if (!native || !isChatDropEvent(native)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.value += 1;
    isDragOver.value = true;
    if (native.dataTransfer) {
      native.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDragOver = (e: ChatDropEvent) => {
    const native = asNativeDragEvent(e);
    if (!native || !isChatDropEvent(native)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (native.dataTransfer) {
      native.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDragLeave = (e: ChatDropEvent) => {
    const native = asNativeDragEvent(e);
    if ((!native || !isChatDropEvent(native)) && dragDepthRef.value === 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.value = Math.max(0, dragDepthRef.value - 1);
    if (dragDepthRef.value === 0) {
      isDragOver.value = false;
    }
  };

  const onDrop = async (e: ChatDropEvent) => {
    const native = asNativeDragEvent(e);
    if (!native || !isChatDropEvent(native)) {
      resetDrag();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    resetDrag();

    const result = await resolveChatDrop(native, {
      fileService,
      languageService,
      includeImages: toValue(opts.includeImages),
    });
    if (result.imageFiles.length) {
      await opts.onImages(result.imageFiles);
    }
    if (result.selections.length) {
      opts.onSelections(result.selections);
    }
  };

  return reactive({
    isDragOver,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  });
}
