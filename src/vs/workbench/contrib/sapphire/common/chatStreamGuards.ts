/*--------------------------------------------------------------------------------------
 *  Sapphire — guards for chat stream / enqueue (без DOM, для unit-тестов).
 *--------------------------------------------------------------------------------------*/

/**
 * Состояния isRunning, при которых follow-up уходит в очередь.
 * `idle` + `interrupt: 'not_needed'` — ход уже записан в ленту, цикл доживает:
 * это не живой агент, сообщение надо слать сразу, иначе очередь никто не разберёт.
 */
export function canEnqueueFollowUp(
  isRunning: string | undefined,
  interrupt?: unknown,
): boolean {
  if (isRunning === 'idle' && interrupt === 'not_needed') {
    return false;
  }
  return isRunning === 'LLM' || isRunning === 'tool' || isRunning === 'idle';
}

/** Залипший stream, который finally / prep clear должны снять (не awaiting_user). */
export function shouldClearStuckStream(isRunning: string | undefined): boolean {
  return (
    isRunning === 'preparing' ||
    isRunning === 'idle' ||
    isRunning === 'LLM' ||
    isRunning === 'tool'
  );
}

/**
 * Stale-epoch finally: чистим только idle, оставленный умирающим loop после abort.
 * preparing/LLM/tool с большой вероятностью принадлежат уже новому прогону — не трогаем.
 */
export function shouldClearStuckStreamOnStaleEpoch(isRunning: string | undefined): boolean {
  return isRunning === 'idle';
}

/** После enqueue: нет живого агента → сразу flush. */
export function shouldFlushDeadQueue(isRunning: string | undefined): boolean {
  return !canEnqueueFollowUp(isRunning);
}
