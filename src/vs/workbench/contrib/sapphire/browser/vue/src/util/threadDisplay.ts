/*--------------------------------------------------------------------------------------
 *  PPR Code — shared chat title and stream indicator for Режим Агент and tabs.
 *--------------------------------------------------------------------------------------*/

import { IsRunningType, ThreadType } from '../../../chatThreadService.js';

export const threadTitle = (thread: ThreadType | undefined): string => {
  if (!thread) return 'Новый чат';
  const firstUserMsg = thread.messages.find((msg) => msg.role === 'user');
  if (firstUserMsg && firstUserMsg.role === 'user' && firstUserMsg.displayContent?.trim()) {
    return firstUserMsg.displayContent.trim();
  }
  return 'Новый чат';
};

type ThreadActivity = 'running' | 'awaiting' | 'idle';

export function threadActivity(
  stream:
    | {
        isRunning?: IsRunningType;
        interrupt?: unknown;
      }
    | undefined,
): ThreadActivity {
  const isRunning = stream?.isRunning;
  if (
    isRunning === 'LLM' ||
    isRunning === 'tool' ||
    isRunning === 'preparing' ||
    (isRunning === 'idle' && stream?.interrupt !== 'not_needed')
  ) {
    return 'running';
  }
  if (isRunning === 'awaiting_user') return 'awaiting';
  return 'idle';
}
