/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isLinux, isMacintosh, isWindows } from '../../../../../base/common/platform.js';

// import { OS, OperatingSystem } from '../../../../../base/common/platform.js';
// альтернатива: OS === OperatingSystem.Windows и т.д.

export const os = isWindows ? 'windows' : isMacintosh ? 'mac' : isLinux ? 'linux' : null;
