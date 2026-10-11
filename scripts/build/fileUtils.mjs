import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const glob = require('glob');
const minimatch = require('minimatch');

export async function rimraf(targetPath) {
  await fsp.rm(targetPath, { recursive: true, force: true });
}

export async function ensureDir(targetPath) {
  await fsp.mkdir(targetPath, { recursive: true });
}

export async function copyFileWithMode(sourcePath, destinationPath) {
  await ensureDir(path.dirname(destinationPath));
  await fsp.copyFile(sourcePath, destinationPath);
  const stat = await fsp.stat(sourcePath);
  await fsp.chmod(destinationPath, stat.mode);
}

function resolvePatterns(patterns, cwd) {
  const includes = patterns.filter((pattern) => !pattern.startsWith('!'));
  const excludes = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));

  const files = new Set();
  for (const includePattern of includes) {
    const matches = glob.sync(includePattern, { cwd, dot: true, nodir: true });
    for (const match of matches) {
      files.add(match.replace(/\\/g, '/'));
    }
  }

  for (const excludePattern of excludes) {
    for (const file of [...files]) {
      if (minimatch(file, excludePattern, { dot: true })) {
        files.delete(file);
      }
    }
  }

  return [...files].sort();
}

export async function copyPatterns({
  cwd,
  patterns,
  destinationRoot,
  mapPath,
  shouldCopy,
}) {
  const relativeFiles = resolvePatterns(patterns, cwd);
  for (const relativeFile of relativeFiles) {
    if (shouldCopy && !shouldCopy(relativeFile)) {
      continue;
    }
    const sourcePath = path.join(cwd, relativeFile);
    const mappedPath = mapPath ? mapPath(relativeFile) : relativeFile;
    const destinationPath = path.join(destinationRoot, mappedPath);
    await copyFileWithMode(sourcePath, destinationPath);
  }
}

export function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

export function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}
