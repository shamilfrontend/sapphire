import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { buildRoot, getVersion, product, repoRoot, rootPackageJson } from '../constants.mjs';
import { copyPatterns, ensureDir, rimraf, writeText } from '../fileUtils.mjs';
import { getNodeOutputDir, getRemoteNodeVersion } from './nodeBinary.mjs';

const require = createRequire(import.meta.url);
const electron = require('@vscode/gulp-electron');
const { config } = require(path.join(repoRoot, 'build', 'lib', 'electron.js'));
const { getProductionDependencies } = require(path.join(repoRoot, 'build', 'lib', 'dependencies.js'));

function packageVersion() {
  if (product.quality && product.quality !== 'stable') {
    return `${rootPackageJson.version}-${product.quality}`;
  }
  return rootPackageJson.version;
}

async function writeBuildManifests(destinationRoot, basePackagePath = 'package.json', packageJsonUpdates = {}) {
  const commit = getVersion(repoRoot);
  const version = packageVersion();
  const datePath = path.join(repoRoot, 'out-build', 'date');
  const date = fs.existsSync(datePath) ? fs.readFileSync(datePath, 'utf8') : new Date().toISOString();

  const packageJsonTemplatePath = path.join(repoRoot, basePackagePath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonTemplatePath, 'utf8'));
  packageJson.name = product.nameShort;
  packageJson.version = version;
  for (const [key, value] of Object.entries(packageJsonUpdates)) {
    if (value === undefined) {
      delete packageJson[key];
    } else {
      packageJson[key] = value;
    }
  }
  writeText(path.join(destinationRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);

  const productJson = {
    ...product,
    commit,
    version,
    date,
  };
  writeText(path.join(destinationRoot, 'product.json'), `${JSON.stringify(productJson, null, 2)}\n`);
}

async function copyOutFolder(sourceRoot, destinationRoot) {
  await copyPatterns({
    cwd: repoRoot,
    patterns: [`${sourceRoot}/**`, `!${sourceRoot}/**/*.map`],
    destinationRoot,
    mapPath: (relativePath) => relativePath.replace(new RegExp(`^${sourceRoot}`), 'out'),
  });
}

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

function isUiExtensionManifest(manifest) {
  const workspaceExtensionPoints = new Set(['debuggers', 'jsonValidation']);
  switch (manifest.extensionKind) {
    case 'ui':
      return true;
    case 'workspace':
      return false;
    default: {
      if (manifest.main) {
        return false;
      }
      if (manifest.contributes && Object.keys(manifest.contributes).some((key) => workspaceExtensionPoints.has(key))) {
        return false;
      }
      return true;
    }
  }
}

function readVersionAndCommit() {
  const version = packageVersion();
  const commit = getVersion(repoRoot);
  return { version, commit };
}

function applyTemplate(text, replacements) {
  return text
    .replaceAll('@@APPNAME@@', replacements.appName)
    .replaceAll('@@VERSION@@', replacements.version)
    .replaceAll('@@COMMIT@@', replacements.commit);
}

async function writeExecutableFile(destinationPath, contents) {
  await ensureDir(path.dirname(destinationPath));
  fs.writeFileSync(destinationPath, contents, 'utf8');
  fs.chmodSync(destinationPath, 0o755);
}

async function writeTextFile(destinationPath, contents) {
  await ensureDir(path.dirname(destinationPath));
  fs.writeFileSync(destinationPath, contents, 'utf8');
}

function gatherServerExtensionNames(type, platform) {
  const localExtensionNames = fs
    .readdirSync(path.join(repoRoot, 'extensions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      if (name === 'vscode-api-tests' || name === 'vscode-test-resolver') {
        return false;
      }

      const manifestPath = path.join(repoRoot, 'extensions', name, 'package.json');
      if (!fs.existsSync(manifestPath)) {
        return false;
      }
      if (type === 'reh-web') {
        return true;
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return !isUiExtensionManifest(manifest);
    });

  const builtInExtensionNames = (product.builtInExtensions ?? [])
    .filter((entry) => !entry.platforms || new Set(entry.platforms).has(platform))
    .filter((entry) => !entry.clientOnly)
    .map((entry) => entry.name);

  return [...new Set([...localExtensionNames, ...builtInExtensionNames])];
}

async function copyRehExtensions({ type, platform, destinationRoot }) {
  const extensionNames = gatherServerExtensionNames(type, platform);
  const patterns = extensionNames.map((name) => `.build/extensions/${name}/**`);
  patterns.push('.build/extensions/node_modules/**');
  await copyPatterns({
    cwd: repoRoot,
    patterns,
    destinationRoot,
    mapPath: (relativePath) => relativePath.replace(/^\.build\//, ''),
  });
}

async function copyRemoteProductionDependencies(destinationRoot) {
  const remoteRoot = path.join(repoRoot, 'remote');
  const dependencies = getProductionDependencies(remoteRoot);
  const patterns = dependencies
    .map((dependencyPath) => path.relative(repoRoot, dependencyPath))
    .map((relativePath) => [
      `${relativePath}/**`,
      `!${relativePath}/**/{test,tests}/**`,
      `!${relativePath}/.bin/**`,
    ])
    .flat()
    .concat(['!**/package-lock.json', '!**/*.js.map']);

  await copyPatterns({
    cwd: repoRoot,
    patterns,
    destinationRoot,
    mapPath: (relativePath) => relativePath.replace(/^remote\//, ''),
  });
}

async function writeRehBinScripts({ platform, destinationRoot }) {
  const { version, commit } = readVersionAndCommit();
  const replacements = {
    appName: product.applicationName,
    version,
    commit,
  };
  const serverBinRoot = path.join(repoRoot, 'resources', 'server', 'bin');

  if (platform === 'win32') {
    const cliTemplate = fs.readFileSync(path.join(serverBinRoot, 'remote-cli', 'code.cmd'), 'utf8');
    const browserTemplate = fs.readFileSync(path.join(serverBinRoot, 'helpers', 'browser.cmd'), 'utf8');
    const codeServerScript = fs.readFileSync(path.join(serverBinRoot, 'code-server.cmd'), 'utf8');
    await writeTextFile(
      path.join(destinationRoot, 'bin', 'remote-cli', `${product.applicationName}.cmd`),
      applyTemplate(cliTemplate, replacements),
    );
    await writeTextFile(
      path.join(destinationRoot, 'bin', 'helpers', 'browser.cmd'),
      applyTemplate(browserTemplate, replacements),
    );
    await writeTextFile(
      path.join(destinationRoot, 'bin', `${product.serverApplicationName}.cmd`),
      codeServerScript,
    );
    return;
  }

  const scriptFlavor = platform === 'darwin' ? 'darwin' : 'linux';
  const cliTemplate = fs.readFileSync(path.join(serverBinRoot, 'remote-cli', `code-${scriptFlavor}.sh`), 'utf8');
  const browserTemplate = fs.readFileSync(path.join(serverBinRoot, 'helpers', `browser-${scriptFlavor}.sh`), 'utf8');
  const codeServerScript = fs.readFileSync(path.join(serverBinRoot, `code-server-${scriptFlavor}.sh`), 'utf8');

  await writeExecutableFile(
    path.join(destinationRoot, 'bin', 'remote-cli', product.applicationName),
    applyTemplate(cliTemplate, replacements),
  );
  await writeExecutableFile(
    path.join(destinationRoot, 'bin', 'helpers', 'browser.sh'),
    applyTemplate(browserTemplate, replacements),
  );
  await writeExecutableFile(
    path.join(destinationRoot, 'bin', product.serverApplicationName),
    codeServerScript,
  );

  if (platform === 'linux' || platform === 'alpine') {
    const requirementsScript = fs.readFileSync(
      path.join(serverBinRoot, 'helpers', 'check-requirements-linux.sh'),
      'utf8',
    );
    await writeExecutableFile(
      path.join(destinationRoot, 'bin', 'helpers', 'check-requirements.sh'),
      requirementsScript,
    );
  }
}

function getDesktopResourcesPath(destinationRoot, platform) {
  if (platform === 'darwin') {
    return path.join(destinationRoot, `${product.nameLong}.app`, 'Contents', 'Resources');
  }
  return path.join(destinationRoot, 'resources');
}

async function downloadDesktopRuntime(destinationRoot, platform, arch) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await streamToPromise(
        electron.dest(destinationRoot, {
          ...config,
          platform,
          arch: normalizeArch(arch),
          ffmpegChromium: false,
        }),
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        break;
      }
      console.warn(
        `[build] desktop runtime download failed for ${platform}-${arch} (attempt ${attempt}/3), retrying...`,
      );
    }
  }
  throw lastError;
}

async function copyProductionDependenciesToApp(appRoot) {
  const dependencies = getProductionDependencies(repoRoot);
  const patterns = dependencies
    .map((dependencyPath) => path.relative(repoRoot, dependencyPath))
    .map((relativePath) => [`${relativePath}/**`, `!${relativePath}/**/{test,tests}/**`])
    .flat()
    .concat(['!**/*.mk', '!**/package-lock.json', '!**/yarn.lock', '!**/*.js.map']);

  await copyPatterns({
    cwd: repoRoot,
    patterns,
    destinationRoot: appRoot,
  });
}

async function populateDesktopAppFolder({ appRoot, sourceRoot }) {
  await ensureDir(appRoot);
  await copyOutFolder(sourceRoot, appRoot);
  await copyPatterns({
    cwd: repoRoot,
    patterns: ['.build/extensions/**'],
    destinationRoot: appRoot,
    mapPath: (relativePath) => relativePath.replace(/^\.build\//, ''),
  });
  await copyPatterns({
    cwd: repoRoot,
    patterns: ['.build/telemetry/**'],
    destinationRoot: appRoot,
    mapPath: (relativePath) => relativePath.replace(/^\.build\/telemetry\//, ''),
  });
  await copyPatterns({
    cwd: repoRoot,
    patterns: [product.licenseFileName, 'ThirdPartyNotices.txt', 'licenses/**'],
    destinationRoot: appRoot,
  });
  await copyPatterns({
    cwd: repoRoot,
    patterns: ['src/vscode-dts/vscode.d.ts'],
    destinationRoot: appRoot,
    mapPath: () => 'out/vscode-dts/vscode.d.ts',
  });
  await copyProductionDependenciesToApp(appRoot);
  await writeBuildManifests(appRoot, 'package.json');
}

async function ensureDesktopExecutableAlias(destinationRoot, platform) {
  if (platform === 'linux') {
    const electronPath = path.join(destinationRoot, 'electron');
    const appPath = path.join(destinationRoot, product.applicationName);
    if (fs.existsSync(electronPath) && !fs.existsSync(appPath)) {
      fs.copyFileSync(electronPath, appPath);
      fs.chmodSync(appPath, 0o755);
    }
    return;
  }

  if (platform === 'win32') {
    const electronExePath = path.join(destinationRoot, 'electron.exe');
    const appExePath = path.join(destinationRoot, `${product.nameShort}.exe`);
    if (fs.existsSync(electronExePath) && !fs.existsSync(appExePath)) {
      fs.copyFileSync(electronExePath, appExePath);
    }
  }
}

export async function packageWebTask({ minified }) {
  const sourceRoot = minified ? 'out-vscode-web-min' : 'out-vscode-web';
  const destinationRoot = path.join(buildRoot, 'vscode-web');
  await rimraf(destinationRoot);
  await ensureDir(destinationRoot);

  await copyOutFolder(sourceRoot, destinationRoot);
  await copyPatterns({
    cwd: repoRoot,
    patterns: ['.build/web/extensions/**'],
    destinationRoot,
    mapPath: (relativePath) => relativePath.replace(/^\.build\/web\//, ''),
  });
  await copyPatterns({
    cwd: repoRoot,
    patterns: ['resources/server/favicon.ico', 'resources/server/manifest.json', 'resources/server/code-192.png', 'resources/server/code-512.png'],
    destinationRoot,
  });
  await writeBuildManifests(destinationRoot, 'remote/web/package.json');
}

export async function packageDesktopTask({ platform, arch, minified }) {
  const sourceRoot = minified ? 'out-vscode-min' : 'out-vscode';
  const destinationRoot = path.join(buildRoot, `VSCode-${platform}-${arch}`);
  await rimraf(destinationRoot);
  await ensureDir(destinationRoot);

  await downloadDesktopRuntime(destinationRoot, platform, arch);
  const resourcesPath = getDesktopResourcesPath(destinationRoot, platform);
  const appRoot = path.join(resourcesPath, 'app');
  await rimraf(appRoot);
  await populateDesktopAppFolder({ appRoot, sourceRoot });
  await ensureDesktopExecutableAlias(destinationRoot, platform);
}

export async function packageRehTask({ platform, arch, minified, withWeb }) {
  const flavor = withWeb ? 'reh-web' : 'reh';
  const sourceRoot = minified ? `out-vscode-${flavor}-min` : `out-vscode-${flavor}`;
  const destinationRoot = path.join(buildRoot, `vscode-${flavor}-${platform}-${arch}`);
  await rimraf(destinationRoot);
  await ensureDir(destinationRoot);

  await copyOutFolder(sourceRoot, destinationRoot);
  await copyRehExtensions({ type: flavor, platform, destinationRoot });
  await copyRemoteProductionDependencies(destinationRoot);
  await copyPatterns({
    cwd: repoRoot,
    patterns: ['remote/LICENSE'],
    destinationRoot,
    mapPath: (relativePath) => relativePath.replace(/^remote\//, ''),
  });
  const nodeVersion = getRemoteNodeVersion();
  const nodeDir = getNodeOutputDir(nodeVersion, platform, arch);
  await copyPatterns({
    cwd: nodeDir,
    patterns: ['**'],
    destinationRoot,
  });
  if (withWeb) {
    await copyPatterns({
      cwd: repoRoot,
      patterns: [
        'resources/server/favicon.ico',
        'resources/server/code-192.png',
        'resources/server/code-512.png',
        'resources/server/manifest.json',
      ],
      destinationRoot,
      mapPath: (relativePath) => relativePath,
    });
  }
  await writeRehBinScripts({ platform, destinationRoot });
  await writeBuildManifests(destinationRoot, 'remote/package.json', {
    dependencies: undefined,
    optionalDependencies: undefined,
    type: 'module',
  });
}
