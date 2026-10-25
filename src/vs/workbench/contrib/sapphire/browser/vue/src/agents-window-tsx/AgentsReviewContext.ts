/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
