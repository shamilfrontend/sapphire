import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

import { getVersion, product, repoRoot, rootPackageJson } from '../constants.mjs';
import { copyPatterns, ensureDir, rimraf, writeText } from '../fileUtils.mjs';
import { commandExists, runCommand } from '../processUtils.mjs';

const require = createRequire(import.meta.url);
const dependenciesGenerator = require(path.join(
  repoRoot,
  'build',
  'linux',
  'dependencies-generator.js',
));
const {
  additionalDeps: debAdditionalDeps,
  recommendedDeps,
  referenceGeneratedDepsByArch: debReferenceGeneratedDepsByArch,
} = require(path.join(repoRoot, 'build', 'linux', 'debian', 'dep-lists.js'));
const {
  additionalDeps: rpmAdditionalDeps,
  referenceGeneratedDepsByArch: rpmReferenceGeneratedDepsByArch,
} = require(path.join(repoRoot, 'build', 'linux', 'rpm', 'dep-lists.js'));

function linuxPackageRevision() {
  return Math.floor(Date.now() / 1000);
}

function getDebPackageArch(arch) {
  return { x64: 'amd64', armhf: 'armhf', arm64: 'arm64' }[arch];
}

function getRpmPackageArch(arch) {
  return { x64: 'x86_64', armhf: 'armv7hl', arm64: 'aarch64' }[arch];
}

function replaceTokens(input, replacements) {
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`@@${key}@@`, String(value)),
    input,
  );
}

function assertPathExists(targetPath, message) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${message}: ${targetPath}`);
  }
}

function getFallbackDebDependencies(debArch) {
  return [...new Set([...(debReferenceGeneratedDepsByArch[debArch] || []), ...debAdditionalDeps])].sort();
}

function getFallbackRpmDependencies(rpmArch) {
  return [...new Set([...(rpmReferenceGeneratedDepsByArch[rpmArch] || []), ...rpmAdditionalDeps])].sort();
}

async function getDebDependencies(binaryDir, debArch) {
  if (process.platform !== 'linux') {
    console.warn(
      `[build] Falling back to static Debian dependency list for ${debArch} on ${process.platform}.`,
    );
    return getFallbackDebDependencies(debArch);
  }
  const nativeModulesPath = path.join(binaryDir, 'resources', 'app', 'node_modules');
  const appBinaryPath = path.join(binaryDir, product.applicationName);
  if (!fs.existsSync(nativeModulesPath) || !fs.existsSync(appBinaryPath)) {
    console.warn(
      `[build] Falling back to static Debian dependency list for ${debArch} due to missing runtime layout.`,
    );
    return getFallbackDebDependencies(debArch);
  }

  try {
    const dependencies = await dependenciesGenerator.getDependencies(
      'deb',
      binaryDir,
      product.applicationName,
      debArch,
    );
    return dependencies.length > 0 ? dependencies : getFallbackDebDependencies(debArch);
  } catch (error) {
    console.warn(
      `[build] Falling back to static Debian dependency list for ${debArch}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return getFallbackDebDependencies(debArch);
  }
}

async function getRpmDependencies(binaryDir, rpmArch) {
  if (process.platform !== 'linux') {
    console.warn(
      `[build] Falling back to static RPM dependency list for ${rpmArch} on ${process.platform}.`,
    );
    return getFallbackRpmDependencies(rpmArch);
  }
  const nativeModulesPath = path.join(binaryDir, 'resources', 'app', 'node_modules');
  const appBinaryPath = path.join(binaryDir, product.applicationName);
  if (!fs.existsSync(nativeModulesPath) || !fs.existsSync(appBinaryPath)) {
    console.warn(
      `[build] Falling back to static RPM dependency list for ${rpmArch} due to missing runtime layout.`,
    );
    return getFallbackRpmDependencies(rpmArch);
  }

  try {
    const dependencies = await dependenciesGenerator.getDependencies(
      'rpm',
      binaryDir,
      product.applicationName,
      rpmArch,
    );
    return dependencies.length > 0 ? dependencies : getFallbackRpmDependencies(rpmArch);
  } catch (error) {
    console.warn(
      `[build] Falling back to static RPM dependency list for ${rpmArch}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return getFallbackRpmDependencies(rpmArch);
  }
}

async function copyTemplateWithReplacements(sourcePath, destinationPath, replacements) {
  const contents = await fsp.readFile(path.join(repoRoot, sourcePath), 'utf8');
  const rendered = replaceTokens(contents, replacements);
  writeText(destinationPath, rendered);
}

async function copyBinaryIntoRoot(binaryDir, destinationRoot, targetPrefix) {
  await copyPatterns({
    cwd: binaryDir,
    patterns: ['**'],
    destinationRoot,
    mapPath: (relativePath) => path.join(targetPrefix, relativePath),
  });
}

async function computeInstalledSizeKb(rootPath) {
  let bytes = 0;
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const stat = await fsp.stat(fullPath);
      bytes += entry.isDirectory() ? 4096 : stat.size;
      if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }
  await walk(rootPath);
  return Math.ceil(bytes / 1024);
}

export async function prepareDebPackageTask(arch) {
  const debArch = getDebPackageArch(arch);
  const binaryDir = path.join(repoRoot, '..', `VSCode-linux-${arch}`);
  const destination = path.join(
    repoRoot,
    '.build',
    'linux',
    'deb',
    debArch,
    `${product.applicationName}-${debArch}`,
  );
  await rimraf(path.dirname(destination));
  await ensureDir(destination);
  assertPathExists(binaryDir, `Missing desktop build output for arch ${arch}`);

  const dependencies = await getDebDependencies(binaryDir, debArch);
  const installedSizeKb = await computeInstalledSizeKb(binaryDir);
  const version = `${rootPackageJson.version}-${linuxPackageRevision()}`;

  const replacements = {
    NAME_LONG: product.nameLong,
    NAME_SHORT: product.nameShort,
    NAME: product.applicationName,
    EXEC: `/usr/share/${product.applicationName}/${product.applicationName}`,
    ICON: product.linuxIconName,
    URLPROTOCOL: product.urlProtocol,
    LICENSE: product.licenseName,
    VERSION: version,
    ARCHITECTURE: debArch,
    DEPENDS: dependencies.join(', '),
    RECOMMENDS: recommendedDeps.join(', '),
    INSTALLEDSIZE: installedSizeKb,
  };

  await copyBinaryIntoRoot(binaryDir, destination, `usr/share/${product.applicationName}`);
  await copyTemplateWithReplacements(
    'resources/linux/debian/control.template',
    path.join(destination, 'DEBIAN/control'),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/debian/prerm.template',
    path.join(destination, 'DEBIAN/prerm'),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/debian/postrm.template',
    path.join(destination, 'DEBIAN/postrm'),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/debian/postinst.template',
    path.join(destination, 'DEBIAN/postinst'),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/debian/templates.template',
    path.join(destination, 'DEBIAN/templates'),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/code.desktop',
    path.join(destination, `usr/share/applications/${product.applicationName}.desktop`),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/code-url-handler.desktop',
    path.join(destination, `usr/share/applications/${product.applicationName}-url-handler.desktop`),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/code.appdata.xml',
    path.join(destination, `usr/share/appdata/${product.applicationName}.appdata.xml`),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/code-workspace.xml',
    path.join(destination, `usr/share/mime/packages/${product.applicationName}-workspace.xml`),
    replacements,
  );

  await copyPatterns({
    cwd: path.join(repoRoot, 'resources', 'linux'),
    patterns: ['code.png'],
    destinationRoot: path.join(destination, 'usr/share/pixmaps'),
    mapPath: () => `${product.linuxIconName}.png`,
  });
  await copyTemplateWithReplacements(
    'resources/completions/bash/code',
    path.join(destination, `usr/share/bash-completion/completions/${product.applicationName}`),
    { APPNAME: product.applicationName },
  );
  await copyTemplateWithReplacements(
    'resources/completions/zsh/_code',
    path.join(destination, `usr/share/zsh/vendor-completions/_${product.applicationName}`),
    { APPNAME: product.applicationName },
  );
}

export async function buildDebPackageTask(arch) {
  if (!commandExists('fakeroot')) {
    throw new Error('Missing required command: fakeroot');
  }
  if (!commandExists('dpkg-deb')) {
    throw new Error('Missing required command: dpkg-deb');
  }
  const debArch = getDebPackageArch(arch);
  const cwd = path.join(repoRoot, '.build', 'linux', 'deb', debArch);
  await runCommand('chmod', [
    '755',
    `${product.applicationName}-${debArch}/DEBIAN/postinst`,
    `${product.applicationName}-${debArch}/DEBIAN/prerm`,
    `${product.applicationName}-${debArch}/DEBIAN/postrm`,
  ], { cwd });
  await runCommand('mkdir', ['-p', 'deb'], { cwd });
  await runCommand('fakeroot', ['dpkg-deb', '-Zxz', '-b', `${product.applicationName}-${debArch}`, 'deb'], {
    cwd,
  });
}

function getRpmBuildPath(rpmArch) {
  return path.join(repoRoot, '.build', 'linux', 'rpm', rpmArch, 'rpmbuild');
}

export async function prepareRpmPackageTask(arch) {
  const rpmArch = getRpmPackageArch(arch);
  const binaryDir = path.join(repoRoot, '..', `VSCode-linux-${arch}`);
  const rpmBuildPath = getRpmBuildPath(rpmArch);
  await rimraf(path.join(repoRoot, '.build', 'linux', 'rpm', rpmArch));
  await ensureDir(rpmBuildPath);
  assertPathExists(binaryDir, `Missing desktop build output for arch ${arch}`);

  const dependencies = await getRpmDependencies(binaryDir, rpmArch);
  const replacements = {
    NAME_LONG: product.nameLong,
    NAME_SHORT: product.nameShort,
    NAME: product.applicationName,
    EXEC: `/usr/share/${product.applicationName}/${product.applicationName}`,
    ICON: product.linuxIconName,
    URLPROTOCOL: product.urlProtocol,
    LICENSE: product.licenseName,
    VERSION: rootPackageJson.version,
    RELEASE: linuxPackageRevision(),
    ARCHITECTURE: rpmArch,
    DEPENDENCIES: dependencies.join(', '),
    STRIP: process.env.STRIP ?? '/usr/bin/strip',
    QUALITY: product.quality || '@@QUALITY@@',
    UPDATEURL: product.updateUrl || '@@UPDATEURL@@',
  };

  await copyBinaryIntoRoot(
    binaryDir,
    rpmBuildPath,
    `BUILD/usr/share/${product.applicationName}`,
  );
  await copyTemplateWithReplacements(
    'resources/linux/code.desktop',
    path.join(rpmBuildPath, `BUILD/usr/share/applications/${product.applicationName}.desktop`),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/code-url-handler.desktop',
    path.join(rpmBuildPath, `BUILD/usr/share/applications/${product.applicationName}-url-handler.desktop`),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/code.appdata.xml',
    path.join(rpmBuildPath, `BUILD/usr/share/appdata/${product.applicationName}.appdata.xml`),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/code-workspace.xml',
    path.join(rpmBuildPath, `BUILD/usr/share/mime/packages/${product.applicationName}-workspace.xml`),
    replacements,
  );
  await copyPatterns({
    cwd: path.join(repoRoot, 'resources', 'linux'),
    patterns: ['code.png'],
    destinationRoot: path.join(rpmBuildPath, 'BUILD/usr/share/pixmaps'),
    mapPath: () => `${product.linuxIconName}.png`,
  });
  await copyTemplateWithReplacements(
    'resources/completions/bash/code',
    path.join(rpmBuildPath, `BUILD/usr/share/bash-completion/completions/${product.applicationName}`),
    { APPNAME: product.applicationName },
  );
  await copyTemplateWithReplacements(
    'resources/completions/zsh/_code',
    path.join(rpmBuildPath, `BUILD/usr/share/zsh/site-functions/_${product.applicationName}`),
    { APPNAME: product.applicationName },
  );
  await copyTemplateWithReplacements(
    'resources/linux/rpm/code.spec.template',
    path.join(rpmBuildPath, `SPECS/${product.applicationName}.spec`),
    replacements,
  );
  await copyPatterns({
    cwd: path.join(repoRoot, 'resources', 'linux', 'rpm'),
    patterns: ['code.xpm'],
    destinationRoot: path.join(rpmBuildPath, 'SOURCES'),
    mapPath: () => `${product.applicationName}.xpm`,
  });
}

export async function buildRpmPackageTask(arch) {
  if (!commandExists('rpmbuild')) {
    throw new Error('Missing required command: rpmbuild');
  }
  const rpmArch = getRpmPackageArch(arch);
  const rpmBuildPath = getRpmBuildPath(rpmArch);
  const rpmOut = path.join(rpmBuildPath, 'RPMS', rpmArch);
  const destination = path.join(repoRoot, '.build', 'linux', 'rpm', rpmArch);
  await ensureDir(destination);
  await runCommand('rpmbuild', [
    '-bb',
    path.join(rpmBuildPath, 'SPECS', `${product.applicationName}.spec`),
    `--target=${rpmArch}`,
  ], {
    env: { ...process.env, HOME: destination },
  });
  const builtRpm = fs.readdirSync(rpmOut)[0];
  await fsp.copyFile(path.join(rpmOut, builtRpm), path.join(destination, builtRpm));
}

function getSnapBuildPath(arch) {
  return path.join(repoRoot, '.build', 'linux', 'snap', arch, `${product.applicationName}-${arch}`);
}

export async function prepareSnapPackageTask(arch) {
  const binaryDir = path.join(repoRoot, '..', `VSCode-linux-${arch}`);
  const destination = getSnapBuildPath(arch);
  await rimraf(path.join(repoRoot, '.build', 'linux', 'snap', arch));
  await ensureDir(destination);
  assertPathExists(binaryDir, `Missing desktop build output for arch ${arch}`);

  const replacements = {
    NAME_LONG: product.nameLong,
    NAME_SHORT: product.nameShort,
    NAME: product.applicationName,
    EXEC: `${product.applicationName} --force-user-env`,
    ICON: `\${SNAP}/meta/gui/${product.linuxIconName}.png`,
    URLPROTOCOL: product.urlProtocol,
    VERSION: getVersion(repoRoot).slice(0, 8),
    ARCHITECTURE: arch === 'x64' ? 'amd64' : arch,
  };

  await copyBinaryIntoRoot(binaryDir, destination, `usr/share/${product.applicationName}`);
  await copyTemplateWithReplacements(
    'resources/linux/code.desktop',
    path.join(destination, `snap/gui/${product.applicationName}.desktop`),
    replacements,
  );
  await copyTemplateWithReplacements(
    'resources/linux/code-url-handler.desktop',
    path.join(destination, `snap/gui/${product.applicationName}-url-handler.desktop`),
    replacements,
  );
  await copyPatterns({
    cwd: path.join(repoRoot, 'resources', 'linux'),
    patterns: ['code.png'],
    destinationRoot: path.join(destination, 'snap/gui'),
    mapPath: () => `${product.linuxIconName}.png`,
  });
  await copyTemplateWithReplacements(
    'resources/linux/snap/snapcraft.yaml',
    path.join(destination, 'snap/snapcraft.yaml'),
    replacements,
  );
  await copyPatterns({
    cwd: path.join(repoRoot, 'resources', 'linux', 'snap'),
    patterns: ['electron-launch'],
    destinationRoot: destination,
  });
}

export async function buildSnapPackageTask(arch) {
  if (!commandExists('snapcraft')) {
    throw new Error('Missing required command: snapcraft');
  }
  await runCommand('snapcraft', [], { cwd: getSnapBuildPath(arch) });
}
