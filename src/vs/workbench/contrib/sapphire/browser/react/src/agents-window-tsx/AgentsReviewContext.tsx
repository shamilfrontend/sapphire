/*--------------------------------------------------------------------------------------
 *  PPR Code — open the Режим Агент review pane from the chat command bar.
 *--------------------------------------------------------------------------------------*/

import { createContext, useContext } from 'react';

export type AgentsReviewApi = {
  openReview: (fsPath?: string) => void;
  reviewOpen: boolean;
};

const AgentsReviewContext = createContext<AgentsReviewApi | null>(null);

export const AgentsReviewProvider = AgentsReviewContext.Provider;

export const useAgentsReview = () => useContext(AgentsReviewContext);
