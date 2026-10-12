import path from 'node:path';
import { createRequire } from 'node:module';
import { finished } from 'node:stream/promises';
import { repoRoot } from '../constants.mjs';
import { rimraf } from '../fileUtils.mjs';
import { runCommand, spawnLongRunning, waitForChildren } from '../processUtils.mjs';

const require = createRequire(import.meta.url);
const glob = require('glob');
const vfs = require('vinyl-fs');
const extensionBuildLib = require(path.join(repoRoot, 'build', 'lib', 'extensions.js'));

const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

const extensionProjects = {
  'configuration-editing': 'extensions/configuration-editing/tsconfig.json',
  'css-language-features-client': 'extensions/css-language-features/client/tsconfig.json',
  'css-language-features-server': 'extensions/css-language-features/server/tsconfig.json',
  'debug-auto-launch': 'extensions/debug-auto-launch/tsconfig.json',
  'debug-server-ready': 'extensions/debug-server-ready/tsconfig.json',
  emmet: 'extensions/emmet/tsconfig.json',
  'extension-editing': 'extensions/extension-editing/tsconfig.json',
  git: 'extensions/git/tsconfig.json',
  'git-base': 'extensions/git-base/tsconfig.json',
  github: 'extensions/github/tsconfig.json',
  'github-authentication': 'extensions/github-authentication/tsconfig.json',
  grunt: 'extensions/grunt/tsconfig.json',
  gulp: 'extensions/gulp/tsconfig.json',
  'html-language-features-client': 'extensions/html-language-features/client/tsconfig.json',
  'html-language-features-server': 'extensions/html-language-features/server/tsconfig.json',
  ipynb: 'extensions/ipynb/tsconfig.json',
  jake: 'extensions/jake/tsconfig.json',
  'json-language-features-client': 'extensions/json-language-features/client/tsconfig.json',
  'json-language-features-server': 'extensions/json-language-features/server/tsconfig.json',
  'markdown-language-features-languageService':
    'extensions/markdown-language-features/preview-src/tsconfig.json',
  'markdown-language-features': 'extensions/markdown-language-features/tsconfig.json',
  'markdown-math': 'extensions/markdown-math/tsconfig.json',
  'media-preview': 'extensions/media-preview/tsconfig.json',
  'merge-conflict': 'extensions/merge-conflict/tsconfig.json',
  'terminal-suggest': 'extensions/terminal-suggest/tsconfig.json',
  'microsoft-authentication': 'extensions/microsoft-authentication/tsconfig.json',
  'notebook-renderers': 'extensions/notebook-renderers/tsconfig.json',
  npm: 'extensions/npm/tsconfig.json',
  'php-language-features': 'extensions/php-language-features/tsconfig.json',
  'references-view': 'extensions/references-view/tsconfig.json',
  'search-result': 'extensions/search-result/tsconfig.json',
  'simple-browser': 'extensions/simple-browser/tsconfig.json',
  'tunnel-forwarding': 'extensions/tunnel-forwarding/tsconfig.json',
  'typescript-language-features-test-workspace':
    'extensions/typescript-language-features/test-workspace/tsconfig.json',
  'typescript-language-features-web': 'extensions/typescript-language-features/web/tsconfig.json',
  'typescript-language-features': 'extensions/typescript-language-features/tsconfig.json',
  'vscode-api-tests': 'extensions/vscode-api-tests/tsconfig.json',
  'vscode-colorize-tests': 'extensions/vscode-colorize-tests/tsconfig.json',
  'vscode-colorize-perf-tests': 'extensions/vscode-colorize-perf-tests/tsconfig.json',
  'vscode-test-resolver': 'extensions/vscode-test-resolver/tsconfig.json',
  'vscode-selfhost-test-provider': '.vscode/extensions/vscode-selfhost-test-provider/tsconfig.json',
  'vscode-selfhost-import-aid': '.vscode/extensions/vscode-selfhost-import-aid/tsconfig.json',
};

const extensionMediaScripts = [
  'extensions/markdown-language-features/esbuild-notebook.js',
  'extensions/markdown-language-features/esbuild-preview.js',
  'extensions/markdown-math/esbuild.js',
  'extensions/notebook-renderers/esbuild.js',
  'extensions/ipynb/esbuild.js',
  'extensions/simple-browser/esbuild-preview.js',
];

async function runExtensionBuildStream(stream, destination) {
  // vinyl-fs dest — duplex: читаемая сторона может дать `end` до того,
  // как асинхронные ветки (vsce.listFiles / webpack) допишут файлы.
  // finished() ждёт закрытия writable-стороны и отклоняется при error.
  const dest = stream.pipe(vfs.dest(destination));
  await finished(dest);
}

export function hasExtensionProject(name) {
  return Boolean(extensionProjects[name]);
}

export async function compileExtensionByName(name, watch = false) {
  const project = extensionProjects[name];
  if (!project) {
    throw new Error(`Unknown extension project: ${name}`);
  }
  const args = [tscBin, '-p', path.join(repoRoot, project), '--pretty', 'false', '--skipLibCheck'];
  const env = { ...process.env };
  if (!env.NODE_OPTIONS) {
    env.NODE_OPTIONS = '--max-old-space-size=8192';
  }
  if (watch) {
    args.push('--watch', '--preserveWatchOutput');
    return spawnLongRunning(process.execPath, args, { cwd: repoRoot, env });
  }
  await runCommand(process.execPath, args, { cwd: repoRoot, env });
  return undefined;
}

export async function compileExtensionsTask() {
  for (const projectName of Object.keys(extensionProjects)) {
    await compileExtensionByName(projectName, false);
  }
}

export async function transpileExtensionsTask() {
  await compileExtensionsTask();
}

export async function watchExtensionsTask() {
  const watchers = [];
  for (const projectName of Object.keys(extensionProjects)) {
    const child = await compileExtensionByName(projectName, true);
    watchers.push(child);
  }
  await waitForChildren(watchers);
}

export async function compileExtensionMediaTask(isWatch = false, outputRoot) {
  await Promise.all(
    extensionMediaScripts.map((script) => {
      const args = [path.join(repoRoot, script)];
      if (isWatch) {
        args.push('--watch');
      }
      if (outputRoot) {
        args.push('--outputRoot', outputRoot);
      }
      return runCommand(process.execPath, args, { cwd: repoRoot });
    }),
  );
}

export async function watchExtensionMediaTask() {
  const children = extensionMediaScripts.map((script) =>
    spawnLongRunning(
      process.execPath,
      [path.join(repoRoot, script), '--watch'],
      { cwd: repoRoot },
    ),
  );
  await waitForChildren(children);
}

export async function compileExtensionsBuildTask({ pullRequest = false } = {}) {
  await rimraf(path.join(repoRoot, '.build', 'extensions'));
  await runExtensionBuildStream(extensionBuildLib.packageMarketplaceExtensionsStream(false), '.build');
  await runExtensionBuildStream(
    extensionBuildLib.packageAllLocalExtensionsStream(false, pullRequest),
    '.build',
  );
}

export async function compileNonNativeExtensionsBuildTask() {
  await runExtensionBuildStream(extensionBuildLib.packageMarketplaceExtensionsStream(false), '.build');
  await runExtensionBuildStream(
    extensionBuildLib.packageNonNativeLocalExtensionsStream(false, false),
    '.build',
  );
}

export async function compileNativeExtensionsBuildTask() {
  await runExtensionBuildStream(
    extensionBuildLib.packageNativeLocalExtensionsStream(false, false),
    '.build',
  );
}

export async function compileWebExtensionsBuildTask() {
  await rimraf(path.join(repoRoot, '.build', 'web', 'extensions'));
  await runExtensionBuildStream(
    extensionBuildLib.packageAllLocalExtensionsStream(true, false),
    '.build/web',
  );
  await runExtensionBuildStream(
    extensionBuildLib.packageMarketplaceExtensionsStream(true),
    '.build/web',
  );
  await extensionBuildLib.buildExtensionMedia(false, '.build/web/extensions');
}

export async function compileExtensionMediaBuildTask() {
  await extensionBuildLib.buildExtensionMedia(false, '.build/extensions');
}

export async function compileWebExtensionsTask(isWatch = false) {
  const webpackConfigs = await new Promise((resolve, reject) => {
    glob(
      path.join(repoRoot, 'extensions', '**', 'extension-browser.webpack.config.js'),
      { ignore: ['**/node_modules'] },
      (error, matches) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(matches.map((configPath) => ({ configPath })));
      },
    );
  });
  await extensionBuildLib.webpackExtensions('packaging web extension', isWatch, webpackConfigs);
}
