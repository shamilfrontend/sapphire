/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

export type ComputedDiff =
  | {
      type: 'edit';
      originalCode: string;
      originalStartLine: number;
      originalEndLine: number;
      code: string;
      startLine: number; // 1-indexed
      endLine: number;
    }
  | {
      type: 'insertion';
      // originalCode: string;
      originalStartLine: number; // insertion starts on column 0 of this
      // originalEndLine: number;
      code: string;
      startLine: number;
      endLine: number;
    }
  | {
      type: 'deletion';
      originalCode: string;
      originalStartLine: number;
      originalEndLine: number;
      // code: string;
      startLine: number; // deletion starts on column 0 of this
      // endLine: number;
    };

// ---------- Diff types ----------

type CommonZoneProps = {
  diffareaid: number;
  startLine: number;
  endLine: number;

  _URI: URI; // typically we get the URI from model
};

export type CtrlKZone = {
  type: 'CtrlKZone';
  originalCode?: undefined;

  editorId: string; // редактор, на котором висит Ctrl+K input

  // _ — поля, не копируемые при clone
  _mountInfo: null | {
    textAreaRef: { current: HTMLTextAreaElement | null };
    dispose: () => void;
    refresh: () => void;
  };
  _linkedStreamingDiffZone: number | null; // diffareaid of the diffZone currently streaming here
  _removeStylesFns: Set<Function>; // these don't remove diffs or this diffArea, only their styles
} & CommonZoneProps;

export type TrackingZone<T> = {
  type: 'TrackingZone';
  metadata: T;
  originalCode?: undefined;
  editorId?: undefined;
  _removeStylesFns?: undefined;
} & CommonZoneProps;

// историческое имя DiffArea; при желании можно переименовать в TextRegion
export type DiffArea = CtrlKZone | DiffZone | TrackingZone<unknown>;

export type Diff = {
  diffid: number;
  diffareaid: number; // diff area, к которой относится diff («computed»)
} & ComputedDiff;

export type DiffZone = {
  type: 'DiffZone';
  originalCode: string;
  _diffOfId: Record<string, Diff>; // diffid -> diff in this DiffArea
  _streamState:
    | {
        isStreaming: true;
        streamRequestIdRef: { current: string | null };
        line: number;
      }
    | {
        isStreaming: false;
        streamRequestIdRef?: undefined;
        line?: undefined;
      };
  editorId?: undefined;
  linkedStreamingDiffZone?: undefined;
  _removeStylesFns: Set<Function>; // these don't remove diffs or this diffArea, only their styles
} & CommonZoneProps;

export const diffAreaSnapshotKeys = [
  'type',
  'diffareaid',
  'originalCode',
  'startLine',
  'endLine',
  'editorId',
] as const satisfies (keyof DiffArea)[];

export type DiffAreaSnapshotEntry<DiffAreaType extends DiffArea = DiffArea> = Pick<
  DiffAreaType,
  (typeof diffAreaSnapshotKeys)[number]
>;

export type SapphireFileSnapshot = {
  snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshotEntry>;
  entireFileCode: string;
};
