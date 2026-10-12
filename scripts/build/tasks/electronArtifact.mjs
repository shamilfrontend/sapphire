import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { repoRoot } from '../constants.mjs';
import { ensureDir, rimraf } from '../fileUtils.mjs';

const require = createRequire(import.meta.url);
const { downloadArtifact } = require('@electron/get');
const extract = require('extract-zip');
const sumchecker = require('sumchecker');
const { config } = require(path.join(repoRoot, 'build', 'lib', 'electron.js'));

function electronDownloadArch(arch) {
  const normalized = arch === 'armhf' ? 'arm' : arch;
  return normalized === 'arm' ? 'armv7l' : normalized;
}

function assertExtractedElectron(destinationRoot, platform, artifactSuffix) {
  if (artifactSuffix) {
    const entries = fs.readdirSync(destinationRoot).filter((name) => name !== '.DS_Store');
    if (entries.length === 0) {
      throw new Error(`Electron ${artifactSuffix} archive extracted no files into ${destinationRoot}`);
    }
    return;
  }

  if (platform === 'darwin') {
    const appPath = path.join(destinationRoot, 'Electron.app');
    if (!fs.existsSync(appPath)) {
      throw new Error(`Electron.app is missing after extract: ${appPath}`);
    }
    return;
  }

  const binaryName = platform === 'win32' ? 'electron.exe' : 'electron';
  const binaryPath = path.join(destinationRoot, binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`${binaryName} is missing after extract: ${binaryPath}`);
  }
}

async function downloadElectronZip({ platform, arch, artifactName, artifactSuffix }) {
  const artifactDetails = {
    version: config.version,
    platform,
    arch: electronDownloadArch(arch),
    artifactName,
  };
  if (artifactSuffix) {
    artifactDetails.artifactSuffix = artifactSuffix;
  }
  if (config.repo) {
    artifactDetails.unsafelyDisableChecksums = true;
    artifactDetails.mirrorOptions = {
      mirror: `https://github.com/${config.repo}/releases/download/`,
      customDir: config.tag,
    };
  }

  const zipPath = await downloadArtifact(artifactDetails);
  if (config.validateChecksum) {
    await sumchecker('sha256', config.checksumFile, path.dirname(zipPath), [path.basename(zipPath)]);
  }
  return zipPath;
}

export async function downloadAndExtractElectron({
  destinationRoot,
  platform,
  arch,
  artifactName = 'electron',
  artifactSuffix,
}) {
  let lastError;
  const label = `${platform}-${arch}${artifactSuffix ? `-${artifactSuffix}` : ''}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rimraf(destinationRoot);
      await ensureDir(destinationRoot);
      const zipPath = await downloadElectronZip({ platform, arch, artifactName, artifactSuffix });
      await extract(zipPath, { dir: destinationRoot });
      assertExtractedElectron(destinationRoot, platform, artifactSuffix);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        break;
      }
      console.warn(`[build] electron download failed for ${label} (attempt ${attempt}/3), retrying...`);
    }
  }
  throw lastError;
}
