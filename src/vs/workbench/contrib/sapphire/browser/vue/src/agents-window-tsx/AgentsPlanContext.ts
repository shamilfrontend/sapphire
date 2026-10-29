/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, provide, type InjectionKey } from 'vue';

export type AgentsPlanApi = {
  openPlan: (fsPath: string) => void;
  planOpen: boolean;
};

export const agentsPlanKey: InjectionKey<AgentsPlanApi | null> = Symbol('agentsPlan');

export const provideAgentsPlan = (api: AgentsPlanApi) => {
  provide(agentsPlanKey, api);
};

export const useAgentsPlan = () => inject(agentsPlanKey, null);
