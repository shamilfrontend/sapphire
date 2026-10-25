/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js';
import Settings from './Settings.vue';

export const mountVoidSettings = mountFnGenerator(Settings);
