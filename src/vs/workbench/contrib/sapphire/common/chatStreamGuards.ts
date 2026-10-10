/*--------------------------------------------------------------------------------------
 *  PPR Code — guards for chat stream / enqueue (без DOM, для unit-тестов).
 *--------------------------------------------------------------------------------------*/

/** Состояния isRunning, при которых follow-up уходит в очередь. */
export function canEnqueueFollowUp(isRunning: string | undefined): boolean {
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
