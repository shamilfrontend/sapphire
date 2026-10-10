/*--------------------------------------------------------------------------------------
 *  PPR Code — отмена и таймаут prep перед agent loop (heuristic, getModelSafe, office).
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';

/** Максимальное ожидание всего local prep (heuristic / model / office), мс. */
export const PPR_CHAT_PREP_TIMEOUT_MS = 8_000;

/** Отдельный лимит на heuristic search — иначе fileSearch может съесть весь prep. */
export const PPR_CHAT_HEURISTIC_TIMEOUT_MS = 3_000;

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
  timeoutMs: number = PPR_CHAT_PREP_TIMEOUT_MS,
): Promise<T> {
  if (token.isCancellationRequested) {
    return Promise.reject(new CancellationError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let listener: { dispose: () => void } | undefined;

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      listener?.dispose();
      fn();
    };

    listener = token.onCancellationRequested(() => {
      settle(() => reject(new CancellationError()));
    });
    // 0 — в следующем macrotask, чтобы UI успел отрисовать preparing / Stop.
    timeoutHandle = setTimeout(() => {
      settle(() => reject(new ChatPrepTimeoutError()));
    }, Math.max(0, timeoutMs));

    promise.then(
      (value) => settle(() => resolve(value)),
      (err) => settle(() => reject(err)),
    );
  });
}
