/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Накладные токены на одно сообщение чата (роль, разделители). */
export const MESSAGE_FRAMING_TOKENS = 4;

/** Фиксированный вес vision-токенов на изображение (не длина base64). */
export const IMAGE_VISION_TOKENS = 400;

/** Нижний порог бюджета токенов (~5k ASCII-символов при ~4 симв./токен). */
export const MIN_CONTEXT_TOKEN_BUDGET = Math.floor(5_000 / 4);

/**
 * Оценка токенов с учётом Unicode без токенизатора модели.
 * ASCII ~4 симв./токен; кириллица/latin-ext плотнее; CJK ~1 симв./токен.
 */
export function estimateTextTokens(text: string): number {
  if (!text) {return 0;}
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 0x7f) {
      tokens += 0.25;
    } else if (c <= 0x7ff) {
      tokens += 0.6;
    } else {
      tokens += 1;
    }
  }
  return Math.max(1, Math.ceil(tokens));
}

export function estimateImageTokens(imageCount: number): number {
  return Math.max(0, Math.floor(imageCount)) * IMAGE_VISION_TOKENS;
}

/** Накладные токены tool-call: имя + JSON-аргументы к предыдущему ответу ассистента. */
export function estimateToolCallTokens(opts: { name: string; argumentsJson: string }): number {
  return (
    estimateTextTokens(opts.name) + estimateTextTokens(opts.argumentsJson) + MESSAGE_FRAMING_TOKENS
  );
}

export function estimateMessageTokens(opts: { content: string; imageCount?: number }): number {
  const textTokens = opts.content ? estimateTextTokens(opts.content) : 0;
  const imageTokens =
    (opts.imageCount !== null && opts.imageCount !== undefined) && opts.imageCount > 0 ? estimateImageTokens(opts.imageCount) : 0;
  return textTokens + imageTokens + MESSAGE_FRAMING_TOKENS;
}

/**
 * EMA-калибратор: подтягивает локальные оценки к `usage.prompt_tokens` шлюза.
 * Общий для Chat, чтобы индикатор контекста совпадал с биллингом.
 */
export class TokenEstimateCalibrator {
  private factor = 1;
  private readonly alpha: number;
  private readonly minFactor: number;
  private readonly maxFactor: number;

  constructor(opts?: { alpha?: number; minFactor?: number; maxFactor?: number }) {
    this.alpha = opts?.alpha ?? 0.2;
    this.minFactor = opts?.minFactor ?? 0.5;
    this.maxFactor = opts?.maxFactor ?? 2.0;
  }

  getFactor(): number {
    return this.factor;
  }

  /** Обновить множитель по одной паре (оценка, факт). */
  observe(estimatedPromptTokens: number, actualPromptTokens: number): void {
    if (estimatedPromptTokens < 50 || actualPromptTokens < 50) {return;}
    const ratio = actualPromptTokens / estimatedPromptTokens;
    if (!Number.isFinite(ratio) || ratio <= 0) {return;}
    const next = this.alpha * ratio + (1 - this.alpha) * this.factor;
    this.factor = Math.min(this.maxFactor, Math.max(this.minFactor, next));
  }

  apply(estimated: number): number {
    return Math.max(0, Math.round(estimated * this.factor));
  }
}

/** Общий калибратор для индикатора контекста Chat и обрезки истории. */
export const chatTokenCalibrator = new TokenEstimateCalibrator();

/** Короткие окна — шум (time-to-first-token, один чанк). */
const MIN_OUTPUT_RATE_MS = 200;

/**
 * Completion-токены, делённые на время с первого чанка стрима.
 * undefined, если токенов нет или окно < 200 ms.
 * Целое число; минимальная скорость — 1.
 */
export function outputTokensPerSecond(
  completionTokens: number,
  firstTokenAtMs: number,
  finishedAtMs: number,
): number | undefined {
  if (!Number.isFinite(completionTokens) || completionTokens <= 0) {return undefined;}
  if (!Number.isFinite(firstTokenAtMs) || !Number.isFinite(finishedAtMs)) {return undefined;}
  const elapsedMs = finishedAtMs - firstTokenAtMs;
  if (elapsedMs < MIN_OUTPUT_RATE_MS) {return undefined;}
  return Math.max(1, Math.round(completionTokens / (elapsedMs / 1000)));
}

/**
 * Обрезает конец `text`, пока не освободится ≥ `tokensToFree` оценённых токенов,
 * сохраняя минимум `minKeepLen` символов (до опционального '...').
 * Возвращает новую строку.
 */
export function cutTailFreeingTokens(
  text: string,
  tokensToFree: number,
  minKeepLen: number,
): { text: string; tokensFreed: number } {
  if (tokensToFree <= 0 || text.length <= minKeepLen) {
    return { text, tokensFreed: 0 };
  }

  let freed = 0;
  let end = text.length;
  while (end > minKeepLen && freed < tokensToFree) {
    end -= 1;
    const c = text.charCodeAt(end);
    if (c <= 0x7f) {
      freed += 0.25;
    } else if (c <= 0x7ff) {
      freed += 0.6;
    } else {
      freed += 1;
    }
  }

  return {
    text: text.slice(0, end),
    tokensFreed: Math.ceil(freed),
  };
}
