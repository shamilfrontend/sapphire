/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatThreads } from '../../../../browser/chatThreadTypes.js';

export type PlanEditorMode = 'preview' | 'markdown';

/** Тред, к которому привязан planUri (текущий или любой с тем же activePlan). */
export const findPlanThreadId = (
  allThreads: ChatThreads,
  currentThreadId: string,
  planUriFsPath: string,
): string | undefined => {
  if (!planUriFsPath) {return undefined;}
  const current = allThreads[currentThreadId];
  if (current?.state.activePlan?.planUriFsPath === planUriFsPath) {return currentThreadId;}
  for (const id of Object.keys(allThreads)) {
    if (allThreads[id]?.state.activePlan?.planUriFsPath === planUriFsPath) {return id;}
  }
  return undefined;
};
