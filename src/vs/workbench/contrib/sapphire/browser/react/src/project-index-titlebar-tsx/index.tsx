/*--------------------------------------------------------------------------------------
 *  PPR Code — монтирование статуса индекса в titlebar IDE.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js';
import { ProjectIndexTitlebar } from './ProjectIndexTitlebar.js';

export const mountProjectIndexTitlebar = mountFnGenerator(ProjectIndexTitlebar);
