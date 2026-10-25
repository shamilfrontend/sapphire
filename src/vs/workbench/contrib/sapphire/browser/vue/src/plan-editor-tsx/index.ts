/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Монтирование chrome редактора плана (preview / markdown). */
import { mountFnGenerator } from '../util/mountFnGenerator.js';
import PlanEditorChrome from './PlanEditorChrome.vue';

export const mountPlanEditor = mountFnGenerator(PlanEditorChrome);
