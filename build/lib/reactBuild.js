/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const task = require('./task');

/**
 * Builds Sapphire/PPR React+Tailwind UI into
 * `src/vs/workbench/contrib/sapphire/browser/vue/out/`.
 * Must run before compile-client / compile-build so the bundle is copied into out/.
 */
const buildReactTask = task.define('build-react', async () => {
  const reactDir = path.join(__dirname, '../../src/vs/workbench/contrib/sapphire/browser/vue');
  // Prefer existing NODE_OPTIONS (e.g. from `npm run gulp`); otherwise give tsup enough heap.
  const env = { ...process.env };
  if (!env.NODE_OPTIONS) {
    env.NODE_OPTIONS = '--max-old-space-size=8192';
  }
  execSync('node build.js', { cwd: reactDir, stdio: 'inherit', env });
});

exports.buildReactTask = buildReactTask;
