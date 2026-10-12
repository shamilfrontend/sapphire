import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '../..');
export const buildRoot = path.resolve(repoRoot, '..');

export const product = JSON.parse(fs.readFileSync(path.join(repoRoot, 'product.json'), 'utf8'));
export const rootPackageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
);
export const buildFile = require(path.join(repoRoot, 'build', 'buildfile.js'));
export const getVersion = require(path.join(repoRoot, 'build', 'lib', 'getVersion.js')).getVersion;

export function outPath(...segments) {
  return path.join(repoRoot, ...segments);
}

export function buildTargetPath(...segments) {
  return path.join(buildRoot, ...segments);
}
