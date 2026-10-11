import { createViteConfig } from './shared.mjs';

export function createWebViteConfig({ root, input, outDir, minify, mapper }) {
  return createViteConfig({
    root,
    input,
    outDir,
    minify,
    mapper,
  });
}
