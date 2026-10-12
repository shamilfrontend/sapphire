/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import es from 'event-stream';
import vfs from 'vinyl-fs';
import * as util from './util';
import { getVersion } from './getVersion';

type DarwinDocumentSuffix = 'document' | 'script' | 'file' | 'source code';
type DarwinDocumentType = {
  name: string;
  role: string;
  ostypes: string[];
  extensions: string[];
  iconFile: string;
  utis?: string[];
};

function isDocumentSuffix(str?: string): str is DarwinDocumentSuffix {
  return str === 'document' || str === 'script' || str === 'file' || str === 'source code';
}

const root = path.dirname(path.dirname(__dirname));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
const commit = getVersion(root);

function createTemplate(input: string): (params: Record<string, string>) => string {
  return (params: Record<string, string>) =>
    input.replace(/<%=\s*([^\s]+)\s*%>/g, (match, key) => params[key] || match);
}

const darwinCreditsTemplate =
  product.darwinCredits &&
  createTemplate(fs.readFileSync(path.join(root, product.darwinCredits), 'utf8'));

/**
 * Generate a `DarwinDocumentType` given a list of file extensions, an icon name, and an optional suffix or file type name.
 * @param extensions A list of file extensions, such as `['bat', 'cmd']`
 * @param icon A sentence-cased file type name that matches the lowercase name of a darwin icon resource.
 * For example, `'HTML'` instead of `'html'`, or `'Java'` instead of `'java'`.
 * This parameter is lowercased before it is used to reference an icon file.
 * @param nameOrSuffix An optional suffix or a string to use as the file type. If a suffix is provided,
 * it is used with the icon parameter to generate a file type string. If nothing is provided,
 * `'document'` is used with the icon parameter to generate file type string.
 *
 * For example, if you call `darwinBundleDocumentType(..., 'HTML')`, the resulting file type is `"HTML document"`,
 * and the `'html'` darwin icon is used.
 *
 * If you call `darwinBundleDocumentType(..., 'Javascript', 'file')`, the resulting file type is `"Javascript file"`.
 * and the `'javascript'` darwin icon is used.
 *
 * If you call `darwinBundleDocumentType(..., 'bat', 'Windows command script')`, the file type is `"Windows command script"`,
 * and the `'bat'` darwin icon is used.
 */
function darwinBundleDocumentType(
  extensions: string[],
  icon: string,
  nameOrSuffix?: string | DarwinDocumentSuffix,
  utis?: string[],
): DarwinDocumentType {
  // If given a suffix, generate a name from it. If not given anything, default to 'document'
  if (isDocumentSuffix(nameOrSuffix) || !nameOrSuffix) {
    nameOrSuffix = `${icon.charAt(0).toUpperCase() + icon.slice(1)} ${nameOrSuffix ?? 'document'}`;
  }

  return {
    name: nameOrSuffix,
    role: 'Editor',
    ostypes: ['TEXT', 'utxt', 'TUTX', '****'],
    extensions,
    iconFile: `resources/darwin/${icon.toLowerCase()}.icns`,
    utis,
  };
}

/**
 * Generate several `DarwinDocumentType`s with unique names and a shared icon.
 * @param types A map of file type names to their associated file extensions.
 * @param icon A darwin icon resource to use. For example, `'HTML'` would refer to `resources/darwin/html.icns`
 *
 * Examples:
 * ```
 * darwinBundleDocumentTypes({ 'C header file': 'h', 'C source code': 'c' },'c')
 * darwinBundleDocumentTypes({ 'React source code': ['jsx', 'tsx'] }, 'react')
 * ```
 */
function darwinBundleDocumentTypes(
  types: { [name: string]: string | string[] },
  icon: string,
): DarwinDocumentType[] {
  return Object.keys(types).map((name: string): DarwinDocumentType => {
    const extensions = types[name];
    return {
      name,
      role: 'Editor',
      ostypes: ['TEXT', 'utxt', 'TUTX', '****'],
      extensions: Array.isArray(extensions) ? extensions : [extensions],
      iconFile: `resources/darwin/${icon}.icns`,
    };
  });
}

const { electronVersion, msBuildId } = util.getElectronVersion();

export const config = {
  version: electronVersion,
  tag: product.electronRepository ? `v${electronVersion}-${msBuildId}` : undefined,
  productAppName: product.nameLong,
  companyName: 'Microsoft Corporation',
  copyright: 'Copyright (C) 2024 Microsoft. All rights reserved',
  darwinIcon: 'resources/darwin/code.icns',
  darwinBundleIdentifier: product.darwinBundleIdentifier,
  darwinApplicationCategoryType: 'public.app-category.developer-tools',
  darwinHelpBookFolder: 'VS Code HelpBook',
  darwinHelpBookName: 'VS Code HelpBook',
  darwinBundleDocumentTypes: [
    ...darwinBundleDocumentTypes({ 'C header file': 'h', 'C source code': 'c' }, 'c'),
    ...darwinBundleDocumentTypes(
      { 'Git configuration file': ['gitattributes', 'gitconfig', 'gitignore'] },
      'config',
    ),
    ...darwinBundleDocumentTypes(
      { 'HTML template document': ['asp', 'aspx', 'cshtml', 'jshtm', 'jsp', 'phtml', 'shtml'] },
      'html',
    ),
    darwinBundleDocumentType(['bat', 'cmd'], 'bat', 'Windows command script'),
    darwinBundleDocumentType(['bowerrc'], 'Bower'),
    darwinBundleDocumentType(
      ['config', 'editorconfig', 'ini', 'cfg'],
      'config',
      'Configuration file',
    ),
    darwinBundleDocumentType(['hh', 'hpp', 'hxx', 'h++'], 'cpp', 'C++ header file'),
    darwinBundleDocumentType(['cc', 'cpp', 'cxx', 'c++'], 'cpp', 'C++ source code'),
    darwinBundleDocumentType(['m'], 'default', 'Objective-C source code'),
    darwinBundleDocumentType(['mm'], 'cpp', 'Objective-C++ source code'),
    darwinBundleDocumentType(['cs', 'csx'], 'csharp', 'C# source code'),
    darwinBundleDocumentType(['css'], 'css', 'CSS'),
    darwinBundleDocumentType(['go'], 'go', 'Go source code'),
    darwinBundleDocumentType(['htm', 'html', 'xhtml'], 'HTML'),
    darwinBundleDocumentType(['jade'], 'Jade'),
    darwinBundleDocumentType(['jav', 'java'], 'Java'),
    darwinBundleDocumentType(['js', 'jscsrc', 'jshintrc', 'mjs', 'cjs'], 'Javascript', 'file'),
    darwinBundleDocumentType(['json'], 'JSON'),
    darwinBundleDocumentType(['less'], 'Less'),
    darwinBundleDocumentType(
      ['markdown', 'md', 'mdoc', 'mdown', 'mdtext', 'mdtxt', 'mdwn', 'mkd', 'mkdn'],
      'Markdown',
    ),
    darwinBundleDocumentType(['php'], 'PHP', 'source code'),
    darwinBundleDocumentType(['ps1', 'psd1', 'psm1'], 'Powershell', 'script'),
    darwinBundleDocumentType(['py', 'pyi'], 'Python', 'script'),
    darwinBundleDocumentType(['gemspec', 'rb', 'erb'], 'Ruby', 'source code'),
    darwinBundleDocumentType(['scss', 'sass'], 'SASS', 'file'),
    darwinBundleDocumentType(['sql'], 'SQL', 'script'),
    darwinBundleDocumentType(['ts'], 'TypeScript', 'file'),
    darwinBundleDocumentType(['tsx', 'jsx'], 'React', 'source code'),
    darwinBundleDocumentType(['vue'], 'Vue', 'source code'),
    darwinBundleDocumentType(
      ['ascx', 'csproj', 'dtd', 'plist', 'wxi', 'wxl', 'wxs', 'xml', 'xaml'],
      'XML',
    ),
    darwinBundleDocumentType(['eyaml', 'eyml', 'yaml', 'yml'], 'YAML'),
    darwinBundleDocumentType(
      [
        'bash',
        'bash_login',
        'bash_logout',
        'bash_profile',
        'bashrc',
        'profile',
        'rhistory',
        'rprofile',
        'sh',
        'zlogin',
        'zlogout',
        'zprofile',
        'zsh',
        'zshenv',
        'zshrc',
      ],
      'Shell',
      'script',
    ),
    // Default icon with specified names
    ...darwinBundleDocumentTypes(
      {
        'Clojure source code': ['clj', 'cljs', 'cljx', 'clojure'],
        'VS Code workspace file': 'code-workspace',
        'CoffeeScript source code': 'coffee',
        'Comma Separated Values': 'csv',
        'CMake script': 'cmake',
        'Dart script': 'dart',
        'Diff file': 'diff',
        Dockerfile: 'dockerfile',
        'Gradle file': 'gradle',
        'Groovy script': 'groovy',
        Makefile: ['makefile', 'mk'],
        'Lua script': 'lua',
        'Pug document': 'pug',
        Jupyter: 'ipynb',
        Lockfile: 'lock',
        'Log file': 'log',
        'Plain Text File': 'txt',
        'Xcode project file': 'xcodeproj',
        'Xcode workspace file': 'xcworkspace',
        'Visual Basic script': 'vb',
        'R source code': 'r',
        'Rust source code': 'rs',
        'Restructured Text document': 'rst',
        'LaTeX document': ['tex', 'cls'],
        'F# source code': 'fs',
        'F# signature file': 'fsi',
        'F# script': ['fsx', 'fsscript'],
        'SVG document': ['svg'],
        'TOML document': 'toml',
        'Swift source code': 'swift',
      },
      'default',
    ),
    // Default icon with default name
    darwinBundleDocumentType(
      [
        'containerfile',
        'ctp',
        'dot',
        'edn',
        'handlebars',
        'hbs',
        'ml',
        'mli',
        'pl',
        'pl6',
        'pm',
        'pm6',
        'pod',
        'pp',
        'properties',
        'psgi',
        'rt',
        't',
      ],
      'default',
      `${product.nameLong} document`,
    ),
    // Folder support ()
    darwinBundleDocumentType([], 'default', 'Folder', ['public.folder']),
  ],
  darwinBundleURLTypes: [
    {
      role: 'Viewer',
      name: product.nameLong,
      urlSchemes: [product.urlProtocol],
    },
  ],
  darwinForceDarkModeSupport: true,
  darwinCredits: darwinCreditsTemplate
    ? Buffer.from(darwinCreditsTemplate({ commit, date: new Date().toISOString() }))
    : undefined,
  linuxExecutableName: product.applicationName,
  winIcon: 'resources/win32/code.ico',
  token: process.env.GITHUB_TOKEN,
  repo: product.electronRepository || undefined,
  validateChecksum: true,
  checksumFile: path.join(root, 'build', 'checksums', 'electron.txt'),
};

function getElectron(arch: string): () => NodeJS.ReadWriteStream {
  return () => {
    const electron = require('@vscode/gulp-electron');

    const electronOpts = {
      ...config,
      platform: process.platform,
      arch: arch === 'armhf' ? 'arm' : arch,
      ffmpegChromium: false,
      keepDefaultApp: true,
    };

    return vfs
      .src('package.json')
      .pipe(
        es.mapSync((f: any) => {
          const data = JSON.parse(f.contents.toString('utf8'));
          data.name = product.nameShort;
          f.contents = Buffer.from(JSON.stringify(data));
          return f;
        }),
      )
      .pipe(electron(electronOpts))
      .pipe(
        es.through(function (f: any) {
          const normalized = f.path.replace(/\\/g, '/');
          if (!/\/app\/package\.json$/.test(normalized)) {
            this.emit('data', f);
          }
        }),
      )
      .pipe(vfs.dest('.build/electron'));
  };
}

/**
 * gulp-electron@1.36.0 renames helper .app folders but fails to patch Info.plist when
 * the helper name contains parentheses (Renderer/GPU/Plugin). Activity Monitor then
 * shows "Electron Helper (...)" instead of "Sapphire Helper (...)".
 * Also covers packaged builds that still ship unrenamed Electron Helper bundles.
 *
 * @param appBundlePath Path to `Sapphire.app`
 * @param adhocSign When true, ad-hoc codesign changed helpers (dev Electron). Set false
 * when a real identity sign follows immediately (darwin/sign).
 */
export function brandDarwinAppHelpers(
  appBundlePath: string,
  adhocSign: boolean = true,
): void {
  if (process.platform !== 'darwin') {
    return;
  }

  const frameworksPath = path.join(appBundlePath, 'Contents', 'Frameworks');
  if (!fs.existsSync(frameworksPath)) {
    return;
  }

  const plist = require('plist') as {
    parse: (s: string) => Record<string, unknown>;
    build: (obj: Record<string, unknown>) => string;
  };

  const helperAppRe = new RegExp(
    `^(?:Electron|${escapeRegExp(product.nameShort)}) Helper( \\(\\w+\\))?\\.app$`,
  );

  for (const entry of fs.readdirSync(frameworksPath)) {
    const match = helperAppRe.exec(entry);
    if (!match) {
      continue;
    }

    const suffix = match[1] ?? '';
    const targetHelperName = `${product.nameShort} Helper${suffix}`;
    const targetAppName = `${targetHelperName}.app`;
    const idSuffix = suffix ? `.${suffix.slice(2, -1)}` : '';
    const bundleId = `${product.darwinBundleIdentifier}.helper${idSuffix}`;

    let changed = false;
    let helperAppPath = path.join(frameworksPath, entry);
    if (entry !== targetAppName) {
      const renamedPath = path.join(frameworksPath, targetAppName);
      fs.renameSync(helperAppPath, renamedPath);
      helperAppPath = renamedPath;
      changed = true;
    }

    const macOSPath = path.join(helperAppPath, 'Contents', 'MacOS');
    if (fs.existsSync(macOSPath)) {
      for (const binary of fs.readdirSync(macOSPath)) {
        if (binary !== targetHelperName) {
          fs.renameSync(path.join(macOSPath, binary), path.join(macOSPath, targetHelperName));
          changed = true;
        }
      }
    }

    const infoPlistPath = path.join(helperAppPath, 'Contents', 'Info.plist');
    const infoPlist = plist.parse(fs.readFileSync(infoPlistPath, 'utf8'));
    const needsWrite =
      infoPlist['CFBundleName'] !== targetHelperName ||
      infoPlist['CFBundleDisplayName'] !== targetHelperName ||
      infoPlist['CFBundleExecutable'] !== targetHelperName ||
      infoPlist['CFBundleIdentifier'] !== bundleId;

    if (needsWrite) {
      infoPlist['CFBundleName'] = targetHelperName;
      infoPlist['CFBundleDisplayName'] = targetHelperName;
      infoPlist['CFBundleExecutable'] = targetHelperName;
      infoPlist['CFBundleIdentifier'] = bundleId;
      fs.writeFileSync(infoPlistPath, plist.build(infoPlist));
      changed = true;
    }

    if (changed && adhocSign) {
      // Ad-hoc re-sign after plist/binary renames so macOS accepts the helper.
      execFileSync('codesign', ['--force', '--sign', '-', helperAppPath], {
        stdio: 'inherit',
      });
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main(arch: string = process.arch): Promise<void> {
  const version = electronVersion;
  const electronPath = path.join(root, '.build', 'electron');
  const versionFile = path.join(electronPath, 'version');
  const isUpToDate =
    fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf8') === `${version}`;

  if (!isUpToDate) {
    await util.rimraf(electronPath)();
    await util.streamToPromise(getElectron(arch)());
  }

  brandDarwinAppHelpers(path.join(electronPath, `${product.nameLong}.app`));
}

if (require.main === module) {
  main(process.argv[2]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
