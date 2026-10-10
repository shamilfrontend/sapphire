/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import { spawn } from 'cross-spawn';
// Added lines below
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function doesPathExist(filePath) {
  try {
    const stats = fs.statSync(filePath);

    return stats.isFile();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/*

This function finds `globalDesiredPath` given `localDesiredPath` and `currentPath`

Diagram:

...basePath/
└── void/
	├── ...currentPath/ (defined globally)
	└── ...localDesiredPath/ (defined locally)

*/
function findDesiredPathFromLocalPath(localDesiredPath, currentPath) {
  // walk upwards until currentPath + localDesiredPath exists
  while (!doesPathExist(path.join(currentPath, localDesiredPath))) {
    const parentDir = path.dirname(currentPath);

    if (parentDir === currentPath) {
      return undefined;
    }

    currentPath = parentDir;
  }

  // return the `globallyDesiredPath`
  const globalDesiredPath = path.join(currentPath, localDesiredPath);
  return globalDesiredPath;
}

// hack to refresh styles automatically
function saveStylesFile() {
  setTimeout(() => {
    try {
      const pathToCssFile = findDesiredPathFromLocalPath(
        './src/vs/workbench/contrib/sapphire/browser/react/src2/styles.css',
        __dirname,
      );

      if (pathToCssFile === undefined) {
        console.error('[scope-tailwind] Error finding styles.css');
        return;
      }

      // Or re-write with the same content:
      const content = fs.readFileSync(pathToCssFile, 'utf8');
      fs.writeFileSync(pathToCssFile, content, 'utf8');
      console.log('[scope-tailwind] Force-saved styles.css');
    } catch (err) {
      console.error('[scope-tailwind] Error saving styles.css:', err);
    }
  }, 6000);
}

const args = process.argv.slice(2);
const isWatch = args.includes('--watch') || args.includes('-w');

if (isWatch) {
  // One sequential pipeline: scope-tailwind must finish writing styles.css
  // before tsup bundles it. Parallel watchers previously raced and truncated
  // styles.css mid-write (missing utilities → unstyled chat UI).
  const rebuildCmd =
    'npx scope-tailwind ./src -o src2/ -s void-scope -c styles.css -p "void-" && npx tsup';

  try {
    console.log('🔨 Running initial build...');
    execSync(rebuildCmd, { stdio: 'inherit' });
    saveStylesFile();
    console.log('✅ Initial build complete.');
  } catch (err) {
    console.error('❌ Error running initial build:', err);
    process.exit(1);
  }

  const rebuildWatcher = spawn('npx', [
    'nodemon',
    '--watch',
    'src',
    '--ext',
    'ts,tsx,css',
    '--exec',
    rebuildCmd,
  ]);

  rebuildWatcher.stdout.on('data', (data) => {
    console.log(`[watchreact] ${data}`);
    if (data.toString().includes('styles.css') || data.toString().includes('Build success')) {
      saveStylesFile();
    }
  });

  rebuildWatcher.stderr.on('data', (data) => {
    console.error(`[watchreact] ${data}`);
  });

  process.on('SIGINT', () => {
    rebuildWatcher.kill();
    process.exit();
  });

  console.log('🔄 Watcher started (scope-tailwind → tsup). Press Ctrl+C to stop.');
} else {
  // Build mode
  console.log('📦 Building...');

  // Run scope-tailwind once
  execSync('npx scope-tailwind ./src -o src2/ -s void-scope -c styles.css -p "void-"', {
    stdio: 'inherit',
  });

  // Run tsup once
  execSync('npx tsup', { stdio: 'inherit' });

  console.log('✅ Build complete!');
}
