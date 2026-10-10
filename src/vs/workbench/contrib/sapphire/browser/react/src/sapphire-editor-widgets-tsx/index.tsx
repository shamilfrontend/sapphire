/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js';
import { SapphireCommandBarMain } from './SapphireCommandBar.js';
import { SapphireSelectionHelperMain } from './SapphireSelectionHelper.js';

export const mountSapphireCommandBar = mountFnGenerator(SapphireCommandBarMain);

export const mountSapphireSelectionHelper = mountFnGenerator(SapphireSelectionHelperMain);
