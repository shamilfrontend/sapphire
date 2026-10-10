/*--------------------------------------------------------------------------------------
 *  PPR Code — open the Режим Агент review pane from the chat command bar.
 *--------------------------------------------------------------------------------------*/

import { inject, provide, type InjectionKey } from 'vue';

export type AgentsReviewApi = {
  openReview: (fsPath?: string) => void;
  reviewOpen: boolean;
};

export const agentsReviewKey: InjectionKey<AgentsReviewApi | null> = Symbol('agentsReview');

export const provideAgentsReview = (api: AgentsReviewApi) => {
  provide(agentsReviewKey, api);
};

export const useAgentsReview = () => inject(agentsReviewKey, null);
