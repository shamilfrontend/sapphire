/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { URI } from '../../../../base/common/uri.js';
import { SapphireFileSnapshot, DiffAreaSnapshotEntry } from '../common/editCodeServiceTypes.js';
import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { PENDING_DIFF_ZONES_STORAGE_KEY } from '../common/storageKeys.js';

/** Host для коллабораторов Apply — тот же объект, что EditCodeService. */
export interface EditCodeCollaboratorHost {
  [key: string]: any;
}

type PendingDiffZonesStored = Record<
  string,
  {
    uri: URI;
    snapshot: SapphireFileSnapshot;
  }
>;

export class EditCodePendingZones {
  constructor(private readonly _s: EditCodeCollaboratorHost) {}

  _schedulePersistPendingDiffZones() {
    if (this._s._rehydratingPendingDiffZones) return;
    this._s._persistPendingDiffZonesScheduler.schedule();
  }

  private _uriHasStreamingDiffZone(uri: URI): boolean {
    for (const diffareaid of this._s.diffAreasOfURI[uri.fsPath] ?? []) {
      const da = this._s.diffAreaOfId[diffareaid];
      if (da?.type === 'DiffZone' && da._streamState.isStreaming) {
        return true;
      }
    }
    return false;
  }

  private _getDiffZoneOnlySnapshot(uri: URI): SapphireFileSnapshot | null {
    const full = this._s._getCurrentVoidFileSnapshot(uri);
    const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshotEntry> = {};
    for (const id of Object.keys(full.snapshottedDiffAreaOfId)) {
      const entry = full.snapshottedDiffAreaOfId[id];
      if (entry?.type === 'DiffZone') {
        snapshottedDiffAreaOfId[id] = entry;
      }
    }
    if (Object.keys(snapshottedDiffAreaOfId).length === 0) {
      return null;
    }
    return {
      snapshottedDiffAreaOfId,
      entireFileCode: full.entireFileCode,
    };
  }

  _persistAllPendingDiffZones() {
    if (this._s._rehydratingPendingDiffZones) return;

    const map: PendingDiffZonesStored = {};
    const urisSeen = new Map<string, URI>();

    for (const diffareaid of Object.keys(this._s.diffAreaOfId)) {
      const da = this._s.diffAreaOfId[diffareaid];
      if (da?.type !== 'DiffZone') continue;
      urisSeen.set(da._URI.fsPath, da._URI);
    }

    for (const [fsPath, uri] of urisSeen) {
      if (this._uriHasStreamingDiffZone(uri)) continue; // mid-stream не сохраняем
      const snapshot = this._getDiffZoneOnlySnapshot(uri);
      if (!snapshot) continue;
      map[fsPath] = { uri, snapshot };
    }

    this._s._storageService.store(
      PENDING_DIFF_ZONES_STORAGE_KEY,
      JSON.stringify(map),
      StorageScope.WORKSPACE,
      StorageTarget.USER,
    );
  }

  private _parsePendingDiffZonesFromStorage(raw: string): PendingDiffZonesStored {
    try {
      const parsed = JSON.parse(raw, (_key, value) => {
        if (value && typeof value === 'object' && value.$mid === 1) {
          return URI.revive(value);
        }
        return value;
      }) as PendingDiffZonesStored;
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  }

  _bumpDiffAreaIdPoolFromRestoredIds(
    snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshotEntry>,
  ) {
    let maxId = this._s._diffareaidPool - 1;
    for (const idStr of Object.keys(snapshottedDiffAreaOfId)) {
      const n = Number(idStr);
      if (Number.isFinite(n) && n > maxId) maxId = n;
      const entry = snapshottedDiffAreaOfId[idStr];
      if (entry && typeof entry.diffareaid === 'number' && entry.diffareaid > maxId) {
        maxId = entry.diffareaid;
      }
    }
    this._s._diffareaidPool = Math.max(this._s._diffareaidPool, maxId + 1);
  }

  async _rehydratePendingDiffZones() {
    const raw = this._s._storageService.get(PENDING_DIFF_ZONES_STORAGE_KEY, StorageScope.WORKSPACE);
    if (!raw) return;

    this._s._rehydratingPendingDiffZones = true;
    const restoredURIs: URI[] = [];
    try {
      const stored = this._parsePendingDiffZonesFromStorage(raw);
      const kept: PendingDiffZonesStored = {};

      for (const fsPath of Object.keys(stored)) {
        const entry = stored[fsPath];
        if (!entry?.uri || !entry?.snapshot) continue;

        const uri = URI.isUri(entry.uri) ? entry.uri : URI.revive(entry.uri);
        await this._s._sapphireModelService.initializeModel(uri);
        const { model } = this._s._sapphireModelService.getModel(uri);
        if (!model) continue;

        const current = model.getValue(EndOfLinePreference.LF);
        if (current !== entry.snapshot.entireFileCode) {
          // Файл изменился — restore/Reject небезопасен
          continue;
        }

        // Только DiffZone (CtrlK после reload не восстанавливаем)
        const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshotEntry> = {};
        for (const id of Object.keys(entry.snapshot.snapshottedDiffAreaOfId ?? {})) {
          const snap = entry.snapshot.snapshottedDiffAreaOfId[id];
          if (snap?.type === 'DiffZone') {
            snapshottedDiffAreaOfId[id] = snap;
          }
        }
        if (Object.keys(snapshottedDiffAreaOfId).length === 0) continue;

        const snapshot: SapphireFileSnapshot = {
          snapshottedDiffAreaOfId,
          entireFileCode: entry.snapshot.entireFileCode,
        };
        await this._s._restoreVoidFileSnapshot(uri, snapshot);
        kept[fsPath] = { uri, snapshot };
        restoredURIs.push(uri);
      }

      this._s._storageService.store(
        PENDING_DIFF_ZONES_STORAGE_KEY,
        JSON.stringify(kept),
        StorageScope.WORKSPACE,
        StorageTarget.USER,
      );
    } finally {
      this._s._rehydratingPendingDiffZones = false;
    }

    // Событие для command bar, если он смонтировался позже
    for (const uri of restoredURIs) {
      this._s._onDidAddOrDeleteDiffZones.fire({ uri });
      this._s._diffZones._refreshStylesAndDiffsInURI(uri);
    }
  }
}
