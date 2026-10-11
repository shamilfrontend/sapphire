import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { repoRoot } from '../constants.mjs';
import { copyPatterns, rimraf, writeText } from '../fileUtils.mjs';
import { runCommand, spawnLongRunning, waitForChildren } from '../processUtils.mjs';

const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const vueBuildDir = path.join(
  repoRoot,
  'src',
  'vs',
  'workbench',
  'contrib',
  'sapphire',
  'browser',
  'vue',
);

export async function buildReact() {
  await runCommand(process.execPath, ['build.js'], { cwd: vueBuildDir });
}

function getDtsFiles() {
  const dtsRoot = path.join(repoRoot, 'src', 'vscode-dts');
  const entries = fs.readdirSync(dtsRoot).filter((name) => /^vscode\.proposed\.[a-zA-Z\d]+\.d\.ts$/.test(name));
  return entries.map((name) => path.join(dtsRoot, name));
}

export async function generateApiProposalNames() {
  let eol = os.EOL;
  const targetPath = path.join(
    repoRoot,
    'src',
    'vs',
    'platform',
    'extensions',
    'common',
    'extensionsApiProposals.ts',
  );

  try {
    const existing = fs.readFileSync(targetPath, 'utf8');
    const match = /\r?\n/.exec(existing);
    eol = match ? match[0] : os.EOL;
  } catch {
    // ignore
  }

  const versionPattern = /^\s*\/\/\s*version\s*:\s*(\d+)\s*$/im;
  const proposals = new Map();
  for (const file of getDtsFiles()) {
    const fileName = path.basename(file);
    const match = /vscode\.proposed\.([a-zA-Z\d]+)\.d\.ts$/.exec(fileName);
    if (!match) {
      continue;
    }
    const proposalName = match[1];
    const contents = fs.readFileSync(file, 'utf8');
    const versionMatch = versionPattern.exec(contents);
    proposals.set(proposalName, {
      proposal: `https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.proposed.${proposalName}.d.ts`,
      version: versionMatch ? Number(versionMatch[1]) : undefined,
    });
  }

  const names = [...proposals.keys()].sort();
  const contents = [
    '/*---------------------------------------------------------------------------------------------',
    ' *  Copyright (c) Microsoft Corporation. All rights reserved.',
    ' *  Licensed under the MIT License. See License.txt in the project root for license information.',
    ' *--------------------------------------------------------------------------------------------*/',
    '',
    '// THIS IS A GENERATED FILE. DO NOT EDIT DIRECTLY.',
    '',
    'const _allApiProposals = {',
    `${names
      .map((proposalName) => {
        const proposal = proposals.get(proposalName);
        return `\t${proposalName}: {${eol}\t\tproposal: '${proposal.proposal}',${eol}${proposal.version ? `\t\tversion: ${proposal.version}${eol}` : ''}\t}`;
      })
      .join(`,${eol}`)}`,
    '};',
    'export const allApiProposals = Object.freeze<{ [proposalName: string]: Readonly<{ proposal: string; version?: number }> }>(_allApiProposals);',
    'export type ApiProposalName = keyof typeof _allApiProposals;',
    '',
  ].join(eol);

  writeText(targetPath, contents);
}

async function runSrcTsc({ outDir, watch = false }) {
  const env = { ...process.env };
  if (!env.NODE_OPTIONS) {
    env.NODE_OPTIONS = '--max-old-space-size=8192';
  }

  const args = [
    tscBin,
    '-p',
    path.join(repoRoot, 'src', 'tsconfig.json'),
    '--pretty',
    'false',
    '--sourceMap',
    '--rootDir',
    path.join(repoRoot, 'src'),
    '--outDir',
    path.join(repoRoot, outDir),
  ];
  if (watch) {
    args.push('--watch', '--preserveWatchOutput');
  }
  if (watch) {
    return spawnLongRunning(process.execPath, args, { cwd: repoRoot, env });
  }
  await runCommand(process.execPath, args, { cwd: repoRoot, env });
  return undefined;
}

async function copySourceAssets(outDir) {
  await copyPatterns({
    cwd: repoRoot,
    patterns: [
      'src/**',
      '!src/**/*.ts',
      '!src/**/*.tsx',
      '!src/vs/workbench/contrib/sapphire/browser/vue/src/**',
      '!src/vs/workbench/contrib/sapphire/browser/vue/src2/**',
    ],
    destinationRoot: path.join(repoRoot, outDir),
    mapPath: (relativePath) => relativePath.replace(/^src\//, ''),
  });
}

async function runApiProposalsWatch() {
  const watchRoot = path.join(repoRoot, 'src', 'vscode-dts');
  await generateApiProposalNames();

  let timeout;
  fs.watch(watchRoot, { recursive: true }, () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      generateApiProposalNames().catch((error) => {
        console.error('[build] failed to regenerate extensionsApiProposals.ts', error);
      });
    }, 120);
  });
}

export async function transpileClientEsbuildTask() {
  await buildReact();
  await rimraf(path.join(repoRoot, 'out'));
  await generateApiProposalNames();
  await copySourceAssets('out');
  await runSrcTsc({ outDir: 'out', watch: false });
}

export async function compileClientTask() {
  await buildReact();
  await rimraf(path.join(repoRoot, 'out'));
  await generateApiProposalNames();
  await copySourceAssets('out');
  await runSrcTsc({ outDir: 'out', watch: false });
}

export async function watchClientTask() {
  await buildReact();
  await rimraf(path.join(repoRoot, 'out'));
  await copySourceAssets('out');
  const tscWatcher = await runSrcTsc({ outDir: 'out', watch: true });
  await runApiProposalsWatch();
  await waitForChildren([tscWatcher]);
}

export async function compileBuildTask() {
  await buildReact();
  await rimraf(path.join(repoRoot, 'out-build'));
  await fsp.mkdir(path.join(repoRoot, 'out-build'), { recursive: true });
  writeText(path.join(repoRoot, 'out-build', 'date'), new Date().toISOString());
  await generateApiProposalNames();
  await copySourceAssets('out-build');
  await runSrcTsc({ outDir: 'out-build', watch: false });
}
