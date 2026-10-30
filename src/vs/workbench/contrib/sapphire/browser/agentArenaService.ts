/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
  InstantiationType,
  registerSingleton,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export type AgentArenaStatus = 'running' | 'done' | 'error' | 'interrupted';

export type AgentArenaEntry = {
  id: string;
  parentThreadId: string;
  description: string;
  status: AgentArenaStatus;
  startedAt: number;
  endedAt?: number;
  summary?: string;
  worktreePath?: string;
  readOnly: boolean;
};

export interface IAgentArenaService {
  readonly _serviceBrand: undefined;
  readonly onDidChange: Event<void>;
  list(parentThreadId?: string): readonly AgentArenaEntry[];
  upsert(entry: AgentArenaEntry): void;
  patch(id: string, patch: Partial<Omit<AgentArenaEntry, 'id'>>): void;
  remove(id: string): void;
  clearFinished(parentThreadId: string): void;
}

export const IAgentArenaService = createDecorator<IAgentArenaService>('agentArenaService');

class AgentArenaService extends Disposable implements IAgentArenaService {
  declare readonly _serviceBrand: undefined;

  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange = this._onDidChange.event;

  private readonly _entries = new Map<string, AgentArenaEntry>();

  list(parentThreadId?: string): readonly AgentArenaEntry[] {
    const all = [...this._entries.values()].sort((a, b) => b.startedAt - a.startedAt);
    if (!parentThreadId) {
      return all;
    }
    return all.filter((e) => e.parentThreadId === parentThreadId);
  }

  upsert(entry: AgentArenaEntry): void {
    this._entries.set(entry.id, entry);
    this._onDidChange.fire();
  }

  patch(id: string, patch: Partial<Omit<AgentArenaEntry, 'id'>>): void {
    const prev = this._entries.get(id);
    if (!prev) {
      return;
    }
    this._entries.set(id, { ...prev, ...patch });
    this._onDidChange.fire();
  }

  remove(id: string): void {
    if (this._entries.delete(id)) {
      this._onDidChange.fire();
    }
  }

  clearFinished(parentThreadId: string): void {
    let changed = false;
    for (const [id, entry] of this._entries) {
      if (entry.parentThreadId === parentThreadId && entry.status !== 'running') {
        this._entries.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this._onDidChange.fire();
    }
  }
}

registerSingleton(IAgentArenaService, AgentArenaService, InstantiationType.Delayed);
