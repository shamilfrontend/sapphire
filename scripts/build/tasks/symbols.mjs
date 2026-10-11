import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { repoRoot } from '../constants.mjs';
import { copyPatterns, ensureDir, rimraf } from '../fileUtils.mjs';

const require = createRequire(import.meta.url);
const electron = require('@vscode/gulp-electron');
const { config } = require(path.join(repoRoot, 'build', 'lib', 'electron.js'));
const { getProductionDependencies } = require(path.join(repoRoot, 'build', 'lib', 'dependencies.js'));

const excludedCheckList = ['d3dcompiler_47.dll'];

function streamToPromise(stream) {
  return new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

function normalizeArch(arch) {
  return arch === 'armhf' ? 'arm' : arch;
}

function getDestinationPaths(platform, arch) {
  const suffix = `${platform}${arch ? `-${arch}` : ''}`;
  return {
    exe: path.join(repoRoot, '..', 'scanbin', `VSCode-${suffix}`, 'bin'),
    pdb: path.join(repoRoot, '..', 'scanbin', `VSCode-${suffix}`, 'pdb'),
  };
}

async function downloadElectron(dest, platform, arch, extra = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await streamToPromise(
        electron.dest(dest, {
          ...config,
          platform,
          arch: normalizeArch(arch),
          ...extra,
        }),
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        break;
      }
      console.warn(
        `[build] electron download failed for ${platform}-${arch} (attempt ${attempt}/3), retrying...`,
      );
    }
  }
  throw lastError;
}

function getProductionDependencySources() {
  const deps = getProductionDependencies(repoRoot);
  return deps
    .map((dependencyPath) => path.relative(repoRoot, dependencyPath))
    .map((relative) => [`${relative}/**`, `!${relative}/**/{test,tests}/**`])
    .flat();
}

async function copyNodeModuleSymbols(destinationExe, destinationPdb, platform) {
  const sourcePatterns = getProductionDependencySources();

  await copyPatterns({
    cwd: repoRoot,
    patterns: sourcePatterns,
    destinationRoot: destinationExe,
    shouldCopy: (relativePath) => {
      if (!relativePath.endsWith('.node')) {
        return false;
      }
      if (relativePath.includes('/prebuilds/')) {
        return false;
      }
      if (relativePath.includes('/@parcel/watcher/')) {
        return false;
      }
      return true;
    },
  });

  if (platform === 'win32') {
    await copyPatterns({
      cwd: repoRoot,
      patterns: sourcePatterns,
      destinationRoot: destinationPdb,
      shouldCopy: (relativePath) => relativePath.endsWith('.pdb'),
    });
  } else if (platform === 'linux') {
    await copyPatterns({
      cwd: repoRoot,
      patterns: sourcePatterns,
      destinationRoot: destinationPdb,
      shouldCopy: (relativePath) => relativePath.endsWith('.sym'),
    });
  }
}

function confirmWin32Pdbs(destinationExe, destinationPdb) {
  for (const file of fs.readdirSync(destinationExe)) {
    if (excludedCheckList.includes(file)) {
      continue;
    }
    if (file.endsWith('.dll') || file.endsWith('.exe')) {
      const pdbPath = path.join(destinationPdb, `${file}.pdb`);
      if (!fs.existsSync(pdbPath)) {
        throw new Error(`Missing pdb file for ${file}: ${pdbPath}`);
      }
    }
  }
}

export async function buildSymbolsTask(platform, arch) {
  const { exe: destinationExe, pdb: destinationPdb } = getDestinationPaths(platform, arch);
  await rimraf(destinationExe);
  await rimraf(destinationPdb);
  await ensureDir(destinationExe);
  await ensureDir(destinationPdb);

  await downloadElectron(destinationExe, platform, arch);

  if (platform === 'win32') {
    await downloadElectron(destinationPdb, platform, arch, { pdbs: true });
    confirmWin32Pdbs(destinationExe, destinationPdb);
  } else if (platform === 'linux') {
    await downloadElectron(destinationPdb, platform, arch, { symbols: true });
  }

  await copyNodeModuleSymbols(destinationExe, destinationPdb, platform);
}
