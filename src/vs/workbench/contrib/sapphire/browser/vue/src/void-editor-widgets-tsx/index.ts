/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js';
import SapphireCommandBarMain from './SapphireCommandBarMain.vue';
import SapphireSelectionHelperMain from './SapphireSelectionHelperMain.vue';

export const mountSapphireCommandBar = mountFnGenerator(SapphireCommandBarMain);

export const mountSapphireSelectionHelper = mountFnGenerator(SapphireSelectionHelperMain);
