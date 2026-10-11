import { createViteConfig } from './shared.mjs';

export function createBuildViteConfig({ root, input, outDir, minify = false, mapper }) {
  return createViteConfig({
    root,
    input,
    outDir,
    minify,
    mapper,
  });
}
