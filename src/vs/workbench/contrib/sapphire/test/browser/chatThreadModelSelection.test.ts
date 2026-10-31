/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  ModelSelection,
  resolveThreadModelSelection,
  SAPPHIRE_AUTO_SELECTION,
} from '../../common/sapphireSettingsTypes.js';
import { ChatThreadLibrary } from '../../browser/chatThreadLibrary.js';
import { ChatThreadCollaboratorHost, ThreadType } from '../../browser/chatThreadTypes.js';

const deepseekChat: ModelSelection = { providerName: 'deepseek', modelName: 'deepseek-chat' };
const kimiK3: ModelSelection = { providerName: 'kimi', modelName: 'kimi-k3' };

const thread = (id: string, modelSelection?: ModelSelection): ThreadType => ({
  id,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-01T00:00:00.000Z',
  messages: [],
  state: {
    currCheckpointIdx: null,
    stagingSelections: [],
    focusedMessageIdx: undefined,
    linksOfMessageIdx: {},
    ...(modelSelection ? { modelSelection } : {}),
  },
});

const libraryWith = (current: ThreadType, globalChat: ModelSelection | null) => {
  const state = {
    allThreads: { [current.id]: current } as { [id: string]: ThreadType | undefined },
    currentThreadId: current.id,
    openThreadIds: [current.id],
    folders: [] as [],
  };
  const host = {
    state,
    _settingsService: {
      state: {
        globalSettings: { chatMode: 'normal' as const },
        modelSelectionOfFeature: { Chat: globalChat },
      },
    },
    _withThreadOpened: (id: string, open: string[]) => (open.includes(id) ? open : [...open, id]),
    _storeAllThreads: () => {},
    _setState(patch: Partial<typeof state>) {
      Object.assign(state, patch);
    },
  };
  return { host, library: new ChatThreadLibrary(host as unknown as ChatThreadCollaboratorHost) };
};

suite('resolveThreadModelSelection', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  test('keeps a model stored on the thread', () => {
    assert.deepStrictEqual(resolveThreadModelSelection(deepseekChat, SAPPHIRE_AUTO_SELECTION), deepseekChat);
    assert.deepStrictEqual(resolveThreadModelSelection(SAPPHIRE_AUTO_SELECTION, deepseekChat), SAPPHIRE_AUTO_SELECTION);
  });

  test('falls back when the thread has no model of its own', () => {
    assert.deepStrictEqual(resolveThreadModelSelection(undefined, SAPPHIRE_AUTO_SELECTION), SAPPHIRE_AUTO_SELECTION);
    assert.deepStrictEqual(resolveThreadModelSelection(null, deepseekChat), deepseekChat);
    assert.strictEqual(resolveThreadModelSelection('auto', deepseekChat), deepseekChat);
  });

  test('a new chat copies the current model and does not rewrite the previous chat', () => {
    const source = thread('a', SAPPHIRE_AUTO_SELECTION);
    const { host, library } = libraryWith(source, deepseekChat);
    library.openNewThread();

    const created = Object.values(host.state.allThreads).find((item) => item && item.id !== 'a');
    assert.ok(created);
    assert.deepStrictEqual(created.state.modelSelection, SAPPHIRE_AUTO_SELECTION);
    assert.deepStrictEqual(host.state.allThreads.a?.state.modelSelection, SAPPHIRE_AUTO_SELECTION);

    created.state.modelSelection = kimiK3;
    assert.deepStrictEqual(host.state.allThreads.a?.state.modelSelection, SAPPHIRE_AUTO_SELECTION);
  });

  test('a new chat snapshots the shared fallback so later edits stay local', () => {
    const source = thread('a');
    const { host, library } = libraryWith(source, SAPPHIRE_AUTO_SELECTION);
    library.openNewThread();

    const created = Object.values(host.state.allThreads).find((item) => item && item.id !== 'a');
    assert.ok(created);
    assert.deepStrictEqual(created.state.modelSelection, SAPPHIRE_AUTO_SELECTION);
    assert.strictEqual(host.state.allThreads.a?.state.modelSelection, undefined);

    created.state.modelSelection = deepseekChat;
    assert.strictEqual(host.state.allThreads.a?.state.modelSelection, undefined);
    assert.deepStrictEqual(
      resolveThreadModelSelection(host.state.allThreads.a?.state.modelSelection, SAPPHIRE_AUTO_SELECTION),
      SAPPHIRE_AUTO_SELECTION,
    );
  });

  test('changing model on chat B does not change resolved model of chat A', () => {
    const source = thread('a', SAPPHIRE_AUTO_SELECTION);
    const { host, library } = libraryWith(source, deepseekChat);
    library.openNewThread();

    const created = Object.values(host.state.allThreads).find((item) => item && item.id !== 'a');
    assert.ok(created);
    created.state.modelSelection = kimiK3;

    assert.deepStrictEqual(
      resolveThreadModelSelection(host.state.allThreads.a?.state.modelSelection, deepseekChat),
      SAPPHIRE_AUTO_SELECTION,
    );
    assert.deepStrictEqual(
      resolveThreadModelSelection(created.state.modelSelection, deepseekChat),
      kimiK3,
    );
  });
});
