/*--------------------------------------------------------------------------------------
 *  PPR Code — mount Режим Агент.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js';
import { AgentsWindow } from './AgentsWindow.js';

export const mountAgentsWindow = mountFnGenerator(AgentsWindow);
