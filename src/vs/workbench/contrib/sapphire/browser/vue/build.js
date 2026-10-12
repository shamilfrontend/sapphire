/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import { spawn } from 'cross-spawn';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import postcssNested from 'postcss-nested';
import { walk as prefixVueClasses } from './prefixVueClasses.js';

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
        './src/vs/workbench/contrib/sapphire/browser/vue/src2/styles.css',
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

const prepareSrc2 = async () => {
  const srcDir = path.join(__dirname, 'src');
  const src2Dir = path.join(__dirname, 'src2');
  fs.rmSync(src2Dir, { recursive: true, force: true });
  fs.cpSync(srcDir, src2Dir, { recursive: true });
  prefixVueClasses(src2Dir);

  const cssPath = path.join(src2Dir, 'styles.css');
  const generated = execSync(`npx tailwindcss -i "${cssPath}" --prefix "void-"`, {
    cwd: __dirname,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const scoped = `.void-scope {\n${generated.replaceAll(':root', '&')}\n}`;
  const result = await postcss([autoprefixer, postcssNested]).process(scoped, { from: undefined });
  fs.writeFileSync(cssPath, result.css);
};

const runPipeline = async () => {
  await prepareSrc2();
  execSync('npx tsup', { cwd: __dirname, stdio: 'inherit' });
};

const args = process.argv.slice(2);
const isWatch = args.includes('--watch') || args.includes('-w');

if (isWatch) {
  try {
    console.log('🔨 Running initial build...');
    await runPipeline();
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
    'ts,tsx,vue,css',
    '--exec',
    'node build.js',
  ], { cwd: __dirname });

  rebuildWatcher.stdout.on('data', (data) => {
    console.log(`[watchvue] ${data}`);
    if (data.toString().includes('styles.css') || data.toString().includes('Build success')) {
      saveStylesFile();
    }
  });

  rebuildWatcher.stderr.on('data', (data) => {
    console.error(`[watchvue] ${data}`);
  });

  process.on('SIGINT', () => {
    rebuildWatcher.kill();
    process.exit();
  });

  console.log('🔄 Watcher started (prefix Vue classes → tailwind → tsup). Press Ctrl+C to stop.');
} else {
  console.log('📦 Building...');
  try {
    await runPipeline();
    console.log('✅ Build complete!');
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
}
