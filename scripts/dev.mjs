#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const codeScript = isWin
  ? path.join(root, 'scripts', 'code.bat')
  : path.join(root, 'scripts', 'code.sh');

// Must exist before Electron loadURL(workbench-dev.html). HTML may keep source mtimes;
// compiled JS must be newer than watch start (watch-client runs clean-out first).
const requiredOutFiles = [
  path.join(root, 'out', 'main.js'),
  path.join(root, 'out', 'bootstrap-window.js'),
  path.join(root, 'out', 'vs', 'base', 'parts', 'sandbox', 'electron-sandbox', 'preload.js'),
  path.join(root, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench-dev.html'),
  path.join(root, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.js'),
  path.join(root, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
  path.join(root, 'out', 'vs', 'workbench', 'workbench.common.main.js'),
];

const freshCompileMarkers = [
  path.join(root, 'out', 'main.js'),
  path.join(root, 'out', 'bootstrap-window.js'),
  path.join(root, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.js'),
  path.join(root, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
];

/** @type {import('child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function spawnNpm(script, { label } = {}) {
  const child = spawn(npm, ['run', script], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: isWin,
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(
        `[dev] ${label || script} exited with code ${code}${signal ? ` (${signal})` : ''}`,
      );
      shutdown(code);
    }
  });
  children.push(child);
  return child;
}

function fileMtimeMs(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function compileStatus(watchStartedAt) {
  const missing = requiredOutFiles.filter((f) => !existsSync(f));
  const stale = freshCompileMarkers.filter((f) => existsSync(f) && fileMtimeMs(f) < watchStartedAt);
  return { missing, stale };
}

/**
 * watch-client deletes out/ (clean-out) then recompiles. Launching against a
 * stale or mid-clean out/ yields ERR_FILE_NOT_FOUND and a permanent blank window.
 */
function waitForFreshCompile(watchStartedAt, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();
  let lastKey = '';
  return new Promise((resolve, reject) => {
    const tick = () => {
      const { missing, stale } = compileStatus(watchStartedAt);
      if (missing.length === 0 && stale.length === 0) {
        resolve();
        return;
      }
      const parts = [];
      if (missing.length) {
        parts.push(`missing: ${missing.map((f) => path.relative(root, f)).join(', ')}`);
      }
      if (stale.length) {
        parts.push(
          `stale (waiting for clean-out + rebuild): ${stale.map((f) => path.relative(root, f)).join(', ')}`,
        );
      }
      const key = parts.join(' | ');
      if (key !== lastKey) {
        lastKey = key;
        console.log(`[dev] Waiting for compile - ${key}`);
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for fresh out/ artifacts. ${key}`));
        return;
      }
      setTimeout(tick, 1000);
    };
    tick();
  });
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
    }
  }
  // Give children a moment, then force-exit
  setTimeout(() => process.exit(code), 500).unref?.();
}

async function main() {
  const appArgs = process.argv.slice(2);
  const watchStartedAt = Date.now();

  console.log('[dev] Starting watch (client + extensions)...');
  spawnNpm('watch', { label: 'watch' });

  console.log('[dev] Starting watchvue...');
  spawnNpm('watchvue', { label: 'watchvue' });

  console.log('[dev] Waiting for first compile after clean-out (this can take a few minutes)...');
  await waitForFreshCompile(watchStartedAt);
  console.log('[dev] Compile ready.');

  console.log(`[dev] Launching ${path.relative(root, codeScript)}...`);
  const app = spawn(codeScript, appArgs, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: isWin,
  });
  children.push(app);

  app.on('exit', (code) => {
    console.log('[dev] App closed - stopping watchers.');
    shutdown(code ?? 0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((err) => {
  console.error('[dev]', err);
  shutdown(1);
});
