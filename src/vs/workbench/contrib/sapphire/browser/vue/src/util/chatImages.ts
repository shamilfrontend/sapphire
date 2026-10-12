/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
  CHAT_IMAGE_JPEG_QUALITY,
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MAX_EDGE,
  CHAT_IMAGE_MAX_TOTAL_BYTES,
  decodedBytesOfBase64,
  isAllowedChatImageMime,
  normalizeChatImageMime,
} from '../../../../common/chatImageUtils.js';
import { ChatImageAttachment } from '../../../../common/chatThreadServiceTypes.js';

const newImageId = () => `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });

/**
 * Масштабирует и сжимает File в ChatImageAttachment (предпочтительно JPEG).
 * null — неподдерживаемый mime или ошибка кодирования.
 */
export async function fileToChatImageAttachment(file: File): Promise<ChatImageAttachment | null> {
  if (!isAllowedChatImageMime(file.type)) {
    return null;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);

    let { width, height } = img;
    const maxEdge = Math.max(width, height);
    if (maxEdge > CHAT_IMAGE_MAX_EDGE) {
      const scale = CHAT_IMAGE_MAX_EDGE / maxEdge;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.drawImage(img, 0, 0, width, height);

    // JPEG для фото/скринов; маленький PNG с альфой оставляем PNG
    const preferPng = normalizeChatImageMime(file.type) === 'image/png' && file.size < 400_000;
    const outMime = preferPng ? 'image/png' : 'image/jpeg';
    const outDataUrl = preferPng
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', CHAT_IMAGE_JPEG_QUALITY);

    const comma = outDataUrl.indexOf(',');
    if (comma < 0) {
      return null;
    }
    const dataBase64 = outDataUrl.slice(comma + 1);

    return {
      id: newImageId(),
      mimeType: outMime,
      dataBase64,
      width,
      height,
    };
  } catch {
    return null;
  }
}

export async function filesToChatImageAttachments(
  files: Iterable<File>,
  existing: ChatImageAttachment[] = [],
): Promise<ChatImageAttachment[]> {
  const next = [...existing];
  let totalBytes = next.reduce((sum, img) => sum + decodedBytesOfBase64(img.dataBase64), 0);

  for (const file of files) {
    if (next.length >= CHAT_IMAGE_MAX_COUNT) {
      break;
    }
    const attachment = await fileToChatImageAttachment(file);
    if (!attachment) {
      continue;
    }
    const bytes = decodedBytesOfBase64(attachment.dataBase64);
    if (totalBytes + bytes > CHAT_IMAGE_MAX_TOTAL_BYTES) {
      continue;
    }
    next.push(attachment);
    totalBytes += bytes;
  }
  return next;
}

/** Извлекает файлы-картинки из paste/drop DataTransfer. */
export function imageFilesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) {
    return [];
  }
  const out: File[] = [];
  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files.item(i);
      if (f && isAllowedChatImageMime(f.type)) {
        out.push(f);
      }
    }
  }
  if (out.length === 0 && dt.items?.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file' && isAllowedChatImageMime(item.type)) {
        const f = item.getAsFile();
        if (f) {
          out.push(f);
        }
      }
    }
  }
  return out;
}
