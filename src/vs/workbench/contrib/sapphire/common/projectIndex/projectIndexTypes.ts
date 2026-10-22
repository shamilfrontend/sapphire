/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { WORKSPACE_DOT_DIR } from '../workspaceDotDir.js';

export const PROJECT_INDEX_SCHEMA_VERSION = 3;
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

type ProjectIndexLlmStatus = 'pending' | 'done' | 'failed' | 'skipped';

/** Слой по пути файла, без LLM. */
export type ProjectIndexLayer =
  | 'browser'
  | 'electron-main'
  | 'common'
  | 'node'
  | 'test'
  | 'docs'
  | 'other';

export type ProjectIndexEdgeType = 'imports' | 'contains' | 'calls';

export type ProjectIndexFileRecord = {
  path: string;
  mtime: number;
  size: number;
  kind: ProjectIndexFileKind;
  hash: string;
  layer: ProjectIndexLayer;
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
  /** Класс-владелец для method. */
  owner?: string;
};

export type ProjectIndexEdgeRecord = {
  fromPath: string;
  toPath: string;
  type: ProjectIndexEdgeType;
  fromSymbol?: string;
  toSymbol?: string;
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

export type ProjectIndexTourStep = {
  order: number;
  title: string;
  description: string;
  /** Workspace-relative paths, 1–5. */
  paths: string[];
  symbols?: string[];
};

export type ProjectIndexTour = {
  generatedAt: number;
  basedOn: { files: number; edges: number; purposeDone: number };
  steps: ProjectIndexTourStep[];
};

type ProjectIndexPhase = 'idle' | 'scanning' | 'analyzing' | 'purpose' | 'error';

export type ProjectIndexStepState = 'pending' | 'active' | 'done' | 'error';

export type ProjectIndexStepProgress = {
  state: ProjectIndexStepState;
  percent: number;
  processed: number;
  total: number;
};

export type ProjectIndexSteps = {
  scanning: ProjectIndexStepProgress;
  analyzing: ProjectIndexStepProgress;
  purpose: ProjectIndexStepProgress;
};

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
  steps: ProjectIndexSteps;
  manifest: ProjectIndexManifest | null;
  recentFiles: ProjectIndexFileRecord[];
  errors: Array<{ path: string; error: string }>;
  tour: ProjectIndexTour | null;
  tourRunning: boolean;
  tourError: string | null;
  /** basedOn сильно расходится с текущими counts. */
  tourStale: boolean;
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

export function emptyProjectIndexSteps(): ProjectIndexSteps {
  return {
    scanning: { state: 'pending', percent: 0, processed: 0, total: 0 },
    analyzing: { state: 'pending', percent: 0, processed: 0, total: 0 },
    purpose: { state: 'pending', percent: 0, processed: 0, total: 0 },
  };
}

export const EMPTY_PROJECT_INDEX_STATUS: ProjectIndexStatus = {
  phase: 'idle',
  percent: 0,
  processed: 0,
  total: 0,
  currentPath: null,
  error: null,
  isIndexed: false,
  isPaused: false,
  steps: emptyProjectIndexSteps(),
  manifest: null,
  recentFiles: [],
  errors: [],
  tour: null,
  tourRunning: false,
  tourError: null,
  tourStale: false,
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
