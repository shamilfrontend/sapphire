/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Монтирование chrome редактора плана (preview / markdown). */
import { mountFnGenerator } from '../util/mountFnGenerator.js';
import { PlanEditorChrome } from './PlanEditor.js';

export const mountPlanEditor = mountFnGenerator(PlanEditorChrome);
