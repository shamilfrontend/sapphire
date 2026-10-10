/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    './src2/void-editor-widgets-tsx/index.tsx',
    './src2/sidebar-tsx/index.tsx',
    './src2/void-settings-tsx/index.tsx',
    './src2/void-tooltip/index.tsx',
    './src2/void-onboarding/index.tsx',
    './src2/agents-window-tsx/index.tsx',
    './src2/quick-edit-tsx/index.tsx',
    './src2/plan-editor-tsx/index.tsx',
    './src2/project-index-titlebar-tsx/index.tsx',
    './src2/diff/index.tsx',
  ],
  outDir: './out',
  format: ['esm'],
  splitting: false,

  // dts: true,
  // sourcemap: true,

  clean: false,
  platform: 'browser', // 'node'
  target: 'esnext',
  injectStyle: true, // bundle css into the output file
  outExtension: () => ({ js: '.js' }),
  // default behavior is to take local files and make them internal (bundle them) and take imports like 'react' and leave them external (don't bundle them), we want the opposite in many ways
  noExternal: [
    // Bundle npm deps (incl. mermaid/chevrotain). Bare imports would otherwise stay external.
    /^(?!\.).*$/,
  ],
  external: [
    // Keep VS Code / void relative imports external, but NOT node_modules leftovers
    // like ../../../scan/tokens_public.js (chevrotain) — those must be bundled or
    // workbench.desktop.main fails with "Failed to fetch dynamically imported module".
    /^\.\.\/\.\.\/\.\.\/(?!scan\/).+\.js$/,
  ],
  treeshake: true,
  // Rollup tree-shake warns about unused VS Code externals pulled in via shared
  // util modules; silence that noise (real build failures still exit non-zero).
  silent: true,
  // Shared util modules pull many VS Code externals; per-entry tree-shaking
  // then warns that unused externals were imported. Hide that noise in watch/dev.
  esbuildOptions(options) {
    options.outbase = 'src2'; // tries copying the folder hierarchy starting at src2
    options.logLevel = 'error';
  },
});
