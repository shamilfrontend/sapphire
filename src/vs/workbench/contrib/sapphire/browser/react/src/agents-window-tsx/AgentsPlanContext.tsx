/*--------------------------------------------------------------------------------------
 *  PPR Code — open a plan beside the chat in Режим Агент.
 *--------------------------------------------------------------------------------------*/

import { createContext, useContext } from 'react';

export type AgentsPlanApi = {
  openPlan: (fsPath: string) => void;
  planOpen: boolean;
};

const AgentsPlanContext = createContext<AgentsPlanApi | null>(null);

export const AgentsPlanProvider = AgentsPlanContext.Provider;

export const useAgentsPlan = () => useContext(AgentsPlanContext);
