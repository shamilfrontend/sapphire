/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Diff, DiffArea, SapphireFileSnapshot } from '../common/editCodeServiceTypes.js';

export type StartBehavior = 'accept-conflicts' | 'reject-conflicts' | 'keep-conflicts';

export type CallBeforeStartApplyingOpts =
  | {
      from: 'QuickEdit';
      diffareaid: number; // id зоны Ctrl+K (выделенный фрагмент)
    }
  | {
      from: 'ClickApply';
      uri: 'current' | URI;
    };

export type StartApplyingOpts =
  | {
      from: 'QuickEdit';
      diffareaid: number; // id зоны Ctrl+K (выделенный фрагмент)
      startBehavior: StartBehavior;
    }
  | {
      from: 'ClickApply';
      applyStr: string;
      uri: 'current' | URI;
      startBehavior: StartBehavior;
    };

export type AddCtrlKOpts = {
  startLine: number;
  endLine: number;
  editor: ICodeEditor;
};

export const IEditCodeService = createDecorator<IEditCodeService>('editCodeService');

export interface IEditCodeService {
  readonly _serviceBrand: undefined;

  processRawKeybindingText(keybindingStr: string): string;

  callBeforeApplyOrEdit(uri: URI | 'current'): Promise<void>;
  startApplying(opts: StartApplyingOpts): [URI, Promise<void>] | null;
  instantlyApplySearchReplaceBlocks(opts: { uri: URI; searchReplaceBlocks: string }): void;
  instantlyRewriteFile(opts: { uri: URI; newContent: string }): Promise<void>;
  addCtrlKZone(opts: AddCtrlKOpts): number | undefined;
  removeCtrlKZone(opts: { diffareaid: number }): void;

  diffAreaOfId: Record<string, DiffArea>;
  diffAreasOfURI: Record<string, Set<string> | undefined>;
  diffOfId: Record<string, Diff>;

  acceptOrRejectAllDiffAreas(opts: {
    uri: URI;
    removeCtrlKs: boolean;
    behavior: 'reject' | 'accept';
    _addToHistory?: boolean;
  }): void;
  acceptDiff({ diffid }: { diffid: number }): void;
  rejectDiff({ diffid }: { diffid: number }): void;

  // события
  onDidAddOrDeleteDiffZones: Event<{ uri: URI }>;
  /** Только когда нет стриминга — при стриме слишком частые обновления. */
  onDidChangeDiffsInDiffZoneNotStreaming: Event<{ uri: URI; diffareaid: number }>;
  onDidChangeStreamingInDiffZone: Event<{ uri: URI; diffareaid: number }>;
  onDidChangeStreamingInCtrlKZone: Event<{ uri: URI; diffareaid: number }>;
  /** Пользователь (не Sapphire/Apply) изменил модель — для покрытия checkpoint. */
  onDidUserChangeContent: Event<{ uri: URI; beforeEntireFileCode: string }>;

  // состояние стриминга CtrlKZone
  isCtrlKZoneStreaming(opts: { diffareaid: number }): boolean;
  interruptCtrlKStreaming(opts: { diffareaid: number }): void;

  interruptURIStreaming(opts: { uri: URI }): void;

  // testDiffs(): void;
  getVoidFileSnapshot(uri: URI): SapphireFileSnapshot;
  restoreVoidFileSnapshot(uri: URI, snapshot: SapphireFileSnapshot): void;
}
