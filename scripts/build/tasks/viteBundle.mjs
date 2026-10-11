import fs from 'node:fs';
import path from 'node:path';

import { build as viteBuild } from 'vite';

import { buildFile, getVersion, product, repoRoot, rootPackageJson } from '../constants.mjs';
import { copyPatterns, rimraf } from '../fileUtils.mjs';
import { createDesktopViteConfig } from '../vite/vite.desktop.config.mjs';
import { createWebViteConfig } from '../vite/vite.web.config.mjs';
import { createClientViteConfig } from '../vite/vite.client.config.mjs';
import { createBuildViteConfig } from '../vite/vite.build.config.mjs';

function entryListToInput(entryPoints, srcRoot = 'out-build') {
  return Object.fromEntries(
    entryPoints.map((entryPoint) => {
      const name = typeof entryPoint === 'string' ? entryPoint : entryPoint.name;
      return [name, path.join(repoRoot, srcRoot, `${name}.js`)];
    }),
  );
}

function mapResourcePatterns(patterns, destinationRoot) {
  return copyPatterns({
    cwd: repoRoot,
    patterns,
    destinationRoot,
    mapPath: (relativePath) => relativePath.replace(/^out-build\//, ''),
  });
}

function getVersionedProduct() {
  const commit = getVersion(repoRoot);
  const quality = product.quality;
  const version =
    quality && quality !== 'stable'
      ? `${rootPackageJson.version}-${quality}`
      : rootPackageJson.version;
  return { commit, version };
}

function createDesktopMapper() {
  const bootstrapPath = path.join(repoRoot, 'out-build', 'bootstrap-window.js');
  const bootstrapContent = fs.existsSync(bootstrapPath)
    ? fs.readFileSync(bootstrapPath, 'utf8')
    : '';
  const targets = new Set([
    '/out-build/vs/code/electron-sandbox/workbench/workbench.js',
    '/out-build/vs/code/electron-sandbox/processExplorer/processExplorer.js',
  ]);

  return (normalizedPath) => {
    if (!targets.has(normalizedPath.slice(normalizedPath.indexOf('/out-build/')))) {
      return undefined;
    }
    return (code) => `${bootstrapContent}\n${code}`;
  };
}

function scanBuiltinExtensions(extensionsRoot) {
  const results = [];
  if (!fs.existsSync(extensionsRoot)) {
    return results;
  }
  for (const extensionName of fs.readdirSync(extensionsRoot)) {
    const extensionPath = path.join(extensionsRoot, extensionName);
    const packagePath = path.join(extensionPath, 'package.json');
    if (!fs.existsSync(packagePath)) {
      continue;
    }
    const packageJSON = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const packageNlsPath = path.join(extensionPath, 'package.nls.json');
    const packageNLS = fs.existsSync(packageNlsPath)
      ? JSON.parse(fs.readFileSync(packageNlsPath, 'utf8'))
      : undefined;
    const readme = fs.readdirSync(extensionPath).find((name) => /^readme(\.txt|\.md|)$/i.test(name));
    const changelog = fs
      .readdirSync(extensionPath)
      .find((name) => /^changelog(\.txt|\.md|)$/i.test(name));
    results.push({
      extensionPath: extensionName,
      packageJSON,
      packageNLS,
      readmePath: readme ? path.join(extensionName, readme) : undefined,
      changelogPath: changelog ? path.join(extensionName, changelog) : undefined,
    });
  }
  return results;
}

function createProductMapper({ extensionsRoot, includeWebEndpoint = true }) {
  const { commit, version } = getVersionedProduct();
  const buildDatePath = path.join(repoRoot, 'out-build', 'date');
  const buildDate = fs.existsSync(buildDatePath)
    ? fs.readFileSync(buildDatePath, 'utf8')
    : new Date().toISOString();
  const tweakedProduct = includeWebEndpoint
    ? { ...product, commit, version, date: buildDate }
    : { ...product, commit, version, date: buildDate, webEndpointUrlTemplate: undefined };
  const builtinExtensions = scanBuiltinExtensions(extensionsRoot);

  return (normalizedPath) => {
    if (normalizedPath.endsWith('/out-build/vs/platform/product/common/product.js')) {
      return (code) =>
        code.replace(
          '/*BUILD->INSERT_PRODUCT_CONFIGURATION*/',
          () => JSON.stringify(tweakedProduct).slice(1, -1),
        );
    }

    if (
      normalizedPath.endsWith(
        '/out-build/vs/workbench/services/extensionManagement/browser/builtinExtensionsScannerService.js',
      )
    ) {
      return (code) =>
        code.replace(
          '/*BUILD->INSERT_BUILTIN_EXTENSIONS*/',
          () => JSON.stringify(builtinExtensions).slice(1, -1),
        );
    }

    return undefined;
  };
}

const desktopResourcePatterns = [
  'out-build/nls.messages.json',
  'out-build/nls.keys.json',
  'out-build/vs/code/electron-sandbox/workbench/workbench.html',
  'out-build/vs/base/parts/sandbox/electron-sandbox/preload.js',
  'out-build/vs/base/parts/sandbox/electron-sandbox/preload-aux.js',
  'out-build/vs/base/node/{terminateProcess.sh,cpuUsage.sh,ps.sh}',
  'out-build/vs/workbench/browser/parts/editor/media/*.png',
  'out-build/vs/workbench/contrib/debug/browser/media/*.png',
  'out-build/vs/workbench/contrib/externalTerminal/**/*.scpt',
  'out-build/vs/workbench/contrib/terminal/common/scripts/*.fish',
  'out-build/vs/workbench/contrib/terminal/common/scripts/*.ps1',
  'out-build/vs/workbench/contrib/terminal/common/scripts/*.psm1',
  'out-build/vs/workbench/contrib/terminal/common/scripts/*.sh',
  'out-build/vs/workbench/contrib/terminal/common/scripts/*.zsh',
  'out-build/vs/platform/accessibilitySignal/browser/media/*.mp3',
  'out-build/vs/workbench/contrib/welcomeGettingStarted/common/media/**/*.{svg,png}',
  'out-build/vs/workbench/contrib/extensions/browser/media/{theme-icon.png,language-icon.svg}',
  'out-build/vs/workbench/services/extensionManagement/common/media/*.{svg,png}',
  'out-build/vs/workbench/contrib/webview/browser/pre/*.{js,html}',
  'out-build/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html',
  'out-build/vs/code/electron-sandbox/processExplorer/processExplorer.html',
  'out-build/vs/editor/common/languages/highlights/*.scm',
  'out-build/vs/editor/common/languages/injections/*.scm',
  '!out-build/vs/code/browser/**',
  '!out-build/vs/editor/standalone/**',
  '!out-build/vs/code/**/*-dev.html',
  '!out-build/vs/workbench/contrib/issue/**/*-dev.html',
  '!**/test/**',
];

const webResourcePatterns = [
  'out-build/nls.messages.js',
  'out-build/vs/platform/accessibilitySignal/browser/media/*.mp3',
  'out-build/vs/workbench/contrib/welcomeGettingStarted/common/media/**/*.{svg,png}',
  'out-build/vs/workbench/contrib/extensions/browser/media/{theme-icon.png,language-icon.svg}',
  'out-build/vs/workbench/services/extensionManagement/common/media/*.{svg,png}',
  'out-build/vs/workbench/contrib/webview/browser/pre/*.{js,html}',
  'out-build/vs/editor/common/languages/highlights/*.scm',
  'out-build/vs/editor/common/languages/injections/*.scm',
  'out-build/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html',
  '!out-build/vs/**/{node,electron-sandbox,electron-main,electron-utility}/**',
  '!out-build/vs/editor/standalone/**',
  '!out-build/vs/workbench/**/*-tb.png',
  '!out-build/vs/code/**/*-dev.html',
  '!**/test/**',
];

const rehResourcePatterns = [
  'out-build/nls.messages.json',
  'out-build/vs/base/node/cpuUsage.sh',
  'out-build/vs/base/node/ps.sh',
  'out-build/vs/workbench/contrib/externalTerminal/**/*.scpt',
  'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1',
  'out-build/vs/workbench/contrib/terminal/common/scripts/CodeTabExpansion.psm1',
  'out-build/vs/workbench/contrib/terminal/common/scripts/GitTabExpansion.psm1',
  'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-bash.sh',
  'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-env.zsh',
  'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-profile.zsh',
  'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-rc.zsh',
  'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-login.zsh',
  'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration.fish',
  '!out-build/vs/**/{electron-sandbox,electron-main,electron-utility}/**',
  '!out-build/vs/editor/standalone/**',
  '!out-build/vs/workbench/**/*-tb.png',
  '!**/test/**',
];

const rehWebResourcePatterns = [
  ...rehResourcePatterns.filter((pattern) => pattern !== '!out-build/vs/editor/standalone/**'),
  'out-build/vs/code/browser/workbench/*.html',
  ...webResourcePatterns.filter((pattern) => pattern.startsWith('out-build/')),
  '!out-build/vs/code/**/*-dev.html',
];

async function runViteBundle(config) {
  await viteBuild(config);
}

export async function transpileClientViteTask() {
  const input = entryListToInput([buildFile.codeWeb, ...buildFile.keyboardMaps]);
  const outDir = path.join(repoRoot, 'out');
  await rimraf(outDir);
  await runViteBundle(createClientViteConfig({ root: repoRoot, input, outDir, minify: false }));
}

export async function buildClientViteTask() {
  const input = entryListToInput([buildFile.workbenchDesktop, buildFile.code].flat());
  const outDir = path.join(repoRoot, 'out-build');
  await rimraf(outDir);
  await runViteBundle(createBuildViteConfig({ root: repoRoot, input, outDir, minify: false }));
}

export async function bundleDesktopTask(minify = false) {
  const entryPoints = [
    buildFile.workerEditor,
    buildFile.workerExtensionHost,
    buildFile.workerNotebook,
    buildFile.workerLanguageDetection,
    buildFile.workerLocalFileSearch,
    buildFile.workerProfileAnalysis,
    buildFile.workerOutputLinks,
    buildFile.workerBackgroundTokenization,
    ...buildFile.workbenchDesktop,
    ...buildFile.code,
    'out-build/main',
    'out-build/cli',
    'out-build/bootstrap-fork',
  ].flat();
  const input = entryListToInput(entryPoints.map((entryPoint) => {
    if (typeof entryPoint === 'string') {
      return entryPoint.replace(/^out-build\//, '');
    }
    return entryPoint;
  }));

  const outDir = path.join(repoRoot, minify ? 'out-vscode-min' : 'out-vscode');
  await rimraf(outDir);
  await runViteBundle(
    createDesktopViteConfig({
      root: repoRoot,
      input,
      outDir,
      minify,
      mapper: createDesktopMapper(),
    }),
  );
  await mapResourcePatterns(desktopResourcePatterns, outDir);
}

export async function bundleWebTask(minify = false) {
  const entryPoints = [
    buildFile.workerEditor,
    buildFile.workerExtensionHost,
    buildFile.workerNotebook,
    buildFile.workerLanguageDetection,
    buildFile.workerLocalFileSearch,
    buildFile.workerOutputLinks,
    buildFile.workerBackgroundTokenization,
    ...buildFile.keyboardMaps,
    buildFile.workbenchWeb,
    buildFile.entrypoint('vs/workbench/workbench.web.main.internal'),
  ].flat();
  const input = entryListToInput(entryPoints);
  const outDir = path.join(repoRoot, minify ? 'out-vscode-web-min' : 'out-vscode-web');
  await rimraf(outDir);
  await runViteBundle(
    createWebViteConfig({
      root: repoRoot,
      input,
      outDir,
      minify,
      mapper: createProductMapper({
        extensionsRoot: path.join(repoRoot, '.build', 'web', 'extensions'),
        includeWebEndpoint: true,
      }),
    }),
  );
  await mapResourcePatterns(webResourcePatterns, outDir);
}

export async function bundleRehTask(minify = false, withWeb = false) {
  const serverEntryPoints = [...buildFile.codeServer];
  const webEntryPoints = [
    buildFile.workerEditor,
    buildFile.workerExtensionHost,
    buildFile.workerNotebook,
    buildFile.workerLanguageDetection,
    buildFile.workerLocalFileSearch,
    buildFile.workerOutputLinks,
    buildFile.workerBackgroundTokenization,
    ...buildFile.keyboardMaps,
    buildFile.codeWeb,
  ].flat();
  const bootstrap = ['out-build/server-main', 'out-build/server-cli', 'out-build/bootstrap-fork'].map(
    (entry) => entry.replace(/^out-build\//, ''),
  );
  const entryPoints = withWeb ? [...serverEntryPoints, ...webEntryPoints, ...bootstrap] : [...serverEntryPoints, ...bootstrap];

  const input = entryListToInput(entryPoints);
  const outDir = path.join(
    repoRoot,
    minify ? `out-vscode-${withWeb ? 'reh-web' : 'reh'}-min` : `out-vscode-${withWeb ? 'reh-web' : 'reh'}`,
  );
  await rimraf(outDir);
  await runViteBundle(
    createWebViteConfig({
      root: repoRoot,
      input,
      outDir,
      minify,
      mapper: createProductMapper({
        extensionsRoot: path.join(repoRoot, '.build', 'extensions'),
        includeWebEndpoint: !withWeb,
      }),
    }),
  );
  await mapResourcePatterns(withWeb ? rehWebResourcePatterns : rehResourcePatterns, outDir);
}
