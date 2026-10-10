/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

const path = require('path');
const withDefaults = require('../shared.webpack.config');

module.exports = withDefaults({
  context: __dirname,
  entry: {
    'ipynbMain.node': './src/ipynbMain.node.ts',
    notebookSerializerWorker: './src/notebookSerializerWorker.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  plugins: [
    ...withDefaults.nodePlugins(__dirname), // add plugins, don't replace inherited
  ],
});
