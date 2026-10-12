/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatImageAttachment } from './chatThreadServiceTypes.js';

export const CHAT_IMAGE_MAX_COUNT = 5;
export const CHAT_IMAGE_MAX_EDGE = 1280;
export const CHAT_IMAGE_JPEG_QUALITY = 0.82;
/** Мягкий лимит декодированных байт на все изображения в одном сообщении. */
export const CHAT_IMAGE_MAX_TOTAL_BYTES = 3 * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

/** MIME через запятую для `<input accept>` (vision-вложения). */
export const CHAT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export function isAllowedChatImageMime(mimeType: string): boolean {
  return ALLOWED_MIME.has(mimeType.toLowerCase());
}

export function normalizeChatImageMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m === 'image/jpg') return 'image/jpeg';
  return m;
}

export function chatImageToDataUrl(img: ChatImageAttachment): string {
  return `data:${normalizeChatImageMime(img.mimeType)};base64,${img.dataBase64}`;
}

export function decodedBytesOfBase64(dataBase64: string): number {
  // грубо: ~3/4 длины base64, padding не учитываем
  return Math.floor((dataBase64.length * 3) / 4);
}
