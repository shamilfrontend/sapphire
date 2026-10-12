/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

const path = require('path');
const withDefaults = require('../shared.webpack.config');

const config = withDefaults({
  context: path.join(__dirname, 'client'),
  entry: {
    extension: './src/node/jsonClientMain.ts',
  },
  output: {
    filename: 'jsonClientMain.js',
    path: path.join(__dirname, 'client', 'dist', 'node'),
  },
});

module.exports = config;
