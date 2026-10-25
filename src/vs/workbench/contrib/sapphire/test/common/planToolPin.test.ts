/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatMessage, ToolMessage } from '../../common/chatThreadServiceTypes.js';
import {
  findPinnedPlanToolMessage,
  planUriFsPathFromPlanTool,
  planUriFsPathToCollapseInThread,
  shouldCollapsePlanToolInThread,
} from '../../common/planToolPin.js';

const planUri = URI.file('/ws/.sapphire/plans/gar.plan.md');
const otherUri = URI.file('/ws/.sapphire/plans/other.plan.md');

const successCreate = (
  uri: URI,
  id = 'c1',
): ToolMessage<'create_plan'> => ({
  role: 'tool',
  type: 'success',
  name: 'create_plan',
  id,
  content: 'ok',
  rawParams: {},
  mcpServerName: undefined,
  params: {
    name: 'Сохранить задачу',
    overview: 'overview',
    plan: 'body',
    todos: [],
  },
  result: {
    planUri: uri,
    name: 'Сохранить задачу',
    overview: 'overview',
    todos: [],
  },
});

const successUpdate = (
  uri: URI,
  id = 'u1',
): ToolMessage<'update_plan'> => ({
  role: 'tool',
  type: 'success',
  name: 'update_plan',
  id,
  content: 'ok',
  rawParams: {},
  mcpServerName: undefined,
  params: {
    planUri: uri,
    name: 'Сохранить задачу',
    overview: 'overview',
    plan: null,
    todos: [],
  },
  result: {
    planUri: uri,
    name: 'Сохранить задачу',
    overview: 'overview',
    todos: [],
  },
});

suite('planToolPin', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('planUriFsPathFromPlanTool reads result.planUri', () => {
    assert.strictEqual(planUriFsPathFromPlanTool(successCreate(planUri)), planUri.fsPath);
  });

  test('planUriFsPathToCollapseInThread for ready/building/built', () => {
    assert.strictEqual(planUriFsPathToCollapseInThread(undefined), null);
    assert.strictEqual(
      planUriFsPathToCollapseInThread({
        planUriFsPath: planUri.fsPath,
        name: 'x',
        status: 'ready',
      }),
      planUri.fsPath,
    );
    assert.strictEqual(
      planUriFsPathToCollapseInThread({
        planUriFsPath: planUri.fsPath,
        name: 'x',
        status: 'building',
      }),
      planUri.fsPath,
    );
    assert.strictEqual(
      planUriFsPathToCollapseInThread({
        planUriFsPath: planUri.fsPath,
        name: 'x',
        status: 'built',
      }),
      planUri.fsPath,
    );
  });

  test('findPinnedPlanToolMessage prefers create_plan over later update_plan when ready', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x', displayContent: 'x', selections: [], state: { stagingSelections: [], isBeingEdited: false } },
      successCreate(planUri),
      { role: 'assistant', displayContent: 'Длинный ответ после плана', reasoning: '' },
      successUpdate(planUri),
    ];
    const pinned = findPinnedPlanToolMessage(messages, {
      planUriFsPath: planUri.fsPath,
      name: 'Сохранить задачу',
      status: 'ready',
    });
    assert.ok(pinned);
    assert.strictEqual(pinned!.name, 'create_plan');
    assert.strictEqual(pinned!.id, 'c1');
  });

  test('findPinnedPlanToolMessage returns null when building or built', () => {
    const messages: ChatMessage[] = [successCreate(planUri)];
    assert.strictEqual(
      findPinnedPlanToolMessage(messages, {
        planUriFsPath: planUri.fsPath,
        name: 'Сохранить задачу',
        status: 'building',
      }),
      null,
    );
    assert.strictEqual(
      findPinnedPlanToolMessage(messages, {
        planUriFsPath: planUri.fsPath,
        name: 'Сохранить задачу',
        status: 'built',
      }),
      null,
    );
  });

  test('findPinnedPlanToolMessage returns null without activePlan', () => {
    const messages: ChatMessage[] = [successCreate(planUri)];
    assert.strictEqual(findPinnedPlanToolMessage(messages, undefined), null);
  });

  test('findPinnedPlanToolMessage ignores other plan URI', () => {
    const messages: ChatMessage[] = [successCreate(otherUri)];
    assert.strictEqual(
      findPinnedPlanToolMessage(messages, {
        planUriFsPath: planUri.fsPath,
        name: 'x',
        status: 'ready',
      }),
      null,
    );
  });

  test('findPinnedPlanToolMessage falls back to update_plan when create_plan missing', () => {
    const messages: ChatMessage[] = [successUpdate(planUri)];
    const pinned = findPinnedPlanToolMessage(messages, {
      planUriFsPath: planUri.fsPath,
      name: 'Сохранить задачу',
      status: 'ready',
    });
    assert.ok(pinned);
    assert.strictEqual(pinned!.name, 'update_plan');
  });

  test('shouldCollapsePlanToolInThread matches collapse URI', () => {
    assert.strictEqual(
      shouldCollapsePlanToolInThread(successCreate(planUri), planUri.fsPath),
      true,
    );
    assert.strictEqual(
      shouldCollapsePlanToolInThread(successCreate(otherUri), planUri.fsPath),
      false,
    );
    assert.strictEqual(shouldCollapsePlanToolInThread(successCreate(planUri), null), false);
  });
});
