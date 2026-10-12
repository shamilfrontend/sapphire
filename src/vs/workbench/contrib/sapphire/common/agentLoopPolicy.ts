/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { ChatMode } from './sapphireSettingsTypes.js';

/** Скрытый user-nudge: краткий итог после инструментов, без новых вызовов. */
export const AGENT_WRAP_UP_NUDGE =
  'Предыдущие действия инструментов завершены. Ответь кратким итогом для пользователя: что изменилось, как проверить если нужно, и опциональные следующие шаги. Не вызывай инструменты, если задача уже завершена.';

/** Скрытый nudge, если ход по плану завершился без инструментов и без вопроса пользователю. */
export const AGENT_CONTINUE_NUDGE =
  'Предыдущий ход не вызвал инструменты и не задал вопрос пользователю. План ещё не выполнен. Сразу вызови следующий инструмент (update_plan, запись файлов или чтение). Не останавливайся на рассуждении.';

/** Скрытый nudge в Plan mode: текстового «плана» в чате недостаточно — нужен create_plan. */
export const AGENT_DRAFT_PLAN_NUDGE =
  'Предыдущий ход описал план текстом, но не вызвал create_plan. Сейчас вызови инструмент create_plan с name, overview, plan (markdown) и todos. Не заканчивай ответ одним текстом — без create_plan карточка плана не появится.';

/** Скрытый nudge при обрыве ответа по max_tokens (finish_reason=length). */
export const AGENT_LENGTH_CONTINUE_NUDGE =
  'Предыдущий ответ оборвался из‑за лимита длины (finish_reason=length). Продолжи с того же места: вызови инструмент (rewrite_file / edit_file / run_command), чтобы дописать файл. Не повторяй уже написанный черновик в чате.';

/** Подряд идущие ходы без инструментов до паузы; на третьем — остановка. */
const MAX_CONSECUTIVE_EMPTY_TURNS = 3;

/** Подряд оборванных по length ходов до паузы; на четвёртом — остановка. */
const MAX_CONSECUTIVE_LENGTH_CONTINUES = 3;

/** Подряд ошибок инструментов (tool_error / invalid_params) до паузы прогона. */
export const MAX_CONSECUTIVE_TOOL_ERRORS = 6;

type AgentLoopStopReason = 'stop_repeat' | 'stop_limit';

type LoopContinuationNudge = 'wrap_up' | 'continue_plan' | 'length_continue' | 'draft_plan';

export type LoopContinuationPauseReason =
  | AgentLoopStopReason
  | 'length_pause'
  | 'empty_turn_pause'
  | 'tool_errors';

export type LoopContinuation =
  | { action: 'run_tools' }
  | {
      action: 'continue';
      nudges: LoopContinuationNudge[];
      disableTools: boolean;
      /** Увеличить consecutiveEmptyTurns при nudge continue_plan. */
      bumpEmptyTurns?: boolean;
      /** Увеличить consecutiveLengthContinues при nudge length_continue. */
      bumpLengthContinues?: boolean;
      /** Выставить summaryNudged после wrap_up. */
      markSummaryNudged?: boolean;
    }
  | { action: 'pause'; reason: LoopContinuationPauseReason }
  | { action: 'await_user' }
  | { action: 'natural_end' };

type AgentToolBatchCall = {
  name: string;
  rawParams?: { [key: string]: unknown } | undefined;
};

type AgentToolBatchDecision = 'run' | AgentLoopStopReason;

function canonicalValue(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(',')}]`;
  }
  const obj = value as { [key: string]: unknown };
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalValue(obj[key])}`).join(',')}}`;
}

/** Стабильный идентификатор батча tool_calls модели. Порядок вызовов важен, порядок ключей в объекте — нет. */
export function toolBatchSignature(calls: readonly AgentToolBatchCall[]): string {
  return calls
    .map((call) => `${call.name}\n${canonicalValue(call.rawParams ?? {})}`)
    .join('\n---\n');
}

function consecutiveTailCount(signatures: readonly string[], signature: string): number {
  let count = 0;
  for (let i = signatures.length - 1; i >= 0; i--) {
    if (signatures[i] !== signature) {
      break;
    }
    count++;
  }
  return count;
}

/**
 * Выполнять ли этот батч инструментов.
 * `recentSignatures` — уже принятые батчи в этом прогоне (старые первыми), без текущего `batch`.
 * `step` — номер LLM-хода (с 1).
 * Сначала проверяется повтор идентичного батча, затем лимит шагов.
 */
export function decideToolBatch(opts: {
  step: number;
  maxSteps: number;
  batch: readonly AgentToolBatchCall[];
  recentSignatures: readonly string[];
  repeatLimit: number;
}): AgentToolBatchDecision {
  const signature = toolBatchSignature(opts.batch);
  const repeatCount = consecutiveTailCount(opts.recentSignatures, signature) + 1;
  if (repeatCount >= opts.repeatLimit) {
    return 'stop_repeat';
  }
  if (opts.step >= opts.maxSteps) {
    return 'stop_limit';
  }
  return 'run';
}

/** После инструментов на этом шаге следующий LLM-ход — скрытый wrap-up (agent и debug). */
export function shouldForceWrapUp(opts: {
  step: number;
  maxSteps: number;
  chatMode: ChatMode | null;
  alreadyNudged: boolean;
}): boolean {
  if (opts.alreadyNudged || (opts.chatMode !== 'agent' && opts.chatMode !== 'debug')) {
    return false;
  }
  return opts.step >= opts.maxSteps - 1;
}

/** Доля кириллицы среди кириллицы и латиницы; 0, если букв нет. */
export function cyrillicShare(text: string): number {
  const cyrillic = text.match(/[А-Яа-яЁё]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  const letters = cyrillic + latin;
  if (letters === 0) return 0;
  return cyrillic / letters;
}

function letterCounts(text: string): { cyrillic: number; latin: number; letters: number } {
  const cyrillic = text.match(/[А-Яа-яЁё]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return { cyrillic, latin, letters: cyrillic + latin };
}

/** Убрать URL — percent-encoded ссылки раздувают латиницу и ломают детектор языка. */
function stripUrlsForLanguageDetect(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, ' ');
}

/** true, если последний видимый текст пользователя достаточно «русский» для перевода reasoning. */
export function userMessageLooksRussian(userText: string): boolean {
  const text = stripUrlsForLanguageDetect(userText);
  const { letters } = letterCounts(text);
  if (letters < 8) return false;
  return cyrillicShare(text) >= 0.4;
}

/**
 * GLM пишет `reasoning_content` по-английски даже при запрете.
 * Переводим для UI, если пользователь пишет по-русски, а trace — нет.
 */
export function shouldTranslateReasoningToRussian(userText: string, reasoning: string): boolean {
  const { letters: reasoningLetters } = letterCounts(reasoning);
  if (reasoningLetters < 40) return false;
  if (cyrillicShare(reasoning) >= 0.35) return false;
  return userMessageLooksRussian(userText);
}

/**
 * Что показывать в стриминг-панели «Рассуждение».
 * Английский trace скрываем для русскоязычных (спиннер уже показывает «Думаю»).
 * Русский trace и не-русских пользователей не трогаем.
 */
export function streamingReasoningDisplay(userText: string, reasoning: string): string {
  if (!reasoning.trim()) return '';
  if (!userMessageLooksRussian(userText)) return reasoning;
  if (cyrillicShare(reasoning) >= 0.35) return reasoning;
  return '';
}

const EXPLICIT_CHOICE_RE = /скажи|выбери|уточни|если продолжа/i;
const BARE_QUESTION_RE = /[?？]/;
const OPTION_LINE_RE = /^\s*(?:[-*]|\d+[.)])\s+\S+/gm;
/** Голый «?» считается ожиданием ответа только в коротком видимом тексте. */
const SHORT_VISIBLE_QUESTION_MAX_CHARS = 400;

/**
 * true, если текст ждёт выбора пользователя.
 * Явные формулировки всегда учитываются. «?» — только при allowBareQuestion и коротком
 * видимом ответе; риторические вопросы в длинном reasoning не считаются.
 */
export function asksUserToChoose(
  text: string,
  opts?: { allowBareQuestion?: boolean },
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (EXPLICIT_CHOICE_RE.test(trimmed)) return true;
  const options = trimmed.match(OPTION_LINE_RE);
  if (options && options.length >= 2 && /вариант|выбер|choose|which option/i.test(trimmed)) {
    return true;
  }
  if (
    opts?.allowBareQuestion !== false &&
    trimmed.length <= SHORT_VISIBLE_QUESTION_MAX_CHARS &&
    BARE_QUESTION_RE.test(trimmed)
  ) {
    return true;
  }
  return false;
}

/**
 * Скрытое продолжение, пока у утверждённого плана есть открытые todo.
 * Реальный запрос выбора ждёт пользователя; «?» в длинном reasoning — нет.
 * `consecutiveEmptyTurns` — число подряд идущих ходов без инструментов в серии.
 */
export function shouldAutoContinueTurn(opts: {
  chatMode: ChatMode | null;
  hasToolCalls: boolean;
  planHasOpenTodos: boolean;
  assistantText: string;
  reasoningText: string;
  consecutiveEmptyTurns: number;
  maxConsecutiveEmptyTurns?: number;
}): boolean {
  const maxEmpty = opts.maxConsecutiveEmptyTurns ?? MAX_CONSECUTIVE_EMPTY_TURNS;
  if (opts.hasToolCalls) return false;
  if (opts.chatMode !== 'agent' && opts.chatMode !== 'debug') return false;
  if (!opts.planHasOpenTodos) return false;
  if (opts.consecutiveEmptyTurns >= maxEmpty - 1) return false;
  // Видимый ответ: короткий «?» или явный выбор — ждём пользователя.
  if (asksUserToChoose(opts.assistantText, { allowBareQuestion: true })) return false;
  // Reasoning: только явный запрос; риторический «?» не останавливает автопродолжение.
  if (asksUserToChoose(opts.reasoningText, { allowBareQuestion: false })) return false;
  return true;
}

/**
 * Продолжить тот же прогон после упора в лимит выходных токенов в середине хода.
 * При открытом плане или обрезанном JSON tool_call.
 */
export function shouldAutoContinueOnLength(opts: {
  finishReason: string | undefined;
  planHasOpenTodos: boolean;
  hadTruncatedToolCall: boolean;
  consecutiveLengthContinues: number;
  maxConsecutiveLengthContinues?: number;
}): boolean {
  if (opts.finishReason !== 'length') return false;
  if (!opts.planHasOpenTodos && !opts.hadTruncatedToolCall) return false;
  const max = opts.maxConsecutiveLengthContinues ?? MAX_CONSECUTIVE_LENGTH_CONTINUES;
  if (opts.consecutiveLengthContinues >= max) return false;
  return true;
}

export function agentLoopStopMessage(
  reason: AgentLoopStopReason,
  opts: { maxSteps: number; repeatLimit: number },
): string {
  if (reason === 'stop_repeat') {
    return `Агент остановился: один и тот же набор инструментов запрошен ${opts.repeatLimit} раза подряд. Нажмите «Продолжить» или напишите, если нужно продолжить иначе.`;
  }
  return `Агент остановился: за один запрос больше ${opts.maxSteps} шагов. Нажмите «Продолжить» или напишите, чтобы продолжить с этого места.`;
}

/** Сообщение паузы при исчерпании бюджета length-continue (или остановке с открытыми шагами плана). */
export function agentLengthPauseMessage(opts: { progressLabel?: string }): string {
  const step = opts.progressLabel ? ` Открытый шаг: ${opts.progressLabel}.` : '';
  return `Ответ оборвался по лимиту длины.${step} Нажмите «Продолжить» или напишите «продолжай», чтобы продолжить с этого места.`;
}

/** Пауза после серии пустых ходов без инструментов при открытом плане. */
export function agentEmptyTurnPauseMessage(opts: { progressLabel?: string }): string {
  const step = opts.progressLabel ? ` Открытый шаг: ${opts.progressLabel}.` : '';
  return `Агент остановился: несколько ходов подряд без инструментов.${step} Нажмите «Продолжить» или напишите, чтобы продолжить с этого места.`;
}

/** Пауза при слишком большом числе подряд ошибок инструментов. */
export function agentToolErrorsPauseMessage(opts: { maxErrors: number }): string {
  return `Агент остановился: ${opts.maxErrors} ошибки инструментов подряд. Нажмите «Продолжить» или напишите, чтобы продолжить иначе.`;
}

/**
 * Обновить счётчик подряд идущих ошибок инструментов после батча.
 * Любой success сбрасывает; tool_error/invalid_params без success увеличивает на 1.
 */
export function updateConsecutiveToolErrors(
  prev: number,
  outcomes: readonly ('success' | 'tool_error' | 'invalid_params' | 'rejected' | 'other')[],
): number {
  let hadSuccess = false;
  let hadError = false;
  for (const outcome of outcomes) {
    if (outcome === 'success') {
      hadSuccess = true;
    } else if (outcome === 'tool_error' || outcome === 'invalid_params') {
      hadError = true;
    }
  }
  if (hadSuccess) {
    return 0;
  }
  if (hadError) {
    return prev + 1;
  }
  return prev;
}

type DecideLoopContinuationInput = {
  /** false — ещё решаем, запускать ли батч; true — инструменты уже отработали. */
  toolsExecuted: boolean;
  hasToolCalls: boolean;
  batchDecision: AgentToolBatchDecision | null;
  ranAny: boolean;
  awaitingUserApproval: boolean;
  wantsLengthContinue: boolean;
  finishReason: string | undefined;
  planHasOpenTodos: boolean;
  hadTruncatedToolCall: boolean;
  toolsRanInRun: boolean;
  assistantText: string;
  reasoningText: string;
  consecutiveEmptyTurns: number;
  consecutiveLengthContinues: number;
  summaryNudged: boolean;
  consecutiveToolErrors: number;
  maxConsecutiveToolErrors?: number;
  step: number;
  maxSteps: number;
  chatMode: ChatMode | null;
  lengthPauseAnnounced: boolean;
  /**
   * В этом прогоне уже был success create_plan/update_plan, либо есть activePlan.
   * В Plan mode без этого флага текст без tool_calls не должен давать natural_end.
   */
  planDraftedInRun: boolean;
};

/**
 * Единое решение после LLM / после инструментов для цикла агента.
 * Вызывающий код считает batchDecision, wantsLengthContinue и т.д., затем только исполняет action.
 */
export function decideLoopContinuation(input: DecideLoopContinuationInput): LoopContinuation {
  const maxToolErrors = input.maxConsecutiveToolErrors ?? MAX_CONSECUTIVE_TOOL_ERRORS;
  const isAgentLike = input.chatMode === 'agent' || input.chatMode === 'debug';

  if (input.awaitingUserApproval) {
    return { action: 'await_user' };
  }

  if (input.consecutiveToolErrors >= maxToolErrors) {
    return { action: 'pause', reason: 'tool_errors' };
  }

  // Мягкая остановка: одинаковый батч или лимит шагов — wrap-up без инструментов, затем пауза.
  if (
    input.hasToolCalls &&
    !input.toolsExecuted &&
    input.batchDecision &&
    input.batchDecision !== 'run'
  ) {
    if (!input.summaryNudged && isAgentLike) {
      return {
        action: 'continue',
        nudges: ['wrap_up'],
        disableTools: true,
        markSummaryNudged: true,
      };
    }
    return { action: 'pause', reason: input.batchDecision };
  }

  if (input.hasToolCalls && !input.toolsExecuted && input.batchDecision === 'run') {
    return { action: 'run_tools' };
  }

  // --- после инструментов или если в этом ходе не было tool_calls ---

  if (input.toolsExecuted && input.ranAny) {
    const nudges: LoopContinuationNudge[] = [];
    let disableTools = false;
    let markSummaryNudged = false;
    let bumpLengthContinues = false;
    if (
      shouldForceWrapUp({
        step: input.step,
        maxSteps: input.maxSteps,
        chatMode: input.chatMode,
        alreadyNudged: input.summaryNudged,
      })
    ) {
      nudges.push('wrap_up');
      disableTools = true;
      markSummaryNudged = true;
    }
    if (input.hadTruncatedToolCall && input.wantsLengthContinue) {
      nudges.push('length_continue');
      bumpLengthContinues = true;
    }
    return {
      action: 'continue',
      nudges,
      disableTools,
      markSummaryNudged,
      bumpLengthContinues,
    };
  }

  if (input.toolsExecuted && !input.ranAny && input.wantsLengthContinue) {
    return {
      action: 'continue',
      nudges: ['length_continue'],
      disableTools: false,
      bumpLengthContinues: true,
    };
  }

  if (!input.hasToolCalls || (input.toolsExecuted && !input.ranAny)) {
    if (input.wantsLengthContinue) {
      return {
        action: 'continue',
        nudges: ['length_continue'],
        disableTools: false,
        bumpLengthContinues: true,
      };
    }

    if (
      input.finishReason === 'length' &&
      (input.planHasOpenTodos || input.hadTruncatedToolCall) &&
      !input.lengthPauseAnnounced
    ) {
      return { action: 'pause', reason: 'length_pause' };
    }

    // Абсолютный лимит ходов без исполняемых инструментов — один wrap-up, затем пауза.
    if (!input.hasToolCalls && input.step >= input.maxSteps && isAgentLike) {
      if (!input.summaryNudged) {
        return {
          action: 'continue',
          nudges: ['wrap_up'],
          disableTools: true,
          markSummaryNudged: true,
        };
      }
      return { action: 'pause', reason: 'stop_limit' };
    }

    if (
      shouldAutoContinueTurn({
        chatMode: input.chatMode,
        hasToolCalls: false,
        planHasOpenTodos: input.planHasOpenTodos,
        assistantText: input.assistantText,
        reasoningText: input.reasoningText,
        consecutiveEmptyTurns: input.consecutiveEmptyTurns,
      })
    ) {
      return {
        action: 'continue',
        nudges: ['continue_plan'],
        disableTools: false,
        bumpEmptyTurns: true,
      };
    }

    if (
      isAgentLike &&
      input.toolsRanInRun &&
      !input.summaryNudged &&
      !input.assistantText.trim() &&
      !input.planHasOpenTodos
    ) {
      return {
        action: 'continue',
        nudges: ['wrap_up'],
        disableTools: true,
        markSummaryNudged: true,
      };
    }

    if (
      input.planHasOpenTodos &&
      input.consecutiveEmptyTurns >= 2 &&
      !input.lengthPauseAnnounced &&
      !asksUserToChoose(input.assistantText, { allowBareQuestion: true }) &&
      !asksUserToChoose(input.reasoningText, { allowBareQuestion: false })
    ) {
      return { action: 'pause', reason: 'empty_turn_pause' };
    }

    // Plan mode: не заканчивать текстом без create_plan (один nudge, затем natural_end).
    if (
      input.chatMode === 'plan' &&
      !input.planDraftedInRun &&
      !input.summaryNudged &&
      !asksUserToChoose(input.assistantText, { allowBareQuestion: true }) &&
      !asksUserToChoose(input.reasoningText, { allowBareQuestion: false })
    ) {
      return {
        action: 'continue',
        nudges: ['draft_plan'],
        disableTools: false,
        markSummaryNudged: true,
      };
    }
  }

  return { action: 'natural_end' };
}
