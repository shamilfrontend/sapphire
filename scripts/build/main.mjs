#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from './constants.mjs';
import {
  buildReact,
  compileBuildTask,
  compileClientTask,
  transpileClientEsbuildTask,
  watchClientTask,
} from './tasks/compile.mjs';
import {
  compileExtensionByName,
  compileExtensionMediaBuildTask,
  compileExtensionMediaTask,
  compileExtensionsBuildTask,
  compileExtensionsTask,
  compileNativeExtensionsBuildTask,
  compileNonNativeExtensionsBuildTask,
  compileWebExtensionsBuildTask,
  compileWebExtensionsTask,
  hasExtensionProject,
  transpileExtensionsTask,
  watchExtensionMediaTask,
  watchExtensionsTask,
} from './tasks/extensions.mjs';
import { packageDesktopTask, packageRehTask, packageWebTask } from './tasks/package.mjs';
import { ensureNodeBinary } from './tasks/nodeBinary.mjs';
import {
  buildDebPackageTask,
  buildRpmPackageTask,
  buildSnapPackageTask,
  prepareDebPackageTask,
  prepareRpmPackageTask,
  prepareSnapPackageTask,
} from './tasks/linuxPackages.mjs';
import { buildWin32InnoUpdaterTask, buildWin32SetupTask } from './tasks/win32Packages.mjs';
import { buildSymbolsTask } from './tasks/symbols.mjs';
import {
  buildClientViteTask,
  bundleDesktopTask,
  bundleRehTask,
  bundleWebTask,
  transpileClientViteTask,
} from './tasks/viteBundle.mjs';
import { runCommand, spawnLongRunning, waitForChildren } from './processUtils.mjs';

const __filename = fileURLToPath(import.meta.url);

function isLongTask(taskName) {
  return (
    taskName === 'watch' ||
    taskName === 'watch-client' ||
    taskName === 'watch-extensions' ||
    taskName === 'watch-web' ||
    taskName === 'watch-cli'
  );
}

function parseDesktopTask(taskName) {
  const match = /^vscode-(win32|darwin|linux)-(x64|arm64|armhf)(-min)?(-ci)?$/.exec(taskName);
  if (!match) {
    return undefined;
  }
  return {
    platform: match[1],
    arch: match[2],
    minified: Boolean(match[3]),
    ci: Boolean(match[4]),
  };
}

function parseRehTask(taskName) {
  const match = /^vscode-(reh|reh-web)-(win32|darwin|linux|alpine)-(x64|arm64|armhf|alpine)(-min)?(-ci)?$/.exec(
    taskName,
  );
  if (!match) {
    return undefined;
  }
  return {
    withWeb: match[1] === 'reh-web',
    platform: match[2],
    arch: match[3],
    minified: Boolean(match[4]),
    ci: Boolean(match[5]),
  };
}

function parseNodeTask(taskName) {
  if (taskName === 'node') {
    return { platform: process.platform, arch: process.arch };
  }
  const match = /^node-(win32|darwin|linux|alpine)-(x64|arm64|armhf|alpine)$/.exec(taskName);
  if (!match) {
    return undefined;
  }
  return { platform: match[1], arch: match[2] };
}

function parseLinuxPackageTask(taskName) {
  const match = /^vscode-linux-(x64|arm64|armhf)-(prepare-deb|build-deb|prepare-rpm|build-rpm|prepare-snap|build-snap)$/.exec(
    taskName,
  );
  if (!match) {
    return undefined;
  }
  return { arch: match[1], action: match[2] };
}

function parseWin32Task(taskName) {
  const match = /^vscode-win32-(x64|arm64)-(system-setup|user-setup|inno-updater)$/.exec(taskName);
  if (!match) {
    return undefined;
  }
  return { arch: match[1], action: match[2] };
}

function parseSymbolsTask(taskName) {
  const match = /^vscode-symbols-(win32|linux|darwin)-(x64|arm64|armhf)$/.exec(taskName);
  if (!match) {
    return undefined;
  }
  return { platform: match[1], arch: match[2] };
}

async function runDesktopTask(taskName) {
  const parsed = parseDesktopTask(taskName);
  if (!parsed) {
    return false;
  }

  if (!parsed.ci) {
    await compileBuildTask();
    await compileExtensionsBuildTask({ pullRequest: false });
    await compileExtensionMediaBuildTask();
    await bundleDesktopTask(parsed.minified);
  } else {
    await compileNativeExtensionsBuildTask();
  }

  await packageDesktopTask({
    platform: parsed.platform,
    arch: parsed.arch,
    minified: parsed.minified,
  });
  return true;
}

async function runRehTask(taskName) {
  const parsed = parseRehTask(taskName);
  if (!parsed) {
    return false;
  }

  if (!parsed.ci) {
    await compileBuildTask();
    await compileNonNativeExtensionsBuildTask();
    await compileExtensionMediaBuildTask();
    await bundleRehTask(parsed.minified, parsed.withWeb);
  } else {
    await compileNativeExtensionsBuildTask();
  }

  await ensureNodeBinary(parsed.platform, parsed.arch);
  await packageRehTask({
    platform: parsed.platform,
    arch: parsed.arch,
    minified: parsed.minified,
    withWeb: parsed.withWeb,
  });
  return true;
}

async function runTask(taskName, options) {
  const compileExtMatch = /^compile-extension:(.+)$/.exec(taskName);
  if (compileExtMatch) {
    const extensionName = compileExtMatch[1];
    if (hasExtensionProject(extensionName)) {
      await compileExtensionByName(extensionName, false);
      return;
    }
  }

  const watchExtMatch = /^(watch-extension|compile-watch):(.+)$/.exec(taskName);
  if (watchExtMatch) {
    const extensionName = watchExtMatch[2];
    if (hasExtensionProject(extensionName)) {
      await compileExtensionByName(extensionName, true);
      return;
    }
  }

  if (await runDesktopTask(taskName)) {
    return;
  }

  if (await runRehTask(taskName)) {
    return;
  }

  const nodeTask = parseNodeTask(taskName);
  if (nodeTask) {
    await ensureNodeBinary(nodeTask.platform, nodeTask.arch);
    return;
  }

  const linuxPackageTask = parseLinuxPackageTask(taskName);
  if (linuxPackageTask) {
    switch (linuxPackageTask.action) {
      case 'prepare-deb':
        await prepareDebPackageTask(linuxPackageTask.arch);
        return;
      case 'build-deb':
        await buildDebPackageTask(linuxPackageTask.arch);
        return;
      case 'prepare-rpm':
        await prepareRpmPackageTask(linuxPackageTask.arch);
        return;
      case 'build-rpm':
        await buildRpmPackageTask(linuxPackageTask.arch);
        return;
      case 'prepare-snap':
        await prepareSnapPackageTask(linuxPackageTask.arch);
        return;
      case 'build-snap':
        await buildSnapPackageTask(linuxPackageTask.arch);
        return;
      default:
        throw new Error(`Unknown linux package action: ${linuxPackageTask.action}`);
    }
  }

  const win32Task = parseWin32Task(taskName);
  if (win32Task) {
    if (win32Task.action === 'inno-updater') {
      await buildWin32InnoUpdaterTask(win32Task.arch);
      return;
    }
    await buildWin32SetupTask(win32Task.arch, win32Task.action === 'system-setup' ? 'system' : 'user', {
      sign: options.sign,
      debugInno: options.debugInno,
    });
    return;
  }

  const symbolsTask = parseSymbolsTask(taskName);
  if (symbolsTask) {
    await buildSymbolsTask(symbolsTask.platform, symbolsTask.arch);
    return;
  }

  switch (taskName) {
    case 'transpile-client-esbuild':
      await transpileClientEsbuildTask();
      return;
    case 'transpile-client-vite':
      await transpileClientViteTask();
      return;
    case 'transpile-extensions':
      await transpileExtensionsTask();
      return;
    case 'build-client-vite':
      await buildClientViteTask();
      return;
    case 'compile-client':
      await compileClientTask();
      return;
    case 'watch-client':
      await watchClientTask();
      return;
    case 'compile':
      await compileClientTask();
      await compileExtensionsTask();
      await compileExtensionMediaTask(false);
      return;
    case 'watch': {
      const watchClient = spawnLongRunning(process.execPath, [__filename, 'run', 'watch-client'], {
        cwd: repoRoot,
      });
      const watchExtensions = spawnLongRunning(
        process.execPath,
        [__filename, 'run', 'watch-extensions'],
        { cwd: repoRoot },
      );
      await waitForChildren([watchClient, watchExtensions]);
      return;
    }
    case 'watch-extensions': {
      const extensionWatch = spawnLongRunning(
        process.execPath,
        [__filename, 'run', 'watch-extensions:main'],
        { cwd: repoRoot },
      );
      const mediaWatch = spawnLongRunning(
        process.execPath,
        [__filename, 'run', 'watch-extension-media'],
        { cwd: repoRoot },
      );
      await waitForChildren([extensionWatch, mediaWatch]);
      return;
    }
    case 'watch-extensions:main':
      await watchExtensionsTask();
      return;
    case 'compile-extensions':
      await compileExtensionsTask();
      return;
    case 'compile-extension-media':
      await compileExtensionMediaTask(false);
      return;
    case 'watch-extension-media':
      await watchExtensionMediaTask();
      return;
    case 'compile-cli':
      await runCommand('cargo', ['build'], { cwd: path.join(repoRoot, 'cli') });
      return;
    case 'watch-cli': {
      const child = spawnLongRunning('cargo', ['build'], { cwd: path.join(repoRoot, 'cli') });
      await waitForChildren([child]);
      return;
    }
    case 'compile-web':
      await compileWebExtensionsTask(false);
      return;
    case 'watch-web':
      await compileWebExtensionsTask(true);
      return;
    case 'compile-build-with-mangling':
    case 'compile-build-without-mangling':
    case 'compile-build':
      await compileBuildTask();
      return;
    case 'bundle-vscode':
      await bundleDesktopTask(false);
      return;
    case 'minify-vscode':
      await bundleDesktopTask(true);
      return;
    case 'minify-vscode-reh':
      await bundleRehTask(true, false);
      return;
    case 'minify-vscode-reh-web':
      await bundleRehTask(true, true);
      return;
    case 'bundle-vscode-web':
      await bundleWebTask(false);
      return;
    case 'minify-vscode-web':
      await bundleWebTask(true);
      return;
    case 'compile-extensions-build':
      await compileExtensionsBuildTask({ pullRequest: false });
      return;
    case 'compile-extensions-build-pr':
      await compileExtensionsBuildTask({ pullRequest: true });
      return;
    case 'compile-non-native-extensions-build':
      await compileNonNativeExtensionsBuildTask();
      return;
    case 'compile-native-extensions-build':
      await compileNativeExtensionsBuildTask();
      return;
    case 'compile-web-extensions-build':
      await compileWebExtensionsBuildTask();
      return;
    case 'compile-extension-media-build':
      await compileExtensionMediaBuildTask();
      return;
    case 'extensions-ci':
      await compileNonNativeExtensionsBuildTask();
      await compileExtensionMediaBuildTask();
      return;
    case 'extensions-ci-pr':
      await compileExtensionsBuildTask({ pullRequest: true });
      await compileExtensionMediaBuildTask();
      return;
    case 'vscode-web-ci':
      await compileBuildTask();
      await compileWebExtensionsBuildTask();
      await bundleWebTask(false);
      await packageWebTask({ minified: false });
      return;
    case 'vscode-web':
      await compileBuildTask();
      await compileWebExtensionsBuildTask();
      await bundleWebTask(false);
      await packageWebTask({ minified: false });
      return;
    case 'vscode-web-min-ci':
      await compileBuildTask();
      await compileWebExtensionsBuildTask();
      await bundleWebTask(true);
      await packageWebTask({ minified: true });
      return;
    case 'vscode-web-min':
      await compileBuildTask();
      await compileWebExtensionsBuildTask();
      await bundleWebTask(true);
      await packageWebTask({ minified: true });
      return;
    case 'core-ci':
      await compileBuildTask();
      await bundleDesktopTask(true);
      await bundleRehTask(true, false);
      await bundleRehTask(true, true);
      return;
    case 'core-ci-pr':
      await compileBuildTask();
      await bundleDesktopTask(true);
      await bundleRehTask(true, false);
      await bundleRehTask(true, true);
      return;
    case 'hygiene':
      await runCommand(process.execPath, [path.join(repoRoot, 'build', 'hygiene.js')], { cwd: repoRoot });
      return;
    case 'electron':
      await runCommand(process.execPath, [path.join(repoRoot, 'build', 'lib', 'electron.js')], {
        cwd: repoRoot,
      });
      return;
    default:
      break;
  }

  throw new Error(`Unknown build task: ${taskName}`);
}

function parseOptions(optionArgs) {
  const optionSet = new Set(optionArgs.filter(Boolean));
  return {
    sign: optionSet.has('--sign'),
    debugInno: optionSet.has('--debug-inno'),
  };
}

async function run(taskNames, options) {
  if (taskNames.length === 0) {
    await runTask('compile', options);
    return;
  }
  for (const taskName of taskNames) {
    await runTask(taskName, options);
    if (isLongTask(taskName)) {
      break;
    }
  }
}

async function main() {
  const [, , command = 'run', ...args] = process.argv;
  const optionSeparator = args.indexOf('--');
  const taskArgs = optionSeparator >= 0 ? args.slice(0, optionSeparator) : args;
  const optionArgs = optionSeparator >= 0 ? args.slice(optionSeparator + 1) : [];
  const options = parseOptions(optionArgs);

  if (command !== 'run') {
    await run([command, ...taskArgs], options);
    return;
  }
  await run(taskArgs, options);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
