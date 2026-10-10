/*--------------------------------------------------------------------------------------
 *  PPR Code — монтирование статуса индекса в titlebar IDE.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js';
import ProjectIndexTitlebar from './ProjectIndexTitlebar.vue';

export const mountProjectIndexTitlebar = mountFnGenerator(ProjectIndexTitlebar);
