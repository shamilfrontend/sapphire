/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Пауза между chunk стрима, после которой клиент abort (мс). */
export const PPR_LLM_STREAM_IDLE_MS = 90_000;

/** Таймаут ожидания ответа на chat.completions.create до первого chunk (мс). */
export const PPR_LLM_CONNECT_TIMEOUT_MS = 90_000;

type GatewayRetryStatusParams = {
  /** Номер попытки с 1 (напр. 2 из 3). */
  attempt: number;
  maxAttempts: number;
  status?: number;
  retryAfterSec?: number;
};

/** Строка статуса при ожидании ретрая 408/429. */
export function formatGatewayRetryStatusHint(opts: GatewayRetryStatusParams): string {
  const { attempt, maxAttempts, status, retryAfterSec } = opts;
  const code = status === 408 || status === 429 ? String(status) : status != null ? String(status) : '';
  const head =
    status === 408
      ? `Провайдер занят (${code})`
      : status === 429
        ? `Лимит запросов (${code})`
        : code
          ? `Ошибка провайдера (${code})`
          : 'Ошибка провайдера';
  const wait =
    retryAfterSec != null && retryAfterSec > 0 ? ` через ~${retryAfterSec} с` : '';
  return `${head}, повтор ${attempt}/${maxAttempts}${wait}…`;
}

/** Строка статуса при паузе agent loop между попытками LLM. */
export function formatAgentRetryStatusHint(opts: {
  attempt: number;
  maxAttempts: number;
  message?: string;
}): string {
  const short = opts.message?.trim();
  const prefix = short
    ? short.length > 80
      ? `${short.slice(0, 77)}…`
      : short
    : 'Ошибка ответа';
  return `${prefix} Повтор ${opts.attempt}/${opts.maxAttempts}…`;
}
