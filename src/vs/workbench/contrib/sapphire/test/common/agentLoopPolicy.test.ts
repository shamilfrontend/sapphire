/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  agentLoopStopMessage,
  asksUserToChoose,
  decideLoopContinuation,
  decideToolBatch,
  shouldAutoContinueOnLength,
  shouldAutoContinueTurn,
  shouldTranslateReasoningToRussian,
  streamingReasoningDisplay,
  toolBatchSignature,
  userMessageLooksRussian,
} from '../../common/agentLoopPolicy.js';
import { promoteEmptyDisplayFromReasoning } from '../../common/chatThreadServiceTypes.js';

const REPEAT_LIMIT = 3;

const readA = { name: 'read_file', rawParams: { uri: '/proj/a.ts' } };
const readB = { name: 'read_file', rawParams: { uri: '/proj/b.ts' } };

suite('agentLoopPolicy', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  suite('toolBatchSignature', () => {
    test('object key order does not change the signature', () => {
      const left = toolBatchSignature([
        { name: 'edit_file', rawParams: { uri: '/proj/a.ts', search_replace_blocks: 'x' } },
      ]);
      const right = toolBatchSignature([
        { name: 'edit_file', rawParams: { search_replace_blocks: 'x', uri: '/proj/a.ts' } },
      ]);
      assert.strictEqual(left, right);
    });

    test('call order and params change the signature', () => {
      const ab = toolBatchSignature([readA, readB]);
      const ba = toolBatchSignature([readB, readA]);
      const aa = toolBatchSignature([
        readA,
        { name: 'read_file', rawParams: { uri: '/proj/a.ts', extra: '1' } },
      ]);
      assert.notStrictEqual(ab, ba);
      assert.notStrictEqual(ab, toolBatchSignature([readA]));
      assert.notStrictEqual(toolBatchSignature([readA]), aa);
    });
  });

  suite('decideToolBatch', () => {
    test('a fresh batch runs', () => {
      assert.strictEqual(
        decideToolBatch({
          batch: [readA],
          recentSignatures: [],
          repeatLimit: REPEAT_LIMIT,
        }),
        'run',
      );
    });

    test('the third identical batch stops as a repeat', () => {
      const signature = toolBatchSignature([readA, readB]);
      assert.strictEqual(
        decideToolBatch({
          batch: [readA, readB],
          recentSignatures: [signature, signature],
          repeatLimit: REPEAT_LIMIT,
        }),
        'stop_repeat',
      );
    });

    test('two identical batches still run', () => {
      const signature = toolBatchSignature([readA]);
      assert.strictEqual(
        decideToolBatch({
          batch: [readA],
          recentSignatures: [signature],
          repeatLimit: REPEAT_LIMIT,
        }),
        'run',
      );
    });

    test('a different order or different params is not a repeat', () => {
      const signature = toolBatchSignature([readA, readB]);
      assert.strictEqual(
        decideToolBatch({
          batch: [readB, readA],
          recentSignatures: [signature, signature],
          repeatLimit: REPEAT_LIMIT,
        }),
        'run',
      );
      assert.strictEqual(
        decideToolBatch({
          batch: [readB],
          recentSignatures: [signature, signature],
          repeatLimit: REPEAT_LIMIT,
        }),
        'run',
      );
    });

    test('a non-consecutive repeat does not stop', () => {
      const repeated = toolBatchSignature([readA]);
      const other = toolBatchSignature([readB]);
      assert.strictEqual(
        decideToolBatch({
          batch: [readA],
          recentSignatures: [repeated, repeated, other],
          repeatLimit: REPEAT_LIMIT,
        }),
        'run',
      );
    });
  });

  suite('shouldTranslateReasoningToRussian', () => {
    const englishTrace =
      'The user answered: neutral styles, no Axis. I should update the plan and then stop and wait for the user to click the build button.';
    const russianWithConfluenceUrl = [
      '1 Считать содержимое',
      'https://wiki.transitcard.ru/spaces/GAR/pages/133411032/%D0%A2%D0%B5%D0%BA%D1%83%D1%89%D0%B5%D0%B5%20%D1%81%D0%BE%D1%81%D1%82%D0%BE%D1%8F%D0%BD%D0%B8%D0%B5',
      'и сохранить в current-state.md',
      '',
      '2 Считать задачу',
      'и сохранить в GAR-1914.md',
    ].join('\n');

    test('an English trace after a Russian user message is translated', () => {
      assert.strictEqual(
        shouldTranslateReasoningToRussian('нейтральные стили, без Axis', englishTrace),
        true,
      );
    });

    test('a Russian message with a percent-encoded Confluence URL still looks Russian', () => {
      assert.strictEqual(userMessageLooksRussian(russianWithConfluenceUrl), true);
      assert.strictEqual(
        shouldTranslateReasoningToRussian(russianWithConfluenceUrl, englishTrace),
        true,
      );
      assert.strictEqual(streamingReasoningDisplay(russianWithConfluenceUrl, englishTrace), '');
    });

    test('a Russian trace and an English user message stay as they are', () => {
      assert.strictEqual(
        shouldTranslateReasoningToRussian(
          'нейтральные стили, без Axis',
          'Пользователь выбрал нейтральные стили. Обновлю план и остановлюсь, чтобы дождаться кнопки.',
        ),
        false,
      );
      assert.strictEqual(
        shouldTranslateReasoningToRussian('use neutral styles please', englishTrace),
        false,
      );
    });
  });

  suite('streamingReasoningDisplay', () => {
    const englishTrace =
      'The user wants me to check for errors. I should lint the scripts and verify the xlsx formulas.';

    test('hides English reasoning for a Russian user message', () => {
      assert.strictEqual(streamingReasoningDisplay('проверить на ошибки', englishTrace), '');
    });

    test('keeps Russian reasoning and English-user traces', () => {
      assert.strictEqual(
        streamingReasoningDisplay(
          'проверить на ошибки',
          'Пользователь просит проверить ошибки. Сначала прогоню линтер, потом сверю формулы в xlsx.',
        ),
        'Пользователь просит проверить ошибки. Сначала прогоню линтер, потом сверю формулы в xlsx.',
      );
      assert.strictEqual(
        streamingReasoningDisplay('check for errors please', englishTrace),
        englishTrace,
      );
    });
  });

  suite('shouldAutoContinueTurn', () => {
    const base = {
      chatMode: 'agent' as const,
      hasToolCalls: false,
      planHasOpenTodos: true,
      assistantText: '',
      reasoningText: '',
      consecutiveEmptyTurns: 0,
    };

    test('an explicit choice in reasoning waits for the user', () => {
      assert.strictEqual(
        shouldAutoContinueTurn({
          ...base,
          reasoningText: 'Нужно выбрать стек. Скажи, если продолжаем с Vue.',
        }),
        false,
      );
      assert.strictEqual(asksUserToChoose('Скажи, если продолжаем — начну с шага 1'), true);
    });

    test('a rhetorical question in long reasoning does not block continue', () => {
      const longReasoning =
        'Looking at the bundle, is there a hidden column for tax? '.repeat(20) +
        'I will write build-xlsx.mjs next.';
      assert.strictEqual(
        shouldAutoContinueTurn({
          ...base,
          reasoningText: longReasoning,
        }),
        true,
      );
      assert.strictEqual(
        asksUserToChoose(longReasoning, { allowBareQuestion: false }),
        false,
      );
    });

    test('a short visible question waits for the user', () => {
      assert.strictEqual(
        shouldAutoContinueTurn({
          ...base,
          assistantText: 'Какой стек взять?',
        }),
        false,
      );
    });

    test('empty reasoning with open todos continues', () => {
      assert.strictEqual(
        shouldAutoContinueTurn({
          ...base,
          reasoningText: 'Сначала создам package.json и отмечу шаг.',
        }),
        true,
      );
    });

    test('the third empty turn in a row stops', () => {
      assert.strictEqual(shouldAutoContinueTurn({ ...base, consecutiveEmptyTurns: 1 }), true);
      assert.strictEqual(shouldAutoContinueTurn({ ...base, consecutiveEmptyTurns: 2 }), false);
    });

    test('closed todos, other modes, and tool calls do not continue', () => {
      assert.strictEqual(shouldAutoContinueTurn({ ...base, planHasOpenTodos: false }), false);
      assert.strictEqual(shouldAutoContinueTurn({ ...base, chatMode: 'plan' }), false);
      assert.strictEqual(shouldAutoContinueTurn({ ...base, hasToolCalls: true }), false);
    });
  });

  suite('shouldAutoContinueOnLength', () => {
    const base = {
      finishReason: 'length' as string | undefined,
      planHasOpenTodos: true,
      hadTruncatedToolCall: false,
      consecutiveLengthContinues: 0,
    };

    test('length with open todos continues', () => {
      assert.strictEqual(shouldAutoContinueOnLength(base), true);
    });

    test('length with a truncated tool call continues even without open todos', () => {
      assert.strictEqual(
        shouldAutoContinueOnLength({
          ...base,
          planHasOpenTodos: false,
          hadTruncatedToolCall: true,
        }),
        true,
      );
    });

    test('stop or missing finish_reason does not continue', () => {
      assert.strictEqual(shouldAutoContinueOnLength({ ...base, finishReason: 'stop' }), false);
      assert.strictEqual(shouldAutoContinueOnLength({ ...base, finishReason: undefined }), false);
    });

    test('the fourth length continue stops', () => {
      assert.strictEqual(
        shouldAutoContinueOnLength({ ...base, consecutiveLengthContinues: 2 }),
        true,
      );
      assert.strictEqual(
        shouldAutoContinueOnLength({ ...base, consecutiveLengthContinues: 3 }),
        false,
      );
    });
  });

  suite('promoteEmptyDisplayFromReasoning', () => {
    test('empty content is shown as the reply and the reasoning trace is cleared', () => {
      assert.deepStrictEqual(promoteEmptyDisplayFromReasoning('', 'Итог: подключил пересчёт.'), {
        displayContent: 'Итог: подключил пересчёт.',
        reasoning: '',
      });
      assert.deepStrictEqual(promoteEmptyDisplayFromReasoning('   ', '  Шаг готов.  '), {
        displayContent: 'Шаг готов.',
        reasoning: '',
      });
    });

    test('a visible reply keeps the reasoning trace', () => {
      assert.deepStrictEqual(
        promoteEmptyDisplayFromReasoning('Готово.', 'Сначала проверил типы.'),
        {
          displayContent: 'Готово.',
          reasoning: 'Сначала проверил типы.',
        },
      );
    });

    test('with tool calls, empty display keeps reasoning folded', () => {
      assert.deepStrictEqual(
        promoteEmptyDisplayFromReasoning('', 'Пользователь спрашивает. Вызову read_file.', {
          hasToolCalls: true,
        }),
        {
          displayContent: '',
          reasoning: 'Пользователь спрашивает. Вызову read_file.',
        },
      );
    });
  });

  suite('agentLoopStopMessage', () => {
    test('names the repeat count', () => {
      assert.ok(
        agentLoopStopMessage({ repeatLimit: REPEAT_LIMIT }).includes('3'),
      );
    });

    test('does not reference a Continue button', () => {
      assert.ok(
        !agentLoopStopMessage({ repeatLimit: REPEAT_LIMIT }).includes('Продолжить'),
      );
    });
  });

  suite('decideLoopContinuation', () => {
    const base = {
      toolsExecuted: false,
      hasToolCalls: false,
      batchDecision: null as null,
      ranAny: false,
      awaitingUserApproval: false,
      wantsLengthContinue: false,
      finishReason: 'stop' as string | undefined,
      planHasOpenTodos: false,
      hadTruncatedToolCall: false,
      toolsRanInRun: false,
      assistantText: 'Готово.',
      reasoningText: '',
      consecutiveEmptyTurns: 0,
      consecutiveLengthContinues: 0,
      summaryNudged: false,
      chatMode: 'agent' as const,
      planDraftedInRun: false,
    };

    test('run_tools when batch is runnable', () => {
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          hasToolCalls: true,
          batchDecision: 'run',
        }),
        { action: 'run_tools' },
      );
    });

    test('soft-stop wrap-up with tools disabled, then pause', () => {
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          hasToolCalls: true,
          batchDecision: 'stop_repeat',
          summaryNudged: false,
        }),
        {
          action: 'continue',
          nudges: ['wrap_up'],
          disableTools: true,
          markSummaryNudged: true,
        },
      );
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          hasToolCalls: true,
          batchDecision: 'stop_repeat',
          summaryNudged: true,
        }),
        { action: 'pause', reason: 'stop_repeat' },
      );
    });

    test('empty plan continue and length continue', () => {
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          planHasOpenTodos: true,
          assistantText: '',
          reasoningText: 'Сделаю следующий шаг.',
        }),
        {
          action: 'continue',
          nudges: ['continue_plan'],
          disableTools: false,
          bumpEmptyTurns: true,
        },
      );
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          wantsLengthContinue: true,
          planHasOpenTodos: true,
        }),
        {
          action: 'continue',
          nudges: ['length_continue'],
          disableTools: false,
          bumpLengthContinues: true,
        },
      );
    });

    test('natural_end when the turn has a visible reply', () => {
      assert.deepStrictEqual(decideLoopContinuation(base), { action: 'natural_end' });
    });

    test('plan mode drafts plan once when text has no create_plan', () => {
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          chatMode: 'plan',
          assistantText: 'Концепция лендинга «ШтрафНет»: секции hero, услуги, тарифы.',
          planDraftedInRun: false,
          summaryNudged: false,
        }),
        {
          action: 'continue',
          nudges: ['draft_plan'],
          disableTools: false,
          markSummaryNudged: true,
        },
      );
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          chatMode: 'plan',
          assistantText: 'Концепция лендинга «ШтрафНет»: секции hero, услуги, тарифы.',
          planDraftedInRun: false,
          summaryNudged: true,
        }),
        { action: 'natural_end' },
      );
    });

    test('plan mode natural_end when plan already drafted', () => {
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          chatMode: 'plan',
          assistantText: 'План готов, жду подтверждения.',
          planDraftedInRun: true,
        }),
        { action: 'natural_end' },
      );
    });

    test('plan mode natural_end on clarifying question without draft_plan nudge', () => {
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          chatMode: 'plan',
          assistantText: 'Уточни, какую палитру выбрать: тёмную или светлую?',
          planDraftedInRun: false,
          summaryNudged: false,
        }),
        { action: 'natural_end' },
      );
    });

    test('await_user after tools', () => {
      assert.deepStrictEqual(
        decideLoopContinuation({
          ...base,
          toolsExecuted: true,
          hasToolCalls: true,
          batchDecision: 'run',
          awaitingUserApproval: true,
        }),
        { action: 'await_user' },
      );
    });
  });
});
