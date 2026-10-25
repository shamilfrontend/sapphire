/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Точка монтирования React-сайдбара Sapphire в workbench. */
import { mountFnGenerator } from '../util/mountFnGenerator.js';
import Sidebar from './Sidebar.vue';

export const mountSidebar = mountFnGenerator(Sidebar);
