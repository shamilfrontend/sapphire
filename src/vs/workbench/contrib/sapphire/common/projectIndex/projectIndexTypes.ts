/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { WORKSPACE_DOT_DIR } from '../workspaceDotDir.js';

export const PROJECT_INDEX_SCHEMA_VERSION = 1;
export const PROJECT_INDEX_DIR_SEGMENTS = [WORKSPACE_DOT_DIR, 'index'] as const;
export const PROJECT_INDEX_GITIGNORE_LINE = `${WORKSPACE_DOT_DIR}/index/`;

export type ProjectIndexFileKind =
  | 'code'
  | 'csv'
  | 'xlsx'
  | 'docx'
  | 'pptx'
  | 'pdf'
  | 'other';

export type ProjectIndexLlmStatus = 'pending' | 'done' | 'failed' | 'skipped';

export type ProjectIndexFileRecord = {
  path: string;
  mtime: number;
  size: number;
  kind: ProjectIndexFileKind;
  hash: string;
  localRole: string;
  purpose?: string;
  tags?: string[];
  whenUseful?: string;
  llmStatus: ProjectIndexLlmStatus;
  error?: string;
  updatedAt: number;
};

export type ProjectIndexChunkRecord = {
  path: string;
  anchor: string;
  text: string;
};

export type ProjectIndexSymbolRecord = {
  path: string;
  symbolName: string;
  kind: string;
  startLine: number;
  endLine: number;
};

export type ProjectIndexEdgeRecord = {
  fromPath: string;
  toPath: string;
};

export type ProjectIndexManifest = {
  schemaVersion: number;
  root: string;
  builtAt: number;
  lastFullAt: number | null;
  lastIncrementalAt: number | null;
  counts: {
    files: number;
    chunks: number;
    symbols: number;
    edges: number;
    byKind: Partial<Record<ProjectIndexFileKind, number>>;
    purposeDone: number;
    purposePending: number;
    purposeFailed: number;
  };
};

export type ProjectIndexPhase = 'idle' | 'scanning' | 'analyzing' | 'purpose' | 'error';

export type ProjectIndexStatus = {
  phase: ProjectIndexPhase;
  percent: number;
  processed: number;
  total: number;
  currentPath: string | null;
  error: string | null;
  isIndexed: boolean;
  /** true после pause/cancel пользователя до resume или reindex. */
  isPaused: boolean;
  manifest: ProjectIndexManifest | null;
  recentFiles: ProjectIndexFileRecord[];
  errors: Array<{ path: string; error: string }>;
};

export type ProjectIndexSearchHit = {
  path: string;
  score: number;
  purpose: string | null;
  localRole: string;
  tags: string[];
  anchor: string | null;
  kind: ProjectIndexFileKind;
};

export const EMPTY_PROJECT_INDEX_STATUS: ProjectIndexStatus = {
  phase: 'idle',
  percent: 0,
  processed: 0,
  total: 0,
  currentPath: null,
  error: null,
  isIndexed: false,
  isPaused: false,
  manifest: null,
  recentFiles: [],
  errors: [],
};

export function emptyManifest(root: string): ProjectIndexManifest {
  return {
    schemaVersion: PROJECT_INDEX_SCHEMA_VERSION,
    root,
    builtAt: 0,
    lastFullAt: null,
    lastIncrementalAt: null,
    counts: {
      files: 0,
      chunks: 0,
      symbols: 0,
      edges: 0,
      byKind: {},
      purposeDone: 0,
      purposePending: 0,
      purposeFailed: 0,
    },
  };
}
