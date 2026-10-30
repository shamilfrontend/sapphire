/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';

/** Максимальное ожидание всего local prep (heuristic / model / office), мс. */
export const SAPPHIRE_CHAT_PREP_TIMEOUT_MS = 8_000;

/** Разбор PDF может включать OCR скана. Обычные сообщения остаются на 8 с. */
export const SAPPHIRE_CHAT_PREP_OCR_TIMEOUT_MS = 45_000;

export function prepTimeoutMsForPaths(paths: readonly string[]): number {
	for (const path of paths) {
		if (path.replace(/\\/g, '/').toLowerCase().endsWith('.pdf')) {
			return SAPPHIRE_CHAT_PREP_OCR_TIMEOUT_MS;
		}
	}
	return SAPPHIRE_CHAT_PREP_TIMEOUT_MS;
}

/** Отдельный лимит на heuristic search — иначе fileSearch может съесть весь prep. */
export const SAPPHIRE_CHAT_HEURISTIC_TIMEOUT_MS = 3_000;

export class ChatPrepTimeoutError extends Error {
  override readonly name = 'ChatPrepTimeoutError';
  constructor(message = 'Подготовка сообщения превысила время ожидания.') {
    super(message);
  }
}

/**
 * Гонка promise с отменой по token и wall-clock таймаутом.
 * Не отменяет сам promise — только перестаёт ждать (вызывающий должен cancel CTS).
 */
export function isChatPrepTimeoutError(e: unknown): boolean {
  return (
    e instanceof ChatPrepTimeoutError ||
    (!!e && typeof e === 'object' && (e as { name?: string }).name === 'ChatPrepTimeoutError')
  );
}

export function racePrepAwait<T>(
  promise: Promise<T>,
  token: CancellationToken,
  timeoutMs: number = SAPPHIRE_CHAT_PREP_TIMEOUT_MS,
): Promise<T> {
  if (token.isCancellationRequested) {
    return Promise.reject(new CancellationError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    // 0 — в следующем macrotask, чтобы UI успел отрисовать preparing / Stop.
    const timeoutHandle = setTimeout(() => {
      settle(() => reject(new ChatPrepTimeoutError()));
    }, Math.max(0, timeoutMs));
    const listener = token.onCancellationRequested(() => {
      settle(() => reject(new CancellationError()));
    });

    function settle(fn: () => void) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      listener.dispose();
      fn();
    }

    promise.then(
      (value) => settle(() => resolve(value)),
      (err) => settle(() => reject(err)),
    );
  });
}
