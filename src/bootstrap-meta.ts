/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IProductConfiguration } from './vs/base/common/product.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.basename(__dirname) === 'chunks' ? path.dirname(__dirname) : __dirname;

let productObj: Partial<IProductConfiguration> & { BUILD_INSERT_PRODUCT_CONFIGURATION?: string } = {
  BUILD_INSERT_PRODUCT_CONFIGURATION: 'BUILD_INSERT_PRODUCT_CONFIGURATION',
}; // DO NOT MODIFY, PATCHED DURING BUILD
if (productObj.BUILD_INSERT_PRODUCT_CONFIGURATION) {
  productObj = require(path.join(runtimeRoot, 'product.json')); // Running out of sources
}

let pkgObj = { BUILD_INSERT_PACKAGE_CONFIGURATION: 'BUILD_INSERT_PACKAGE_CONFIGURATION' }; // DO NOT MODIFY, PATCHED DURING BUILD
if (pkgObj.BUILD_INSERT_PACKAGE_CONFIGURATION) {
  pkgObj = require(path.join(runtimeRoot, 'package.json')); // Running out of sources
}

export const product = productObj;
export const pkg = pkgObj;
