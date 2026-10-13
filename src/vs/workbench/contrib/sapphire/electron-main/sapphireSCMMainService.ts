/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { promisify } from 'util';
import { execFile as _execFile } from 'child_process';
import { ISapphireSCMService } from '../common/sapphireSCMTypes.js';

interface NumStat {
  file: string;
  added: number;
  removed: number;
}

const execFile = promisify(_execFile);

// Лимиты diff подобраны на типичных небольших и средних изменениях
const MAX_DIFF_LENGTH = 8000;
const MAX_DIFF_FILES = 10;

/** git через execFile — без shell, без интерполяции путей в строку команды. */
const git = async (args: string[], cwd: string): Promise<string> => {
  const { stdout, stderr } = await execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  if (stderr && !stdout) {
    throw new Error(stderr);
  }
  return String(stdout).trim();
};

const getNumStat = async (path: string, useStagedChanges: boolean): Promise<NumStat[]> => {
  const args = ['diff', '--numstat'];
  if (useStagedChanges) {
    args.push('--staged');
  }
  const output = await git(args, path);
  if (!output) {
    return [];
  }
  return output.split('\n').filter(Boolean).map((line) => {
    const [added, removed, file] = line.split('\t');
    return {
      file,
      added: parseInt(added, 10) || 0,
      removed: parseInt(removed, 10) || 0,
    };
  });
};

const getSampledDiff = async (
  file: string,
  path: string,
  useStagedChanges: boolean,
): Promise<string> => {
  const args = ['diff', '--unified=0', '--no-color'];
  if (useStagedChanges) {
    args.push('--staged');
  }
  args.push('--', file);
  const diff = await git(args, path);
  return diff.slice(0, MAX_DIFF_LENGTH);
};

const hasStagedChanges = async (path: string): Promise<boolean> => {
  const output = await git(['diff', '--staged', '--name-only'], path);
  return output.length > 0;
};

export class SapphireSCMService implements ISapphireSCMService {
  readonly _serviceBrand: undefined;

  async gitStat(path: string): Promise<string> {
    const useStagedChanges = await hasStagedChanges(path);
    const args = ['diff', '--stat'];
    if (useStagedChanges) {
      args.push('--staged');
    }
    return git(args, path);
  }

  async gitSampledDiffs(path: string): Promise<string> {
    const useStagedChanges = await hasStagedChanges(path);
    const numStatList = await getNumStat(path, useStagedChanges);
    const topFiles = numStatList
      .sort((a, b) => b.added + b.removed - (a.added + a.removed))
      .slice(0, MAX_DIFF_FILES);
    const diffs = await Promise.all(
      topFiles.map(async ({ file }) => ({
        file,
        diff: await getSampledDiff(file, path, useStagedChanges),
      })),
    );
    return diffs.map(({ file, diff }) => `==== ${file} ====\n${diff}`).join('\n\n');
  }

  gitBranch(path: string): Promise<string> {
    return git(['branch', '--show-current'], path);
  }

  gitLog(path: string): Promise<string> {
    return git(
      ['log', '--pretty=format:%h|%s|%ad', '--date=short', '--no-merges', '-n', '5'],
      path,
    );
  }
}
