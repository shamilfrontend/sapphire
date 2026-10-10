/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js';
import SapphireCommandBarMain from './SapphireCommandBarMain.vue';
import SapphireSelectionHelperMain from './SapphireSelectionHelperMain.vue';

export const mountSapphireCommandBar = mountFnGenerator(SapphireCommandBarMain);

export const mountSapphireSelectionHelper = mountFnGenerator(SapphireSelectionHelperMain);
