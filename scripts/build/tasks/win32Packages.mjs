import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

import { product, repoRoot, rootPackageJson } from '../constants.mjs';
import { ensureDir, copyPatterns, rimraf, writeText } from '../fileUtils.mjs';
import { commandExists, runCommand } from '../processUtils.mjs';

const require = createRequire(import.meta.url);
const rcedit = require('rcedit');

const buildPath = (arch) => path.join(repoRoot, '..', `VSCode-win32-${arch}`);
const setupDir = (arch, target) => path.join(repoRoot, '.build', `win32-${arch}`, `${target}-setup`);
const issPath = path.join(repoRoot, 'build', 'win32', 'code.iss');
const innoSetupPath = path.join(
  path.dirname(path.dirname(require.resolve('innosetup'))),
  'bin',
  'ISCC.exe',
);
const signWin32Path = path.join(repoRoot, 'build', 'azure-pipelines', 'common', 'sign-win32');

function assertPathExists(targetPath, message) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${message}: ${targetPath}`);
  }
}

function withQualityVersion() {
  const quality = product.quality || 'dev';
  return {
    quality,
    version: rootPackageJson.version,
    rawVersion: rootPackageJson.version.replace(/-\w+$/, ''),
  };
}

function setupDefinitions({ arch, target, sourcePath, outputPath, productJsonPath, sign, debug }) {
  const x64AppId = target === 'system' ? product.win32x64AppId : product.win32x64UserAppId;
  const arm64AppId = target === 'system' ? product.win32arm64AppId : product.win32arm64UserAppId;
  const { quality, version, rawVersion } = withQualityVersion();

  const definitions = {
    NameLong: product.nameLong,
    NameShort: product.nameShort,
    DirName: product.win32DirName,
    Version: version,
    RawVersion: rawVersion,
    NameVersion: product.win32NameVersion + (target === 'user' ? ' (User)' : ''),
    ExeBasename: product.nameShort,
    RegValueName: product.win32RegValueName,
    ShellNameShort: product.win32ShellNameShort,
    AppMutex: product.win32MutexName,
    TunnelMutex: product.win32TunnelMutex,
    TunnelServiceMutex: product.win32TunnelServiceMutex,
    TunnelApplicationName: product.tunnelApplicationName,
    ApplicationName: product.applicationName,
    Arch: arch,
    AppId: { x64: x64AppId, arm64: arm64AppId }[arch],
    IncompatibleTargetAppId: { x64: product.win32x64AppId, arm64: product.win32arm64AppId }[arch],
    AppUserId: product.win32AppUserModelId,
    ArchitecturesAllowed: { x64: 'x64', arm64: 'arm64' }[arch],
    ArchitecturesInstallIn64BitMode: { x64: 'x64', arm64: 'arm64' }[arch],
    SourceDir: sourcePath,
    RepoDir: repoRoot,
    OutputDir: outputPath,
    InstallTarget: target,
    ProductJsonPath: productJsonPath,
    Quality: quality,
  };

  if (quality === 'insider') {
    definitions.AppxPackage = `code_insiders_explorer_${arch}.appx`;
    definitions.AppxPackageFullname = `Microsoft.${product.win32RegValueName}_1.0.0.0_neutral__8wekyb3d8bbwe`;
  }
  if (sign) {
    definitions.Sign = 'true';
  }
  if (debug) {
    definitions.Debug = 'true';
  }
  return definitions;
}

async function runInnoSetup(definitions) {
  assertPathExists(innoSetupPath, 'Missing Inno Setup compiler executable');
  if (!commandExists('node')) {
    throw new Error('Missing required command: node');
  }
  const args = [
    issPath,
    ...Object.entries(definitions).map(([key, value]) => `/d${key}=${value}`),
    `/sesrp=node ${signWin32Path} $f`,
  ];
  await runCommand(innoSetupPath, args);
}

export async function buildWin32SetupTask(arch, target, options = {}) {
  if (!['system', 'user'].includes(target)) {
    throw new Error(`Invalid setup target: ${target}`);
  }
  if (!['x64', 'arm64'].includes(arch)) {
    throw new Error(`Invalid setup arch: ${arch}`);
  }

  const sourcePath = buildPath(arch);
  assertPathExists(sourcePath, `Missing win32 build output for arch ${arch}`);
  const outputPath = setupDir(arch, target);
  await rimraf(outputPath);
  await ensureDir(outputPath);

  const originalProductJsonPath = path.join(sourcePath, 'resources', 'app', 'product.json');
  const productJsonPath = path.join(outputPath, 'product.json');
  const productJson = JSON.parse(await fsp.readFile(originalProductJsonPath, 'utf8'));
  productJson.target = target;
  writeText(productJsonPath, JSON.stringify(productJson, null, '\t'));

  const definitions = setupDefinitions({
    arch,
    target,
    sourcePath,
    outputPath,
    productJsonPath,
    sign: options.sign,
    debug: options.debugInno,
  });
  await runInnoSetup(definitions);
}

export async function buildWin32InnoUpdaterTask(arch) {
  assertPathExists(buildPath(arch), `Missing win32 build output for arch ${arch}`);
  const destination = path.join(buildPath(arch), 'tools');
  await ensureDir(destination);
  await copyPatterns({
    cwd: path.join(repoRoot, 'build', 'win32'),
    patterns: ['inno_updater.exe', 'vcruntime140.dll'],
    destinationRoot: destination,
  });
  await new Promise((resolve, reject) => {
    rcedit(
      path.join(destination, 'inno_updater.exe'),
      { icon: path.join(repoRoot, 'resources', 'win32', 'code.ico') },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}
