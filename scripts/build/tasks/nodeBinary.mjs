import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { repoRoot } from '../constants.mjs';
import { ensureDir } from '../fileUtils.mjs';
import { runCommand } from '../processUtils.mjs';

export function getRemoteNodeVersion() {
  const npmrcPath = path.join(repoRoot, 'remote', '.npmrc');
  const npmrc = fs.readFileSync(npmrcPath, 'utf8');
  const match = /^target="(.*)"$/m.exec(npmrc);
  if (!match) {
    throw new Error('Unable to parse Node target version from remote/.npmrc');
  }
  return match[1];
}

function normalizeArchForNode(platform, arch) {
  if (arch === 'armhf') {
    return 'armv7l';
  }
  if (platform === 'alpine' && arch === 'alpine') {
    return 'x64';
  }
  return arch;
}

function buildNodeArchiveName(version, platform, arch) {
  if (platform === 'alpine') {
    return `node-v${version}-linux-${arch}-musl.tar.gz`;
  }
  if (platform === 'darwin' || platform === 'linux') {
    return `node-v${version}-${platform}-${arch}.tar.gz`;
  }
  if (platform === 'win32') {
    return `node.exe`;
  }
  throw new Error(`Unsupported platform for node bootstrap: ${platform}`);
}

function buildNodeDownloadUrl(version, platform, arch) {
  if (platform === 'win32') {
    return `https://nodejs.org/dist/v${version}/win-${arch}/node.exe`;
  }
  if (platform === 'darwin' || platform === 'linux') {
    return `https://nodejs.org/dist/v${version}/node-v${version}-${platform}-${arch}.tar.gz`;
  }
  if (platform === 'alpine') {
    return `https://nodejs.org/dist/v${version}/node-v${version}-linux-${arch}-musl.tar.gz`;
  }
  throw new Error(`Unsupported platform for node bootstrap: ${platform}`);
}

export function getNodeOutputDir(version, platform, arch) {
  return path.join(repoRoot, '.build', 'node', `v${version}`, `${platform}-${arch}`);
}

function outputNodePath(version, platform, arch) {
  return path.join(
    getNodeOutputDir(version, platform, arch),
    platform === 'win32' ? 'node.exe' : 'node',
  );
}

async function downloadFile(url, destinationPath) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
      }
      await ensureDir(path.dirname(destinationPath));
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destinationPath));
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        break;
      }
      console.warn(`[build] download failed (${attempt}/3): ${url}`);
    }
  }
  throw lastError;
}

async function extractNodeFromArchive(archivePath, archiveRoot, destinationPath) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sapphire-node-'));
  try {
    await runCommand('tar', ['-xzf', archivePath, '-C', tempDir]);
    const extractedPath = path.join(tempDir, archiveRoot, 'bin', 'node');
    await ensureDir(path.dirname(destinationPath));
    await fsp.copyFile(extractedPath, destinationPath);
    await fsp.chmod(destinationPath, 0o755);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

export async function ensureNodeBinary(platform, arch) {
  const version = getRemoteNodeVersion();
  const normalizedPlatform = arch === 'alpine' ? 'alpine' : platform;
  const normalizedArch = normalizeArchForNode(normalizedPlatform, arch);
  const finalPath = outputNodePath(version, platform, arch);

  if (fs.existsSync(finalPath)) {
    return finalPath;
  }

  await ensureDir(getNodeOutputDir(version, platform, arch));
  const downloadUrl = buildNodeDownloadUrl(version, normalizedPlatform, normalizedArch);

  if (platform === 'win32') {
    await downloadFile(downloadUrl, finalPath);
    return finalPath;
  }

  const archiveName = buildNodeArchiveName(version, normalizedPlatform, normalizedArch);
  const archivePath = path.join(os.tmpdir(), `sapphire-${archiveName}`);
  await downloadFile(downloadUrl, archivePath);
  const archiveRoot = archiveName.replace(/\.tar\.gz$/, '');
  await extractNodeFromArchive(archivePath, archiveRoot, finalPath);
  await fsp.rm(archivePath, { force: true });
  return finalPath;
}
