/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Точка монтирования React-сайдбара Sapphire в workbench. */
import { mountFnGenerator } from '../util/mountFnGenerator.js';
import { Sidebar } from './Sidebar.js';

export const mountSidebar = mountFnGenerator(Sidebar);
