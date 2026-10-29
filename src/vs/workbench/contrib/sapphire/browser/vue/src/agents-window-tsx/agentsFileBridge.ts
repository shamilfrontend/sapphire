/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type AgentsFileTarget = {
  fsPath: string;
  range?: [number, number];
};

type AgentsFileOpener = (target: AgentsFileTarget) => void;

let opener: AgentsFileOpener | null = null;

export const registerAgentsFileOpener = (next: AgentsFileOpener | null): void => {
  opener = next;
};

/** true, если оболочка агента перехватила открытие. */
export const openAgentsFile = (target: AgentsFileTarget): boolean => {
  if (!opener) {
    return false;
  }
  opener(target);
  return true;
};
