/*--------------------------------------------------------------------------------------
 *  Sapphire — кольцевой лог отправки чата (диагностика зависания нового чата).
 *  Без текста сообщений: только шаги, состояния и длины.
 *--------------------------------------------------------------------------------------*/

type ChatTraceEntry = {
  /** Мс от первой записи текущей сессии. */
  dtMs: number;
  thread: string;
  event: string;
  detail?: string;
};

const MAX_ENTRIES = 200;
const entries: ChatTraceEntry[] = [];
let origin = 0;

function shortThread(threadId: string | undefined): string {
  if (!threadId) return '-';
  return threadId.length <= 8 ? threadId : threadId.slice(-8);
}

export function chatTrace(threadId: string | undefined, event: string, detail?: string): void {
  const now = Date.now();
  if (entries.length === 0) {
    origin = now;
  }
  entries.push({
    dtMs: now - origin,
    thread: shortThread(threadId),
    event,
    ...(detail ? { detail } : {}),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function formatChatSendTrace(): string {
  if (!entries.length) {
    return 'Sapphire chat send trace: (пусто — отправок ещё не было)';
  }
  const lines = entries.map((e) => {
    const sec = (e.dtMs / 1000).toFixed(2).padStart(7, ' ');
    return `+${sec}s [${e.thread}] ${e.event}${e.detail ? ` ${e.detail}` : ''}`;
  });
  return [`Sapphire chat send trace (${entries.length})`, ...lines].join('\n');
}

/** Только для тестов. */
export function _resetChatSendTraceForTests(): void {
  entries.length = 0;
  origin = 0;
}
