import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { repoRoot } from '../constants.mjs';
import { copyPatterns, ensureDir, rimraf } from '../fileUtils.mjs';
import { downloadAndExtractElectron } from './electronArtifact.mjs';

const require = createRequire(import.meta.url);
const { getProductionDependencies } = require(path.join(repoRoot, 'build', 'lib', 'dependencies.js'));

const excludedCheckList = ['d3dcompiler_47.dll'];

function getDestinationPaths(platform, arch) {
  const suffix = `${platform}${arch ? `-${arch}` : ''}`;
  return {
    exe: path.join(repoRoot, '..', 'scanbin', `VSCode-${suffix}`, 'bin'),
    pdb: path.join(repoRoot, '..', 'scanbin', `VSCode-${suffix}`, 'pdb'),
  };
}

async function downloadElectron(dest, platform, arch, extra = {}) {
  const artifactSuffix = extra.pdbs ? 'pdb' : extra.symbols ? 'symbols' : undefined;
  await downloadAndExtractElectron({
    destinationRoot: dest,
    platform,
    arch,
    artifactSuffix,
  });
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
