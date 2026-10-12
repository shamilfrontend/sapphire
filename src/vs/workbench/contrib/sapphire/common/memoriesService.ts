/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import {
  InstantiationType,
  registerSingleton,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
  IStorageService,
  StorageScope,
  StorageTarget,
} from '../../../../platform/storage/common/storage.js';
import { SAPPHIRE_MEMORIES_STORAGE_KEY } from './storageKeys.js';
import { MemoryType } from './toolsServiceTypes.js';

type StoredMemory = {
  type: MemoryType;
  key: string;
  value: string;
  tags: string[];
  updatedAt: string;
};

type MemoriesState = {
  decisions: StoredMemory[];
  preferences: StoredMemory[];
  context: StoredMemory[];
};

const MAX_BYTES = 50_000;
const MAX_DECISIONS = 20;
const MAX_PREFERENCES = 20;
const MAX_CONTEXT = 40;

export const IMemoriesService = createDecorator<IMemoriesService>('MemoriesService');

export interface IMemoriesService {
  readonly _serviceBrand: undefined;
  addMemory(type: MemoryType, key: string, value: string, tags?: string[]): Promise<void>;
  getRelevantMemories(query: string, limit?: number): StoredMemory[];
  getAllMemories(): StoredMemory[];
}

const emptyState = (): MemoriesState => ({
  decisions: [],
  preferences: [],
  context: [],
});

class MemoriesService extends Disposable implements IMemoriesService {
  readonly _serviceBrand: undefined;
  private _state: MemoriesState;

  constructor(@IStorageService private readonly storageService: IStorageService) {
    super();
    this._state = this._read();
  }

  private _read(): MemoriesState {
    try {
      const raw = this.storageService.get(SAPPHIRE_MEMORIES_STORAGE_KEY, StorageScope.WORKSPACE);
      if (!raw) {
        return emptyState();
      }
      const parsed = JSON.parse(raw) as Partial<MemoriesState>;
      return {
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
        context: Array.isArray(parsed.context) ? parsed.context : [],
      };
    } catch {
      return emptyState();
    }
  }

  private _persist(): void {
    let json = JSON.stringify(this._state);
    while (json.length > MAX_BYTES) {
      if (this._state.context.length > 0) {
        this._state.context.pop();
      } else if (this._state.preferences.length > MAX_PREFERENCES / 2) {
        this._state.preferences.pop();
      } else if (this._state.decisions.length > MAX_DECISIONS / 2) {
        this._state.decisions.pop();
      } else {
        break;
      }
      json = JSON.stringify(this._state);
    }
    this.storageService.store(
      SAPPHIRE_MEMORIES_STORAGE_KEY,
      json,
      StorageScope.WORKSPACE,
      StorageTarget.MACHINE,
    );
  }

  async addMemory(
    type: MemoryType,
    key: string,
    value: string,
    tags?: string[],
  ): Promise<void> {
    const entry: StoredMemory = {
      type,
      key: key.trim(),
      value: value.trim(),
      tags: (tags ?? []).map((t) => t.trim()).filter(Boolean),
      updatedAt: new Date().toISOString(),
    };
    if (!entry.key || !entry.value) {
      throw new Error('save_memory: key and value are required');
    }

    const bucket =
      type === 'decision'
        ? 'decisions'
        : type === 'preference'
          ? 'preferences'
          : 'context';

    if (type === 'context') {
      this._state.context = [entry, ...this._state.context.filter((m) => m.key !== entry.key)].slice(
        0,
        MAX_CONTEXT,
      );
    } else {
      const list = this._state[bucket].filter((m) => m.key !== entry.key);
      list.unshift(entry);
      this._state[bucket] = list.slice(
        0,
        type === 'decision' ? MAX_DECISIONS : MAX_PREFERENCES,
      );
    }
    this._persist();
  }

  getAllMemories(): StoredMemory[] {
    return [...this._state.decisions, ...this._state.preferences, ...this._state.context];
  }

  getRelevantMemories(query: string, limit = 8): StoredMemory[] {
    const q = query.toLowerCase().trim();
    const all = this.getAllMemories();
    if (!q) {
      return all.slice(0, limit);
    }
    const tokens = q.split(/\s+/).filter((t) => t.length > 2);
    const scored = all.map((m) => {
      const hay = `${m.key} ${m.value} ${m.tags.join(' ')}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) {
          score += 1;
        }
      }
      if (m.key.toLowerCase() && q.includes(m.key.toLowerCase())) {
        score += 2;
      }
      return { m, score };
    });
    scored.sort((a, b) => b.score - a.score || b.m.updatedAt.localeCompare(a.m.updatedAt));
    const relevant = scored.filter((s) => s.score > 0).map((s) => s.m);
    if (relevant.length > 0) {
      return relevant.slice(0, limit);
    }
    return all.slice(0, Math.min(3, limit));
  }
}

registerSingleton(IMemoriesService, MemoriesService, InstantiationType.Delayed);
