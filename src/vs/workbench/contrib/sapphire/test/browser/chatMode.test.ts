/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatMode, resolveThreadChatMode } from '../../common/sapphireSettingsTypes.js';
import { ChatThreadLibrary } from '../../browser/chatThreadLibrary.js';
import { ChatThreadCollaboratorHost, ThreadType } from '../../browser/chatThreadTypes.js';

const thread = (id: string, chatMode?: ChatMode): ThreadType => ({
  id,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-01T00:00:00.000Z',
  messages: [],
  state: {
    currCheckpointIdx: null,
    stagingSelections: [],
    focusedMessageIdx: undefined,
    linksOfMessageIdx: {},
    ...(chatMode ? { chatMode } : {}),
  },
});

const libraryWith = (current: ThreadType, globalMode: ChatMode) => {
  const state = {
    allThreads: { [current.id]: current } as { [id: string]: ThreadType | undefined },
    currentThreadId: current.id,
    openThreadIds: [current.id],
    folders: [] as [],
  };
  const host = {
    state,
    _settingsService: { state: { globalSettings: { chatMode: globalMode } } },
    _withThreadOpened: (id: string, open: string[]) => (open.includes(id) ? open : [...open, id]),
    _storeAllThreads: () => {},
    _setState(patch: Partial<typeof state>) {
      Object.assign(state, patch);
    },
  };
  return { host, library: new ChatThreadLibrary(host as unknown as ChatThreadCollaboratorHost) };
};

suite('resolveThreadChatMode', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('keeps a mode stored on the thread', () => {
    assert.strictEqual(resolveThreadChatMode('normal', 'agent'), 'normal');
    assert.strictEqual(resolveThreadChatMode('plan', 'agent'), 'plan');
  });

  test('falls back when the thread has no mode of its own', () => {
    assert.strictEqual(resolveThreadChatMode(undefined, 'agent'), 'agent');
    assert.strictEqual(resolveThreadChatMode('gather', 'agent'), 'agent');
  });

  test('retired debug mode becomes agent', () => {
    assert.strictEqual(resolveThreadChatMode('debug', 'normal'), 'agent');
  });

  test('a new chat copies the current mode and does not rewrite the previous chat', () => {
    const source = thread('a', 'agent');
    const { host, library } = libraryWith(source, 'normal');
    library.openNewThread();

    const created = Object.values(host.state.allThreads).find((item) => item && item.id !== 'a');
    assert.ok(created);
    assert.strictEqual(created.state.chatMode, 'agent');
    assert.strictEqual(host.state.allThreads.a?.state.chatMode, 'agent');

    created.state.chatMode = 'normal';
    assert.strictEqual(host.state.allThreads.a?.state.chatMode, 'agent');
  });

  test('a new chat snapshots the shared fallback so later edits stay local', () => {
    const source = thread('a');
    const { host, library } = libraryWith(source, 'agent');
    library.openNewThread();

    const created = Object.values(host.state.allThreads).find((item) => item && item.id !== 'a');
    assert.ok(created);
    assert.strictEqual(created.state.chatMode, 'agent');
    assert.strictEqual(host.state.allThreads.a?.state.chatMode, undefined);

    created.state.chatMode = 'normal';
    assert.strictEqual(host.state.allThreads.a?.state.chatMode, undefined);
    assert.strictEqual(
      resolveThreadChatMode(host.state.allThreads.a?.state.chatMode, 'agent'),
      'agent',
    );
  });
});
