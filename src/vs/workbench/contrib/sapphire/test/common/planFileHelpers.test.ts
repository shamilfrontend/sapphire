/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  isPlanFilePath,
  parsePlanMarkdown,
  planProgressLabel,
  planTodosHaveOpen,
  serializePlanMarkdown,
} from '../../common/prompt/planFileHelpers.js';

suite('planFileHelpers', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  suite('isPlanFilePath', () => {
    test('matches .plan.md suffix', () => {
      assert.strictEqual(isPlanFilePath('/ws/.sapphire/plans/foo.plan.md'), true);
      assert.strictEqual(isPlanFilePath('C:\\ws\\.sapphire\\plans\\foo.plan.md'), true);
      assert.strictEqual(isPlanFilePath('/ws/readme.md'), false);
      assert.strictEqual(isPlanFilePath('/ws/foo.plan.md.bak'), false);
    });
  });

  suite('planProgressLabel / planTodosHaveOpen', () => {
    test('labels the in_progress step', () => {
      const todos = [
        { id: 'step-1', content: 'Snapshot', status: 'completed' as const },
        { id: 'step-2', content: 'Генератор Excel', status: 'in_progress' as const },
        { id: 'step-3', content: 'Проверка', status: 'pending' as const },
        { id: 'step-4', content: 'Итог', status: 'pending' as const },
      ];
      assert.strictEqual(planProgressLabel(todos), '2 из 4 · Генератор Excel');
      assert.strictEqual(planTodosHaveOpen(todos), true);
    });

    test('all completed or cancelled has no open label', () => {
      const todos = [
        { id: 'a', content: 'A', status: 'completed' as const },
        { id: 'b', content: 'B', status: 'cancelled' as const },
      ];
      assert.strictEqual(planProgressLabel(todos), undefined);
      assert.strictEqual(planTodosHaveOpen(todos), false);
    });
  });

  suite('parsePlanMarkdown', () => {
    test('roundtrips serialized todos and statuses', () => {
      const raw = serializePlanMarkdown({
        name: 'Сплит SidebarChat',
        overview: 'Разобрать гигантский файл.',
        plan: '## Подход\n\nВынести path helpers.',
        todos: [
          { id: 'step-1', content: 'pathLabels', status: 'completed' },
          { id: 'step-2', content: 'composer', status: 'in_progress' },
          { id: 'step-3', content: 'tool cards', status: 'pending' },
          { id: 'step-4', content: 'old idea', status: 'cancelled' },
        ],
      });
      const parsed = parsePlanMarkdown(raw);
      assert.strictEqual(parsed.name, 'Сплит SidebarChat');
      assert.strictEqual(parsed.overview, 'Разобрать гигантский файл.');
      assert.ok(parsed.plan.includes('Вынести path helpers.'));
      assert.deepStrictEqual(
        parsed.todos.map((t) => [t.id, t.content, t.status]),
        [
          ['step-1', 'pathLabels', 'completed'],
          ['step-2', 'composer', 'in_progress'],
          ['step-3', 'tool cards', 'pending'],
          ['step-4', 'old idea', 'cancelled'],
        ],
      );
    });

    test('empty todos array', () => {
      const raw = serializePlanMarkdown({
        name: 'Plan',
        overview: '',
        plan: 'Body',
        todos: [],
      });
      assert.deepStrictEqual(parsePlanMarkdown(raw).todos, []);
    });
  });
});
