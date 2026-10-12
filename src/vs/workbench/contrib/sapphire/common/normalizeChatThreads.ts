/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatMessage, StagingSelectionItem } from './chatThreadServiceTypes.js';

/** Минимальная форма треда из JSON storage (поля могут отсутствовать). */
export type NormalizableChatThread = {
  id: string;
  createdAt?: string;
  lastModified?: string;
  messages?: ChatMessage[] | null;
  state?: {
    currCheckpointIdx?: number | null;
    stagingSelections?: StagingSelectionItem[] | null;
    focusedMessageIdx?: number;
    linksOfMessageIdx?: { [messageIdx: number]: unknown };
    [key: string]: unknown;
  } | null;
  filesWithUserChanges?: unknown;
  [key: string]: unknown;
};

export type NormalizableChatThreads = {
  [id: string]: NormalizableChatThread | undefined;
};

/**
 * Hydrate тредов из storage: убрать legacy-поля и гарантировать messages[] / state.
 * Без этого второе окно (APPLICATION storage) может получить битый тред и упасть на `.length`.
 */
export const normalizeThreadsFromStorage = (
  threads: NormalizableChatThreads,
): NormalizableChatThreads => {
  const out: NormalizableChatThreads = {};
  for (const id of Object.keys(threads)) {
    const t = threads[id];
    if (!t) continue;
    const { filesWithUserChanges: _drop, ...rest } = t;
    const prevState =
      rest.state && typeof rest.state === 'object' ? { ...rest.state } : ({} as NonNullable<
        NormalizableChatThread['state']
      >);
    const stagingSelections = Array.isArray(prevState.stagingSelections)
      ? prevState.stagingSelections
      : [];
    const linksOfMessageIdx =
      prevState.linksOfMessageIdx && typeof prevState.linksOfMessageIdx === 'object'
        ? prevState.linksOfMessageIdx
        : {};
    out[id] = {
      ...rest,
      id: typeof rest.id === 'string' ? rest.id : id,
      messages: Array.isArray(rest.messages) ? rest.messages : [],
      state: {
        ...prevState,
        currCheckpointIdx:
          prevState.currCheckpointIdx === undefined ? null : prevState.currCheckpointIdx,
        stagingSelections,
        linksOfMessageIdx,
      },
    };
  }
  return out;
};
